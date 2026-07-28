import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NavEngine } from './nav-engine.js';
import { createActionRegistry, type ActionRegistry } from '../registry/action-registry.js';
import { defineNavigationAction } from '../registry/navigation-action.js';
import { InMemorySessionStore } from '../session/in-memory-session-store.js';
import { FakeLLMProvider } from '../llm/fake-llm-provider.js';
import type { AuditEntry, AuditSink } from '../types/audit.js';
import type { Action } from '../types/action.js';
import type { ExecutionContext } from '../types/context.js';

const ctx: ExecutionContext = { sessionId: 'session-1', userId: 'user-1', hostContext: {} };

class RecordingAuditSink implements AuditSink {
  entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function taskCreateAction(handler = vi.fn(async () => ({ ok: true, message: 'Tarefa criada.' }))): Action {
  return {
    key: 'task.create',
    description: 'criar uma nova tarefa',
    paramsSchema: z.object({ title: z.string() }),
    riskLevel: 'safe',
    examples: ['cria uma tarefa chamada X'],
    checkPermission: async () => true,
    handler,
  };
}

function taskDeleteAllAction(handler = vi.fn(async () => ({ ok: true, message: 'Todas as tarefas foram apagadas.' }))): Action {
  return {
    key: 'task.delete_all',
    description: 'apagar todas as tarefas',
    paramsSchema: z.object({}),
    riskLevel: 'confirm',
    checkPermission: async () => true,
    handler,
  };
}

function exportDataAction(): Action {
  return {
    key: 'data.export',
    description: 'exportar todos os dados da conta',
    paramsSchema: z.object({}),
    riskLevel: 'blocked',
    checkPermission: async () => true,
    handler: async () => ({ ok: true, message: 'Exportado.' }),
  };
}

function buildEngine(opts?: {
  registry?: ActionRegistry;
  llm?: FakeLLMProvider;
  auditSink?: RecordingAuditSink;
  maxClarificationTurns?: number;
}) {
  const registry = opts?.registry ?? createActionRegistry();
  const llm = opts?.llm ?? new FakeLLMProvider();
  const auditSink = opts?.auditSink ?? new RecordingAuditSink();
  const sessionStore = new InMemorySessionStore();
  const engine = new NavEngine({
    registry,
    llmProvider: llm,
    sessionStore,
    auditSink,
    maxClarificationTurns: opts?.maxClarificationTurns,
  });
  return { registry, llm, auditSink, sessionStore, engine };
}

describe('NavEngine', () => {
  it('executa uma ação safe direto quando a confiança está acima do limiar', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'Tarefa criada.' }));
    const registry = createActionRegistry();
    registry.register(taskCreateAction(handler));
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({
      kind: 'action',
      actionKey: 'task.create',
      params: { title: 'Comprar leite' },
      confidence: 90,
    });

    const result = await engine.handleMessage(ctx, 'cria uma tarefa: comprar leite');

