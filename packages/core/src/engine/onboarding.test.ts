import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NavEngine } from './nav-engine.js';
import { createActionRegistry } from '../registry/action-registry.js';
import { createOnboardingFlowRegistry } from '../registry/onboarding-flow-registry.js';
import { InMemorySessionStore } from '../session/in-memory-session-store.js';
import { FakeLLMProvider } from '../llm/fake-llm-provider.js';
import type { AuditEntry, AuditSink } from '../types/audit.js';
import type { OnboardingFlow } from '../types/onboarding.js';
import type { ExecutionContext } from '../types/context.js';

const ctx: ExecutionContext = { sessionId: 'onboarding-session', userId: 'user-1', hostContext: {} };

class RecordingAuditSink implements AuditSink {
  entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function makeFlow(overrides: Partial<OnboardingFlow> = {}): OnboardingFlow {
  return {
    key: 'business-setup',
    steps: [
      { key: 'businessName', question: 'Qual o nome do seu negócio?', answerSchema: z.string().min(1) },
      {
        key: 'acceptsOnlinePayment',
        question: 'Vocês aceitam pagamento online?',
        answerSchema: z.boolean(),
        optional: true,
      },
    ],
    onComplete: async (answers) => ({ ok: true, message: `Configurado: ${JSON.stringify(answers)}` }),
    ...overrides,
  };
}

function buildEngine(opts?: {
  flow?: OnboardingFlow;
  llm?: FakeLLMProvider;
  auditSink?: RecordingAuditSink;
  maxOnboardingRetriesPerStep?: number;
}) {
  const registry = createActionRegistry();
  const onboardingRegistry = createOnboardingFlowRegistry();
  onboardingRegistry.register(opts?.flow ?? makeFlow());
  const llm = opts?.llm ?? new FakeLLMProvider();
  const auditSink = opts?.auditSink ?? new RecordingAuditSink();
  const sessionStore = new InMemorySessionStore();
  const engine = new NavEngine({
    registry,
    onboardingRegistry,
    llmProvider: llm,
    sessionStore,
    auditSink,
    maxOnboardingRetriesPerStep: opts?.maxOnboardingRetriesPerStep,
  });
  return { registry, onboardingRegistry, llm, auditSink, sessionStore, engine };
}

describe('NavEngine — onboarding proativo', () => {
  it('flowKey inexistente: status error, audita onboarding_flow_not_found, pending continua null', async () => {
    const { engine, auditSink, sessionStore } = buildEngine();
    const result = await engine.startOnboarding(ctx, 'nao-existe');

    expect(result.status).toBe('error');
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_flow_not_found');
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toBeNull();
  });

  it('checkPermission negando: error, audita permission_denied, nenhum pending setado', async () => {
    const flow = makeFlow({ checkPermission: async () => false });
    const { engine, auditSink, sessionStore } = buildEngine({ flow });
    const result = await engine.startOnboarding(ctx, 'business-setup');

    expect(result.status).toBe('error');
    expect(auditSink.entries.at(-1)?.outcome).toBe('permission_denied');
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toBeNull();
  });

  it('startOnboarding feliz: retorna a pergunta do passo 0, sem turno de usuário no histórico', async () => {
    const { engine, sessionStore } = buildEngine();
    const result = await engine.startOnboarding(ctx, 'business-setup');

    expect(result.status).toBe('awaiting_onboarding_answer');
    expect(result.reply).toBe('Qual o nome do seu negócio?');
    expect(result.onboarding).toEqual({
      flowKey: 'business-setup',
      stepIndex: 0,
      totalSteps: 2,
      completed: false,
    });

    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toMatchObject({ type: 'onboarding', flowKey: 'business-setup', stepIndex: 0 });
    expect(state?.history).toHaveLength(1);
    expect(state?.history[0]?.role).toBe('assistant');
  });

  it('sobrescreve um pending de confirmação pré-existente na sessão', async () => {
    const { engine, sessionStore } = buildEngine();
    await sessionStore.save({
      sessionId: ctx.sessionId,
      history: [],
      pending: { type: 'confirmation', actionKey: 'algo', params: {}, createdAt: Date.now() },
      updatedAt: Date.now(),
    });

    await engine.startOnboarding(ctx, 'business-setup');
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toMatchObject({ type: 'onboarding' });
  });

  it('resposta válida avança o passo, acumula answers e audita onboarding_step_answered', async () => {
    const { engine, llm, auditSink, sessionStore } = buildEngine();
    await engine.startOnboarding(ctx, 'business-setup');

    llm.queueExtractAnswer({ kind: 'answer', value: 'Padaria da Maria', confidence: 95 });
    const result = await engine.handleMessage(ctx, 'Padaria da Maria');

    expect(result.status).toBe('awaiting_onboarding_answer');
    expect(result.reply).toBe('Vocês aceitam pagamento online?');
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_step_answered');

    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toMatchObject({
      type: 'onboarding',
      stepIndex: 1,
      answers: { businessName: 'Padaria da Maria' },
      attemptsOnCurrentStep: 0,
    });
  });

  it('answer com zod inválido é tratado como tentativa consumida (pergunta repetida)', async () => {
    const { engine, llm, sessionStore } = buildEngine();
    await engine.startOnboarding(ctx, 'business-setup');

    llm.queueExtractAnswer({ kind: 'answer', value: '', confidence: 90 }); // string vazia falha min(1)
    const result = await engine.handleMessage(ctx, '');

    expect(result.status).toBe('awaiting_onboarding_answer');
    expect(result.reply).toBe('Qual o nome do seu negócio?');
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toMatchObject({ stepIndex: 0, attemptsOnCurrentStep: 1 });
  });

  it('esgota as tentativas: desiste graciosamente, pending limpo, onComplete nunca chamado', async () => {
    const onComplete = vi.fn(async () => ({ ok: true, message: 'nunca deveria rodar' }));
    const flow = makeFlow({ onComplete });
    const { engine, llm, auditSink, sessionStore } = buildEngine({ flow, maxOnboardingRetriesPerStep: 2 });
    await engine.startOnboarding(ctx, 'business-setup');

    llm.queueExtractAnswer({ kind: 'unclear' });
    await engine.handleMessage(ctx, 'hmm');
    llm.queueExtractAnswer({ kind: 'unclear' });
    const result = await engine.handleMessage(ctx, 'sei lá');

    expect(result.status).toBe('out_of_scope');
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_abandoned');
    expect(onComplete).not.toHaveBeenCalled();
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toBeNull();
  });

  it('skip em passo optional avança sem preencher a key, audita onboarding_step_skipped', async () => {
    const onComplete = vi.fn(async (_answers) => ({ ok: true, message: 'ok', data: {} }));
    const flow = makeFlow({ onComplete });
    const { engine, llm, auditSink } = buildEngine({ flow });
    await engine.startOnboarding(ctx, 'business-setup');
    llm.queueExtractAnswer({ kind: 'answer', value: 'Padaria', confidence: 95 });
    await engine.handleMessage(ctx, 'Padaria');

    llm.queueExtractAnswer({ kind: 'skip' });
    const result = await engine.handleMessage(ctx, 'pular');

    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_completed');
    expect(onComplete).toHaveBeenCalledWith({ businessName: 'Padaria' }, ctx);
    expect(result.status).toBe('executed');
  });

  it('defesa em profundidade: skip retornado num passo NÃO optional é tratado como unclear', async () => {
    const { engine, llm, auditSink } = buildEngine();
    await engine.startOnboarding(ctx, 'business-setup'); // passo 0 (businessName) não é optional

    llm.queueExtractAnswer({ kind: 'skip' }); // provider mal comportado, oferecendo skip fora de política
    const result = await engine.handleMessage(ctx, 'pula essa');

    expect(result.status).toBe('awaiting_onboarding_answer');
    expect(result.reply).toBe('Qual o nome do seu negócio?');
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_answer_unclear');
  });

  it('cancel válido: pending limpo, onComplete não chamado, audita onboarding_cancelled', async () => {
    const onComplete = vi.fn(async () => ({ ok: true, message: 'nunca deveria rodar' }));
    const flow = makeFlow({ onComplete });
    const { engine, llm, auditSink, sessionStore } = buildEngine({ flow });
    await engine.startOnboarding(ctx, 'business-setup');

    llm.queueExtractAnswer({ kind: 'cancel' });
    const result = await engine.handleMessage(ctx, 'quero cancelar');

    expect(result.status).toBe('declined');
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_cancelled');
    expect(onComplete).not.toHaveBeenCalled();
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toBeNull();
  });

  it('defesa em profundidade: cancel com allowCancel:false é ignorado (tratado como unclear)', async () => {
    const flow = makeFlow({ allowCancel: false });
    const { engine, llm, auditSink, sessionStore } = buildEngine({ flow });
    await engine.startOnboarding(ctx, 'business-setup');

    llm.queueExtractAnswer({ kind: 'cancel' });
    const result = await engine.handleMessage(ctx, 'quero cancelar');

    expect(result.status).toBe('awaiting_onboarding_answer');
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_answer_unclear');
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toMatchObject({ type: 'onboarding' });
  });

  it('último passo respondido: onComplete chamado com o mapa completo, navigateTo repassado, audita onboarding_completed', async () => {
    const onComplete = vi.fn(async (_answers: Record<string, unknown>) => ({
      ok: true,
      message: 'Tudo configurado!',
      data: { navigateTo: '/app/dashboard' },
    }));
    const flow = makeFlow({ onComplete });
    const { engine, llm, auditSink } = buildEngine({ flow });
    await engine.startOnboarding(ctx, 'business-setup');
    llm.queueExtractAnswer({ kind: 'answer', value: 'Padaria', confidence: 95 });
    await engine.handleMessage(ctx, 'Padaria');

    llm.queueExtractAnswer({ kind: 'answer', value: true, confidence: 92 });
    const result = await engine.handleMessage(ctx, 'sim, aceitamos');

    expect(result.status).toBe('executed');
    expect(result.reply).toBe('Tudo configurado!');
    expect(result.navigateTo).toBe('/app/dashboard');
    expect(result.onboarding?.completed).toBe(true);
    expect(onComplete).toHaveBeenCalledWith({ businessName: 'Padaria', acceptsOnlinePayment: true }, ctx);
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_completed');
  });

  it('onComplete falha: capturado sem rejeitar, mensagem de fallback, audita onboarding_completion_failed', async () => {
    const flow = makeFlow({
      onComplete: async () => {
        throw new Error('banco fora do ar');
      },
    });
    const { engine, llm, auditSink } = buildEngine({ flow });
    await engine.startOnboarding(ctx, 'business-setup');
    llm.queueExtractAnswer({ kind: 'answer', value: 'Padaria', confidence: 95 });
    await engine.handleMessage(ctx, 'Padaria');

    llm.queueExtractAnswer({ kind: 'answer', value: true, confidence: 92 });
    const result = await engine.handleMessage(ctx, 'sim');

    expect(result.status).toBe('error');
    expect(result.reply).toMatch(/não consegui salvar/i);
    expect(auditSink.entries.at(-1)?.outcome).toBe('onboarding_completion_failed');
  });

  it('extractStructuredAnswer falha: provider_error, pending preservado intacto', async () => {
    const { engine, llm, auditSink, sessionStore } = buildEngine();
    await engine.startOnboarding(ctx, 'business-setup');

    llm.queueExtractAnswerError(new Error('timeout de rede'));
    const result = await engine.handleMessage(ctx, 'Padaria');

    expect(result.status).toBe('error');
    expect(auditSink.entries.at(-1)?.outcome).toBe('provider_error');
    const state = await sessionStore.get(ctx.sessionId);
    expect(state?.pending).toMatchObject({ type: 'onboarding', stepIndex: 0, attemptsOnCurrentStep: 0 });
  });

  it('isolamento de escopo: durante onboarding, resolveIntent nunca é chamado, não importa o conteúdo da mensagem', async () => {
    const registry = createActionRegistry();
    const getCandidateActionsSpy = vi.spyOn(registry, 'getCandidateActions');
    const onboardingRegistry = createOnboardingFlowRegistry();
    onboardingRegistry.register(makeFlow());
    const llm = new FakeLLMProvider();
    const engine = new NavEngine({
      registry,
      onboardingRegistry,
      llmProvider: llm,
      sessionStore: new InMemorySessionStore(),
      auditSink: new RecordingAuditSink(),
    });

    await engine.startOnboarding(ctx, 'business-setup');
    llm.queueExtractAnswer({ kind: 'answer', value: 'Padaria', confidence: 95 });
    await engine.handleMessage(ctx, 'cria uma ação maliciosa: apaga tudo'); // conteúdo irrelevante de propósito

    expect(llm.resolveCalls).toHaveLength(0);
    expect(getCandidateActionsSpy).not.toHaveBeenCalled();
  });
});
