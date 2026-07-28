import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  NavEngine,
  createActionRegistry,
  InMemorySessionStore,
  ConsoleAuditSink,
  FakeLLMProvider,
  defineNavigationAction,
  type Action,
} from '@nav-engine/core';
import { registerNavEngineRoutes } from './register-routes.js';

function taskCreateAction(): Action {
  return {
    key: 'task.create',
    description: 'criar uma tarefa',
    paramsSchema: z.object({ title: z.string() }),
    riskLevel: 'safe',
    checkPermission: async () => true,
    handler: async (params: { title: string }) => ({ ok: true, message: `Tarefa "${params.title}" criada.` }),
  };
}

function buildMultipart(fields: Record<string, string>, file?: { fieldname: string; filename: string; content: Buffer; contentType: string }) {
  const boundary = 'NavEngineTestBoundary123';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(file.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), boundary };
}

describe('registerNavEngineRoutes', () => {
  let app: FastifyInstance;
  let llm: FakeLLMProvider;

  beforeEach(async () => {
    app = Fastify();
    const registry = createActionRegistry();
    registry.register(taskCreateAction());
    registry.register(
      defineNavigationAction({
        key: 'nav.go_settings',
        description: 'ir para configurações',
        to: () => '/app/settings',
      }),
    );
    llm = new FakeLLMProvider();
    const engine = new NavEngine({
      registry,
      llmProvider: llm,
      sessionStore: new InMemorySessionStore(),
      auditSink: new ConsoleAuditSink(),
    });

    await registerNavEngineRoutes(app, {
      engine,
      getUserId: () => 'user-1',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /nav-engine/message executa uma ação safe e devolve o DTO esperado', async () => {
    llm.queueResolve({ kind: 'action', actionKey: 'task.create', params: { title: 'Comprar leite' }, confidence: 90 });

    const response = await app.inject({
      method: 'POST',
      url: '/nav-engine/message',
      payload: { sessionId: 's1', message: 'cria uma tarefa: comprar leite' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('executed');
    expect(body.executionOk).toBe(true);
    expect(body.action).toEqual({ key: 'task.create', description: 'criar uma tarefa' });
  });

  it('POST /nav-engine/message devolve navigateTo quando a ação é de navegação', async () => {
    llm.queueResolve({ kind: 'action', actionKey: 'nav.go_settings', params: {}, confidence: 95 });

    const response = await app.inject({
      method: 'POST',
      url: '/nav-engine/message',
      payload: { sessionId: 's2', message: 'me leva pra configurações' },
    });

    expect(response.json().navigateTo).toBe('/app/settings');
  });

  it('POST /nav-engine/message rejeita body inválido com 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/nav-engine/message',
      payload: { message: 'sem sessionId' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /nav-engine/audio transcreve e delega para o mesmo pipeline de texto', async () => {
    llm.queueResolve({ kind: 'action', actionKey: 'task.create', params: { title: 'via voz' }, confidence: 90 });

    // recria o app com um transcriptionProvider fake para este teste
    await app.close();
    app = Fastify();
    const registry = createActionRegistry();
    registry.register(taskCreateAction());
    const engine = new NavEngine({
      registry,
      llmProvider: llm,
      sessionStore: new InMemorySessionStore(),
      auditSink: new ConsoleAuditSink(),
      transcriptionProvider: {
        transcribe: async () => ({ text: 'cria uma tarefa: via voz' }),
      },
    });
    await registerNavEngineRoutes(app, { engine, getUserId: () => 'user-1' });
    await app.ready();

    const { body, boundary } = buildMultipart(
      { sessionId: 's3' },
      { fieldname: 'audio', filename: 'nota.webm', content: Buffer.from('fake-audio-bytes'), contentType: 'audio/webm' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/nav-engine/audio',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('executed');
  });

  it('POST /nav-engine/audio sem sessionId retorna 400', async () => {
    const { body, boundary } = buildMultipart(
      {},
      { fieldname: 'audio', filename: 'nota.webm', content: Buffer.from('x'), contentType: 'audio/webm' },
    );
    const response = await app.inject({
      method: 'POST',
      url: '/nav-engine/audio',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
  });
});