    expect(result.status).toBe('executed');
    expect(result.executionOk).toBe(true);
    expect(handler).toHaveBeenCalledWith({ title: 'Comprar leite' }, ctx);
    expect(auditSink.entries.at(-1)?.outcome).toBe('executed');
  });

  it('ação confirm nunca executa sem confirmação explícita, e "não" cancela', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'Todas as tarefas foram apagadas.' }));
    const registry = createActionRegistry();
    registry.register(taskDeleteAllAction(handler));
    const { llm, engine } = buildEngine({ registry });

    llm.queueResolve({ kind: 'action', actionKey: 'task.delete_all', params: {}, confidence: 95 });
    const first = await engine.handleMessage(ctx, 'apaga tudo');
    expect(first.status).toBe('awaiting_confirmation');
    expect(handler).not.toHaveBeenCalled();

    llm.queueConfirmation('declined');
    const second = await engine.handleMessage(ctx, 'não');
    expect(second.status).toBe('declined');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ação confirm executa somente após confirmação explícita "sim"', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'Todas as tarefas foram apagadas.' }));
    const registry = createActionRegistry();
    registry.register(taskDeleteAllAction(handler));
    const { llm, engine } = buildEngine({ registry });

    llm.queueResolve({ kind: 'action', actionKey: 'task.delete_all', params: {}, confidence: 95 });
    await engine.handleMessage(ctx, 'apaga tudo');
    expect(handler).not.toHaveBeenCalled();

    llm.queueConfirmation('confirmed');
    const result = await engine.handleMessage(ctx, 'sim');
    expect(result.status).toBe('executed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('confiança abaixo do limiar sempre vira clarify, mesmo com ação "escolhida"', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'Tarefa criada.' }));
    const registry = createActionRegistry();
    registry.register(taskCreateAction(handler));
    const { llm, engine } = buildEngine({ registry });

    llm.queueResolve({
      kind: 'action',
      actionKey: 'task.create',
      params: { title: 'algo' },
      confidence: 50,
    });

    const result = await engine.handleMessage(ctx, 'cria uma coisa aí');
    expect(result.status).toBe('awaiting_clarification');
    expect(handler).not.toHaveBeenCalled();
  });

  it('loop de esclarecimento desiste graciosamente após maxClarificationTurns', async () => {
    const registry = createActionRegistry();
    registry.register(taskCreateAction());
    const { llm, engine } = buildEngine({ registry, maxClarificationTurns: 2 });

    llm.queueResolve({ kind: 'clarify', question: 'O que você quer fazer exatamente?' });
    const first = await engine.handleMessage(ctx, 'faz uma coisa');
    expect(first.status).toBe('awaiting_clarification');

    llm.queueResolve({ kind: 'clarify', question: 'Ainda não entendi, pode detalhar?' });
    const second = await engine.handleMessage(ctx, 'sei lá, uma coisa');
    expect(second.status).toBe('awaiting_clarification');

    const third = await engine.handleMessage(ctx, 'ainda uma coisa vaga');
    expect(third.status).toBe('out_of_scope');
  });

  it('out_of_scope nunca executa nenhuma ação', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'nunca deveria rodar' }));
    const registry = createActionRegistry();
    registry.register(taskCreateAction(handler));
    const { llm, engine } = buildEngine({ registry });

    llm.queueResolve({ kind: 'out_of_scope', message: 'Isso não é algo que eu possa fazer aqui.' });
    const result = await engine.handleMessage(ctx, 'qual é a capital da frança?');
    expect(result.status).toBe('out_of_scope');
    expect(handler).not.toHaveBeenCalled();
  });

  it('actionKey alucinada (fora do shortlist) é rejeitada e auditada como hallucination_blocked', async () => {
    const registry = createActionRegistry();
    registry.register(taskCreateAction());
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({
      kind: 'action',
      actionKey: 'action.que.nao.existe',
      params: {},
      confidence: 99,
    });

    const result = await engine.handleMessage(ctx, 'faz algo estranho');
    expect(result.status).toBe('out_of_scope');
    expect(auditSink.entries.at(-1)?.outcome).toBe('hallucination_blocked');
  });

  it('ação blocked nunca aparece nos candidatos mesmo se a LLM "escolher" ela', async () => {
    const registry = createActionRegistry();
    registry.register(exportDataAction());
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({ kind: 'action', actionKey: 'data.export', params: {}, confidence: 99 });
    const result = await engine.handleMessage(ctx, 'exporta meus dados');

    expect(result.status).toBe('out_of_scope');
    expect(auditSink.entries.at(-1)?.outcome).toBe('hallucination_blocked');
  });

  it('permissão negada filtra a ação antes mesmo de chegar ao resolver', async () => {
    const registry = createActionRegistry();
    registry.register({
      ...taskCreateAction(),
      key: 'secret.action',
      checkPermission: async () => false,
    });
    const { llm, engine, auditSink } = buildEngine({ registry });

    // A LLM tenta "escolher" a ação mesmo assim — como não fez parte do
    // shortlist (permissão negada), o engine trata como alucinação, nunca
    // como uma execução legítima negada por permissão.
    llm.queueResolve({ kind: 'action', actionKey: 'secret.action', params: {}, confidence: 99 });
    const result = await engine.handleMessage(ctx, 'faz a ação secreta');

    expect(result.status).toBe('out_of_scope');
    expect(auditSink.entries.at(-1)?.outcome).toBe('hallucination_blocked');
  });

  it('defesa em profundidade: permissão revogada entre o shortlist e a execução é barrada de novo', async () => {
    let calls = 0;
    const handler = vi.fn(async () => ({ ok: true, message: 'não deveria executar' }));
    const registry = createActionRegistry();
    registry.register({
      ...taskCreateAction(handler),
      checkPermission: async () => {
        calls += 1;
        return calls === 1; // permitido ao montar candidatos, negado na re-checagem final
      },
    });
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({
      kind: 'action',
      actionKey: 'task.create',
      params: { title: 'x' },
      confidence: 95,
    });

    const result = await engine.handleMessage(ctx, 'cria uma tarefa x');
    expect(result.status).toBe('error');
    expect(handler).not.toHaveBeenCalled();
    expect(auditSink.entries.at(-1)?.outcome).toBe('permission_denied');
  });

  it('ação de navegação devolve navigateTo sem exigir handler de negócio do host', async () => {
    const registry = createActionRegistry();
    registry.register(
      defineNavigationAction({
        key: 'nav.go_to_settings',
        description: 'ir para a tela de configurações',
        to: () => '/app/settings',
      }),
    );
    const { llm, engine } = buildEngine({ registry });

    llm.queueResolve({ kind: 'action', actionKey: 'nav.go_to_settings', params: {}, confidence: 95 });
    const result = await engine.handleMessage(ctx, 'me leva pra configurações');

    expect(result.status).toBe('executed');
    expect(result.navigateTo).toBe('/app/settings');
  });

  it('grava shortlistedKeys e modelTier na auditoria', async () => {
    const registry = createActionRegistry();
    registry.register(taskCreateAction());
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({ kind: 'chat', message: 'Posso ajudar com mais alguma coisa?' }, 'fast');
    await engine.handleMessage(ctx, 'oi');

    const entry = auditSink.entries.at(-1);
    expect(entry?.shortlistedKeys).toEqual(['task.create']);
    expect(entry?.modelTier).toBe('fast');
  });

  it('falha do LLMProvider em resolveIntent nunca rejeita o turno — devolve status "error" e audita provider_error', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'nunca deveria rodar' }));
    const registry = createActionRegistry();
    registry.register(taskCreateAction(handler));
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolveError(new Error('timeout de rede'));

    const result = await engine.handleMessage(ctx, 'cria uma tarefa');

    expect(result.status).toBe('error');
    expect(result.reply).toMatch(/não consegui processar/i);
    expect(handler).not.toHaveBeenCalled();
    const entry = auditSink.entries.at(-1);
    expect(entry?.outcome).toBe('provider_error');
    expect(entry?.message).toMatch(/timeout de rede/);
    expect(typeof entry?.latencyMs).toBe('number');
  });

  it('falha do LLMProvider em resolveConfirmation preserva o pending — usuário pode tentar confirmar de novo', async () => {
    const handler = vi.fn(async () => ({ ok: true, message: 'Todas as tarefas foram apagadas.' }));
    const registry = createActionRegistry();
    registry.register(taskDeleteAllAction(handler));
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({ kind: 'action', actionKey: 'task.delete_all', params: {}, confidence: 95 });
    await engine.handleMessage(ctx, 'apaga tudo');

    llm.queueConfirmationError(new Error('api indisponível'));
    const failed = await engine.handleMessage(ctx, 'sim');
    expect(failed.status).toBe('error');
    expect(handler).not.toHaveBeenCalled();
    expect(auditSink.entries.at(-1)?.outcome).toBe('provider_error');

    // pending sobreviveu ao erro — confirmar de novo funciona normalmente
    llm.queueConfirmation('confirmed');
    const retried = await engine.handleMessage(ctx, 'sim');
    expect(retried.status).toBe('executed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('resposta ambígua de confirmação ("unclear") também é auditada', async () => {
    const registry = createActionRegistry();
    registry.register(taskDeleteAllAction());
    const { llm, engine, auditSink } = buildEngine({ registry });

    llm.queueResolve({ kind: 'action', actionKey: 'task.delete_all', params: {}, confidence: 95 });
    await engine.handleMessage(ctx, 'apaga tudo');

    llm.queueConfirmation('unclear');
    const result = await engine.handleMessage(ctx, 'hmmm');

    expect(result.status).toBe('awaiting_confirmation');
    expect(auditSink.entries.at(-1)?.outcome).toBe('awaiting_confirmation');
  });
});
