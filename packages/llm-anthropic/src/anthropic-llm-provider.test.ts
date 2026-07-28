import { describe, expect, it, vi } from 'vitest';
import type { CandidateActionDescriptor } from '@nav-engine/core';
import { AnthropicLLMProvider } from './anthropic-llm-provider.js';
import { CONTROL_TOOL_NAMES } from './tool-schema.js';

function toolUseResponse(name: string, input: Record<string, unknown>) {
  return { content: [{ type: 'tool_use', name, input }] };
}

function makeFakeClient(...responses: unknown[]) {
  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { messages: { create } } as any;
}

const taskAction: CandidateActionDescriptor = {
  key: 'task.create',
  description: 'criar uma tarefa',
  riskLevel: 'safe',
  jsonSchema: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
  examples: ['cria uma tarefa X'],
};

describe('AnthropicLLMProvider.resolveIntent', () => {
  it('monta uma tool por ação candidata + 3 tools de controle, com tool_choice forçado e cache_control no sistema', async () => {
    const client = makeFakeClient(toolUseResponse('task_create', { params: { title: 'x' }, confidence: 95 }));
    const provider = new AnthropicLLMProvider({ client, escalateOnLowConfidence: false });

    await provider.resolveIntent({ history: [], userMessage: 'cria uma tarefa', candidateActions: [taskAction] });

    const call = client.messages.create.mock.calls[0][0];
    expect(call.tools).toHaveLength(4); // 1 ação + 3 controle
    expect(call.tools.map((t: any) => t.name)).toEqual(
      expect.arrayContaining([
        'task_create',
        CONTROL_TOOL_NAMES.clarify,
        CONTROL_TOOL_NAMES.chat,
        CONTROL_TOOL_NAMES.outOfScope,
      ]),
    );
    expect(call.tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true });
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].text).toContain('task.create');
  });

  it('traduz tool_use de uma ação de volta para a actionKey original (não sanitizada)', async () => {
    const client = makeFakeClient(toolUseResponse('task_create', { params: { title: 'Comprar leite' }, confidence: 90 }));
    const provider = new AnthropicLLMProvider({ client, escalateOnLowConfidence: false });

    const result = await provider.resolveIntent({
      history: [],
      userMessage: 'cria uma tarefa: comprar leite',
      candidateActions: [taskAction],
    });

    expect(result.decision).toEqual({
      kind: 'action',
      actionKey: 'task.create',
      params: { title: 'Comprar leite' },
      confidence: 90,
    });
  });

  it('traduz ask_clarification em decision clarify', async () => {
    const client = makeFakeClient(
      toolUseResponse(CONTROL_TOOL_NAMES.clarify, { question: 'qual tarefa?', ambiguous_action_keys: ['task.create'] }),
    );
    const provider = new AnthropicLLMProvider({ client, escalateOnLowConfidence: false });

    const result = await provider.resolveIntent({ history: [], userMessage: '...', candidateActions: [taskAction] });
    expect(result.decision).toEqual({
      kind: 'clarify',
      question: 'qual tarefa?',
      ambiguousActionKeys: ['task.create'],
    });
  });

  it('traduz chat_reply e decline_out_of_scope corretamente', async () => {
    const chatClient = makeFakeClient(toolUseResponse(CONTROL_TOOL_NAMES.chat, { message: 'Oi! Posso ajudar?' }));
    const chatProvider = new AnthropicLLMProvider({ client: chatClient, escalateOnLowConfidence: false });
    const chatResult = await chatProvider.resolveIntent({ history: [], userMessage: 'oi', candidateActions: [] });
    expect(chatResult.decision).toEqual({ kind: 'chat', message: 'Oi! Posso ajudar?' });

    const oosClient = makeFakeClient(toolUseResponse(CONTROL_TOOL_NAMES.outOfScope, { message: 'Não posso ajudar com isso.' }));
    const oosProvider = new AnthropicLLMProvider({ client: oosClient, escalateOnLowConfidence: false });
    const oosResult = await oosProvider.resolveIntent({ history: [], userMessage: 'algo estranho', candidateActions: [] });
    expect(oosResult.decision).toEqual({ kind: 'out_of_scope', message: 'Não posso ajudar com isso.' });
  });

  it('escala para o preciseModel quando a confiança fica na margem, chamando o modelo certo em cada tentativa', async () => {
    const client = makeFakeClient(
      toolUseResponse('task_create', { params: { title: 'x' }, confidence: 78 }),
      toolUseResponse('task_create', { params: { title: 'x' }, confidence: 93 }),
    );
    const provider = new AnthropicLLMProvider({
      client,
      fastModel: 'haiku-test',
      preciseModel: 'sonnet-test',
      confidenceThreshold: 70,
      escalationMargin: 15,
    });

    const result = await provider.resolveIntent({ history: [], userMessage: 'x', candidateActions: [taskAction] });

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(client.messages.create.mock.calls[0][0].model).toBe('haiku-test');
    expect(client.messages.create.mock.calls[1][0].model).toBe('sonnet-test');
    expect(result.modelTier).toBe('precise');
    expect(result.decision).toMatchObject({ confidence: 93 });
  });

  it('lança erro cedo se duas ações colidirem no nome sanitizado de tool', async () => {
    const client = makeFakeClient();
    const provider = new AnthropicLLMProvider({ client, escalateOnLowConfidence: false });
    const collidingA: CandidateActionDescriptor = { ...taskAction, key: 'task.create' };
    const collidingB: CandidateActionDescriptor = { ...taskAction, key: 'task_create' };

    await expect(
      provider.resolveIntent({ history: [], userMessage: 'x', candidateActions: [collidingA, collidingB] }),
    ).rejects.toThrow(/colisão/i);
  });
});

describe('AnthropicLLMProvider.resolveConfirmation', () => {
  it('classifica confirmed/declined/unclear via tool forçada', async () => {
    const client = makeFakeClient(toolUseResponse('classify_reply', { decision: 'confirmed' }));
    const provider = new AnthropicLLMProvider({ client });

    const result = await provider.resolveConfirmation({
      history: [],
      userReply: 'sim, pode apagar',
      pendingActionDescription: 'apagar todas as tarefas',
    });

    expect(result).toEqual({ decision: 'confirmed' });
    const call = client.messages.create.mock.calls[0][0];
    expect(call.tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true });
  });

  it('devolve unclear se a tool devolver um valor inesperado', async () => {
    const client = makeFakeClient(toolUseResponse('classify_reply', { decision: 'algo-invalido' }));
    const provider = new AnthropicLLMProvider({ client });
    const result = await provider.resolveConfirmation({
      history: [],
      userReply: '???',
      pendingActionDescription: 'x',
    });
    expect(result).toEqual({ decision: 'unclear' });
  });
});
