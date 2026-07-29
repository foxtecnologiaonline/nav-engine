import type { Action, ActionResult } from '../types/action.js';
import type { ExecutionContext } from '../types/context.js';
import type { ConversationState, ConversationTurn, PendingInteraction } from '../types/session.js';
import type { SessionStore } from '../types/session.js';
import type { AuditOutcome, AuditSink, TokenUsage } from '../types/audit.js';
import type { LLMProvider, StructuredAnswerDecision } from '../types/llm.js';
import type { TranscriptionProvider } from '../types/transcription.js';
import type { TTSProvider } from '../types/tts.js';
import type { OnboardingCompletionResult, OnboardingFlow, OnboardingFlowRegistry, OnboardingStep } from '../types/onboarding.js';
import type { ActionRegistry } from '../registry/action-registry.js';
import type { ActionShortlister } from '../shortlist/types.js';
import { KeywordShortlister } from '../shortlist/keyword-shortlister.js';
import { DEFAULT_CONFIDENCE_THRESHOLD, isAboveThreshold } from '../resolver/confidence.js';
import { findCandidateAction } from '../resolver/candidate-cross-check.js';
import { toCandidateDescriptor } from '../resolver/to-candidate-descriptor.js';
import { toAnswerJsonSchema } from '../resolver/to-answer-json-schema.js';
import { defaultTemplates, type EngineTemplates } from './templates.js';

export type EngineStatus =
  | 'executed'
  | 'awaiting_confirmation'
  | 'awaiting_clarification'
  | 'awaiting_onboarding_answer'
  | 'chat'
  | 'declined'
  | 'out_of_scope'
  | 'error';

export interface EngineTurnResult {
  status: EngineStatus;
  reply: string;
  action?: { key: string; description: string };
  executionOk?: boolean;
  navigateTo?: string;
  audio?: { data: Uint8Array; mimeType: string };
  onboarding?: { flowKey: string; stepIndex: number; totalSteps: number; completed: boolean };
}

export interface NavEngineConfig {
  registry: ActionRegistry;
  llmProvider: LLMProvider;
  sessionStore: SessionStore;
  auditSink: AuditSink;
  transcriptionProvider?: TranscriptionProvider;
  ttsProvider?: TTSProvider;
  /** Opcional — só necessário se o host for usar `startOnboarding`. */
  onboardingRegistry?: OnboardingFlowRegistry;
  /** Default: `KeywordShortlister` (léxico, sem dependência externa). */
  shortlister?: ActionShortlister;
  /** Quantas ações no máximo viram tools por turno. Default 12. */
  shortlistSize?: number;
  /** Default 70 — mesmo patamar conservador validado no zapscript. */
  confidenceThreshold?: number;
  /** Quantas rodadas de esclarecimento antes de desistir graciosamente. Default 3. */
  maxClarificationTurns?: number;
  /** Quantas tentativas por passo de onboarding antes de desistir graciosamente. Default 3. */
  maxOnboardingRetriesPerStep?: number;
  /** Quantos turnos manter na sessão. Default 20. */
  historyLimit?: number;
  templates?: Partial<EngineTemplates>;
}

/** Nunca confia cegamente em `skip`/`cancel` — reforça a política do host mesmo se a LLM tentar oferecer fora dela. */
function applyOnboardingControlPolicy(
  decision: StructuredAnswerDecision,
  allowSkip: boolean,
  allowCancel: boolean,
): StructuredAnswerDecision {
  if (decision.kind === 'skip' && !allowSkip) return { kind: 'unclear' };
  if (decision.kind === 'cancel' && !allowCancel) return { kind: 'unclear' };
  return decision;
}

function emptyState(sessionId: string): ConversationState {
  return { sessionId, history: [], pending: null, updatedAt: Date.now() };
}

function turn(role: ConversationTurn['role'], content: string): ConversationTurn {
  return { role, content, timestamp: Date.now() };
}

function trimHistory(history: ConversationTurn[], limit: number): ConversationTurn[] {
  return history.length > limit ? history.slice(history.length - limit) : history;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * O motor de navegação por IA. Único ponto de entrada por turno
 * (`handleMessage`/`handleAudio`) — decide como interpretar a mensagem
 * olhando o estado pendente da sessão primeiro (confirmação/esclarecimento
 * em aberto), e só then recai na resolução normal de intenção.
 */
export class NavEngine {
  private readonly registry: ActionRegistry;
  private readonly llmProvider: LLMProvider;
  private readonly sessionStore: SessionStore;
  private readonly auditSink: AuditSink;
  private readonly transcriptionProvider?: TranscriptionProvider;
  private readonly ttsProvider?: TTSProvider;
  private readonly onboardingRegistry?: OnboardingFlowRegistry;
  private readonly shortlister: ActionShortlister;
  private readonly shortlistSize: number;
  private readonly confidenceThreshold: number;
  private readonly maxClarificationTurns: number;
  private readonly maxOnboardingRetriesPerStep: number;
  private readonly historyLimit: number;
  private readonly templates: EngineTemplates;

  constructor(config: NavEngineConfig) {
    this.registry = config.registry;
    this.llmProvider = config.llmProvider;
    this.sessionStore = config.sessionStore;
    this.auditSink = config.auditSink;
    this.transcriptionProvider = config.transcriptionProvider;
    this.ttsProvider = config.ttsProvider;
    this.onboardingRegistry = config.onboardingRegistry;
    this.shortlister = config.shortlister ?? new KeywordShortlister();
    this.shortlistSize = config.shortlistSize ?? 12;
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.maxClarificationTurns = config.maxClarificationTurns ?? 3;
    this.maxOnboardingRetriesPerStep = config.maxOnboardingRetriesPerStep ?? 3;
    this.historyLimit = config.historyLimit ?? 20;
    this.templates = { ...defaultTemplates, ...config.templates };
  }

  async handleMessage(ctx: ExecutionContext, message: string): Promise<EngineTurnResult> {
    const state = (await this.sessionStore.get(ctx.sessionId)) ?? emptyState(ctx.sessionId);
    state.history = trimHistory([...state.history, turn('user', message)], this.historyLimit);

    let result: EngineTurnResult;
    if (state.pending?.type === 'confirmation') {
      result = await this.handleConfirmationReply(ctx, state, message);
    } else if (state.pending?.type === 'clarification') {
      result = await this.handleClarificationReply(ctx, state, message);
    } else if (state.pending?.type === 'onboarding') {
      result = await this.handleOnboardingReply(ctx, state, message);
    } else {
      result = await this.resolveAndAct(ctx, state, message, 0);
    }

    return this.finalizeTurn(ctx, state, result);
  }

  /**
   * Ponto de entrada para a IA "falar primeiro": inicia um fluxo de
   * onboarding sem nenhuma mensagem do usuário associada a este turno.
   * Sobrescreve deliberadamente qualquer `pending` pré-existente na sessão
   * — nunca dois "donos" concorrentes do próximo turno.
   */
  async startOnboarding(ctx: ExecutionContext, flowKey: string): Promise<EngineTurnResult> {
    if (!this.onboardingRegistry) {
      throw new Error('NavEngine: onboardingRegistry não configurado — não é possível iniciar onboarding.');
    }

    const state = (await this.sessionStore.get(ctx.sessionId)) ?? emptyState(ctx.sessionId);
    const flow = this.onboardingRegistry.get(flowKey);

    if (!flow || flow.steps.length === 0) {
      await this.audit(
        ctx,
        'onboarding_flow_not_found',
        null,
        null,
        null,
        `Flow "${flowKey}" não encontrado ou sem passos configurados.`,
        undefined,
        undefined,
        undefined,
        undefined,
        flowKey,
      );
      return this.finalizeTurn(ctx, state, {
        status: 'error',
        reply: 'Não consegui iniciar essa configuração agora.',
      });
    }

    const allowed = (await flow.checkPermission?.(ctx)) ?? true;
    if (!allowed) {
      await this.audit(
        ctx,
        'permission_denied',
        null,
        null,
        null,
        'Permissão negada para iniciar onboarding.',
        undefined,
        undefined,
        undefined,
        undefined,
        flowKey,
      );
      return this.finalizeTurn(ctx, state, {
        status: 'error',
        reply: 'Você não tem permissão para iniciar essa configuração.',
      });
    }

    const hadPriorPending = state.pending !== null;
    const firstStep = flow.steps[0] as OnboardingStep;
    state.pending = {
      type: 'onboarding',
      flowKey,
      stepIndex: 0,
      answers: {},
      attemptsOnCurrentStep: 0,
      createdAt: Date.now(),
    };

    await this.audit(
      ctx,
      'onboarding_started',
      null,
      null,
      null,
      hadPriorPending ? 'Onboarding iniciado, descartando pending anterior da sessão.' : 'Onboarding iniciado.',
      undefined,
      undefined,
      undefined,
      undefined,
      flowKey,
      firstStep.key,
    );

    return this.finalizeTurn(ctx, state, {
      status: 'awaiting_onboarding_answer',
      reply: this.resolveStepQuestion(firstStep, {}, ctx),
      onboarding: { flowKey, stepIndex: 0, totalSteps: flow.steps.length, completed: false },
    });
  }

  /** Persiste o turno do assistant, salva a sessão e sintetiza áudio (se configurado) — comum a todo ponto de entrada público. */
  private async finalizeTurn(
    ctx: ExecutionContext,
    state: ConversationState,
    result: EngineTurnResult,
  ): Promise<EngineTurnResult> {
    state.history = trimHistory([...state.history, turn('assistant', result.reply)], this.historyLimit);
    state.updatedAt = Date.now();
    await this.sessionStore.save(state);

    if (this.ttsProvider && result.reply) {
      const synthesized = await this.ttsProvider.synthesize(result.reply);
      return { ...result, audio: { data: synthesized.audio, mimeType: synthesized.mimeType } };
    }

    return result;
  }

  private resolveStepQuestion(
    step: OnboardingStep,
    answers: Record<string, unknown>,
    ctx: ExecutionContext,
  ): string {
    return typeof step.question === 'function' ? step.question(answers, ctx) : step.question;
  }

  async handleAudio(
    ctx: ExecutionContext,
    audio: { audio: Buffer | Uint8Array; mimeType: string },
  ): Promise<EngineTurnResult> {
    if (!this.transcriptionProvider) {
      throw new Error(
        'NavEngine: transcriptionProvider não configurado — não é possível processar áudio.',
      );
    }
    const { text } = await this.transcriptionProvider.transcribe(audio);
    return this.handleMessage(ctx, text);
  }

  private async handleConfirmationReply(
    ctx: ExecutionContext,
    state: ConversationState,
    message: string,
  ): Promise<EngineTurnResult> {
    const pending = state.pending as Extract<PendingInteraction, { type: 'confirmation' }>;
    const action = this.registry.get(pending.actionKey);
    if (!action) {
      state.pending = null;
      await this.audit(ctx, 'out_of_scope', null, null, null, 'Ação pendente não existe mais no registry.');
      return {
        status: 'out_of_scope',
        reply: 'Essa ação não está mais disponível. Vamos começar de novo?',
      };
    }

    const startedAt = Date.now();
    let confirmation: Awaited<ReturnType<LLMProvider['resolveConfirmation']>>;
    try {
      confirmation = await this.llmProvider.resolveConfirmation({
        history: state.history,
        userReply: message,
        pendingActionDescription: action.description,
      });
    } catch (err) {
      // Mantém `pending` intacto de propósito — falha transitória do provider
      // não deve descartar a confirmação em aberto; o usuário pode tentar de novo.
      const latencyMs = Date.now() - startedAt;
      await this.audit(
        ctx,
        'provider_error',
        action.key,
        null,
        pending.params,
        `Falha ao classificar confirmação: ${errorMessage(err)}`,
        undefined,
        undefined,
        latencyMs,
      );
      return { status: 'error', reply: this.templates.providerError };
    }
    const latencyMs = Date.now() - startedAt;

    if (confirmation.decision === 'unclear') {
      await this.audit(
        ctx,
        'awaiting_confirmation',
        action.key,
        null,
        pending.params,
        'Resposta ambígua à confirmação — repetindo a pergunta.',
        undefined,
        undefined,
        latencyMs,
        confirmation.usage,
      );
      return {
        status: 'awaiting_confirmation',
        reply: this.templates.confirmationPrompt(action, pending.params),
        action: { key: action.key, description: action.description },
      };
    }

    if (confirmation.decision === 'declined') {
      state.pending = null;
      await this.audit(
        ctx,
        'confirmation_declined',
        action.key,
        null,
        pending.params,
        'Usuário cancelou a confirmação.',
        undefined,
        undefined,
        latencyMs,
        confirmation.usage,
      );
      return { status: 'declined', reply: 'Tudo bem, cancelado. Posso ajudar com mais alguma coisa?' };
    }

    // confirmed — defesa em profundidade: re-checa permissão e revalida params
    state.pending = null;
    const allowed = await action.checkPermission(ctx);
    if (!allowed) {
      await this.audit(
        ctx,
        'permission_denied',
        action.key,
        null,
        pending.params,
        'Permissão negada na reconfirmação.',
        undefined,
        undefined,
        latencyMs,
        confirmation.usage,
      );
      return { status: 'error', reply: 'Você não tem permissão para executar essa ação.' };
    }

    const parsed = action.paramsSchema.safeParse(pending.params);
    if (!parsed.success) {
      await this.audit(
        ctx,
        'execution_failed',
        action.key,
        null,
        pending.params,
        'Parâmetros inválidos na reconfirmação.',
        undefined,
        undefined,
        latencyMs,
        confirmation.usage,
      );
      return { status: 'error', reply: 'Algo mudou nos dados dessa ação. Podemos tentar de novo desde o início?' };
    }

    const execResult = await this.safeExecute(action, parsed.data, ctx);
    await this.audit(
      ctx,
      execResult.ok ? 'confirmed_and_executed' : 'execution_failed',
      action.key,
      null,
      parsed.data,
      execResult.message,
      undefined,
      undefined,
      latencyMs,
      confirmation.usage,
    );
    return {
      status: 'executed',
      reply: execResult.message,
      action: { key: action.key, description: action.description },
      executionOk: execResult.ok,
      navigateTo: execResult.data?.navigateTo,
    };
  }

  private async handleClarificationReply(
    ctx: ExecutionContext,
    state: ConversationState,
    message: string,
  ): Promise<EngineTurnResult> {
    const pending = state.pending as Extract<PendingInteraction, { type: 'clarification' }>;
    if (pending.turnCount >= this.maxClarificationTurns) {
      state.pending = null;
      await this.audit(ctx, 'out_of_scope', null, null, null, 'Limite de rodadas de esclarecimento atingido.');
      return { status: 'out_of_scope', reply: this.templates.clarificationGiveUp };
    }
    return this.resolveAndAct(ctx, state, message, pending.turnCount);
  }

  /**
   * Trata a resposta do usuário a um passo de onboarding em andamento.
   * Nunca reabre `resolveAndAct`/`resolveIntent` enquanto onboarding está em
   * curso — a única saída fechada é `cancel` (quando `flow.allowCancel`
   * permite) ou `skip` (quando `step.optional` permite), ambas decisões de
   * controle, nunca uma reinterpretação livre da mensagem pela LLM.
   */
  private async handleOnboardingReply(
    ctx: ExecutionContext,
    state: ConversationState,
    message: string,
  ): Promise<EngineTurnResult> {
    const pending = state.pending as Extract<PendingInteraction, { type: 'onboarding' }>;
    const flow = this.onboardingRegistry?.get(pending.flowKey);

    if (!flow) {
      state.pending = null;
      await this.audit(
        ctx,
        'onboarding_flow_not_found',
        null,
        null,
        null,
        'Flow do onboarding em andamento não existe mais no registry.',
        undefined,
        undefined,
        undefined,
        undefined,
        pending.flowKey,
      );
      return { status: 'error', reply: 'Essa configuração não está mais disponível.' };
    }

    const step = flow.steps[pending.stepIndex];
    if (!step) {
      // Defensivo — não deveria acontecer (stepIndex sempre controlado pelo próprio engine).
      state.pending = null;
      await this.audit(
        ctx,
        'onboarding_flow_not_found',
        null,
        null,
        null,
        'stepIndex do onboarding fora dos limites do flow.',
        undefined,
        undefined,
        undefined,
        undefined,
        pending.flowKey,
      );
      return { status: 'error', reply: this.templates.providerError };
    }

    if (!this.llmProvider.extractStructuredAnswer) {
      throw new Error(
        'NavEngine: llmProvider não implementa extractStructuredAnswer — necessário para onboarding.',
      );
    }

    const allowSkip = step.optional === true;
    const allowCancel = flow.allowCancel !== false;

    const startedAt = Date.now();
    let decision: StructuredAnswerDecision;
    let usage: TokenUsage | undefined;
    try {
      const extraction = await this.llmProvider.extractStructuredAnswer({
        history: state.history,
        question: this.resolveStepQuestion(step, pending.answers, ctx),
        userReply: message,
        answerJsonSchema: toAnswerJsonSchema(step),
        examples: step.examples,
        allowSkip,
        allowCancel,
      });
      decision = applyOnboardingControlPolicy(extraction.decision, allowSkip, allowCancel);
      usage = extraction.usage;
    } catch (err) {
      // Mantém `pending` intacto — falha transitória do provider não deve
      // descartar o progresso do onboarding; o usuário pode tentar de novo.
      const latencyMs = Date.now() - startedAt;
      await this.audit(
        ctx,
        'provider_error',
        null,
        null,
        null,
        `Falha ao extrair resposta de onboarding: ${errorMessage(err)}`,
        undefined,
        undefined,
        latencyMs,
        undefined,
        pending.flowKey,
        step.key,
      );
      return { status: 'error', reply: this.templates.providerError };
    }
    const latencyMs = Date.now() - startedAt;

    if (decision.kind === 'cancel') {
      state.pending = null;
      await this.audit(
        ctx,
        'onboarding_cancelled',
        null,
        null,
        pending.answers,
        'Usuário cancelou o onboarding.',
        undefined,
        undefined,
        latencyMs,
        usage,
        pending.flowKey,
        step.key,
      );
      return { status: 'declined', reply: this.templates.onboardingCancelled };
    }

    if (decision.kind === 'skip') {
      return this.advanceOnboarding(
        ctx,
        state,
        flow,
        pending,
        step,
        latencyMs,
        usage,
        'onboarding_step_skipped',
        'Passo pulado a pedido do usuário.',
      );
    }

    if (decision.kind === 'answer') {
      const parsed = step.answerSchema.safeParse(decision.value);
      if (parsed.success) {
        return this.advanceOnboarding(
          ctx,
          state,
          flow,
          pending,
          step,
          latencyMs,
          usage,
          'onboarding_step_answered',
          'Resposta registrada.',
          step.key,
          parsed.data,
        );
      }
      // zod inválido — cai para o bloco de tentativa consumida abaixo, mesma trilha de 'unclear'.
    }

    // decision.kind === 'unclear', ou 'answer' com zod inválido
    const attempts = pending.attemptsOnCurrentStep + 1;
    if (attempts >= this.maxOnboardingRetriesPerStep) {
      state.pending = null;
      await this.audit(
        ctx,
        'onboarding_abandoned',
        null,
        null,
        pending.answers,
        'Limite de tentativas do passo atingido.',
        undefined,
        undefined,
        latencyMs,
        usage,
        pending.flowKey,
        step.key,
      );
      return { status: 'out_of_scope', reply: this.templates.onboardingGiveUp };
    }

    state.pending = { ...pending, attemptsOnCurrentStep: attempts };
    await this.audit(
      ctx,
      'onboarding_answer_unclear',
      null,
      null,
      pending.answers,
      'Resposta ambígua ou inválida — repetindo a pergunta.',
      undefined,
      undefined,
      latencyMs,
      usage,
      pending.flowKey,
      step.key,
    );
    return {
      status: 'awaiting_onboarding_answer',
      reply: this.resolveStepQuestion(step, pending.answers, ctx),
      onboarding: { flowKey: pending.flowKey, stepIndex: pending.stepIndex, totalSteps: flow.steps.length, completed: false },
    };
  }

  /** Avança para o próximo passo (ou completa o flow, se este era o último), gravando a resposta se houver. */
  private async advanceOnboarding(
    ctx: ExecutionContext,
    state: ConversationState,
    flow: OnboardingFlow,
    pending: Extract<PendingInteraction, { type: 'onboarding' }>,
    currentStep: OnboardingStep,
    latencyMs: number,
    usage: TokenUsage | undefined,
    outcome: AuditOutcome,
    auditMessage: string,
    answerKey?: string,
    answerValue?: unknown,
  ): Promise<EngineTurnResult> {
    const answers =
      answerKey !== undefined ? { ...pending.answers, [answerKey]: answerValue } : pending.answers;
    const nextIndex = pending.stepIndex + 1;

    await this.audit(
      ctx,
      outcome,
      null,
      null,
      answers,
      auditMessage,
      undefined,
      undefined,
      latencyMs,
      usage,
      pending.flowKey,
      currentStep.key,
    );

    if (nextIndex >= flow.steps.length) {
      state.pending = null;
      const completion = await this.safeCompleteOnboarding(flow, answers, ctx);
      await this.audit(
        ctx,
        completion.ok ? 'onboarding_completed' : 'onboarding_completion_failed',
        null,
        null,
        answers,
        completion.message,
        undefined,
        undefined,
        undefined,
        undefined,
        pending.flowKey,
      );
      return {
        status: completion.ok ? 'executed' : 'error',
        reply: completion.message,
        navigateTo: completion.data?.navigateTo,
        onboarding: { flowKey: pending.flowKey, stepIndex: nextIndex, totalSteps: flow.steps.length, completed: true },
      };
    }

    const nextStep = flow.steps[nextIndex];
    if (!nextStep) {
      // Defensivo — garantido pelo check acima (nextIndex < flow.steps.length).
      state.pending = null;
      return { status: 'error', reply: this.templates.providerError };
    }

    state.pending = { ...pending, stepIndex: nextIndex, answers, attemptsOnCurrentStep: 0 };
    return {
      status: 'awaiting_onboarding_answer',
      reply: this.resolveStepQuestion(nextStep, answers, ctx),
      onboarding: { flowKey: pending.flowKey, stepIndex: nextIndex, totalSteps: flow.steps.length, completed: false },
    };
  }

  /** Mesmo tratamento resiliente de `safeExecute`, mas para o callback `onComplete` do host (categoria equivalente: lógica de negócio fora do motor). */
  private async safeCompleteOnboarding(
    flow: OnboardingFlow,
    answers: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<OnboardingCompletionResult> {
    try {
      return await flow.onComplete(answers, ctx);
    } catch {
      return {
        ok: false,
        message: 'Terminamos as perguntas, mas não consegui salvar as informações agora. Tente novamente em instantes.',
      };
    }
  }

  private async resolveAndAct(
    ctx: ExecutionContext,
    state: ConversationState,
    message: string,
    priorClarificationTurns: number,
  ): Promise<EngineTurnResult> {
    const startedAt = Date.now();
    let shortlisted: Action[];
    let decision: Awaited<ReturnType<LLMProvider['resolveIntent']>>['decision'];
    let modelTier: 'fast' | 'precise' | undefined;
    let usage: TokenUsage | undefined;

    try {
      const candidates = await this.registry.getCandidateActions(ctx);
      shortlisted = await this.shortlister.shortlist(
        candidates,
        { userMessage: message, history: state.history },
        this.shortlistSize,
      );
      const descriptors = shortlisted.map(toCandidateDescriptor);

      const resolved = await this.llmProvider.resolveIntent({
        history: state.history,
        userMessage: message,
        candidateActions: descriptors,
      });
      decision = resolved.decision;
      modelTier = resolved.modelTier;
      usage = resolved.usage;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      await this.audit(
        ctx,
        'provider_error',
        null,
        null,
        null,
        `Falha ao resolver intenção: ${errorMessage(err)}`,
        undefined,
        undefined,
        latencyMs,
      );
      return { status: 'error', reply: this.templates.providerError };
    }

    const latencyMs = Date.now() - startedAt;

    if (decision.kind === 'chat') {
      state.pending = null;
      await this.audit(ctx, 'chat', null, null, null, decision.message, shortlisted, modelTier, latencyMs, usage);
      return { status: 'chat', reply: decision.message };
    }

    if (decision.kind === 'out_of_scope') {
      state.pending = null;
      await this.audit(
        ctx,
        'out_of_scope',
        null,
        null,
        null,
        decision.message,
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return { status: 'out_of_scope', reply: decision.message };
    }

    if (decision.kind === 'clarify') {
      state.pending = {
        type: 'clarification',
        originalMessage: message,
        ambiguousActionKeys: decision.ambiguousActionKeys,
        turnCount: priorClarificationTurns + 1,
        createdAt: Date.now(),
      };
      await this.audit(
        ctx,
        'awaiting_clarification',
        null,
        null,
        null,
        decision.question,
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return { status: 'awaiting_clarification', reply: decision.question };
    }

    // decision.kind === 'action'
    const action = findCandidateAction(shortlisted, decision.actionKey);
    if (!action) {
      state.pending = null;
      await this.audit(
        ctx,
        'hallucination_blocked',
        decision.actionKey,
        decision.confidence,
        decision.params,
        'actionKey retornada pela LLM não estava no shortlist enviado.',
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return { status: 'out_of_scope', reply: 'Não encontrei uma ação correspondente ao que você pediu.' };
    }

    if (!isAboveThreshold(decision.confidence, this.confidenceThreshold)) {
      state.pending = {
        type: 'clarification',
        originalMessage: message,
        ambiguousActionKeys: [action.key],
        turnCount: priorClarificationTurns + 1,
        createdAt: Date.now(),
      };
      await this.audit(
        ctx,
        'awaiting_clarification',
        action.key,
        decision.confidence,
        decision.params,
        'Confiança abaixo do limiar configurado.',
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return {
        status: 'awaiting_clarification',
        reply: `Você quis dizer "${action.description}"? Pode confirmar ou dar mais detalhes?`,
      };
    }

    const parsed = action.paramsSchema.safeParse(decision.params);
    if (!parsed.success) {
      state.pending = {
        type: 'clarification',
        originalMessage: message,
        ambiguousActionKeys: [action.key],
        turnCount: priorClarificationTurns + 1,
        createdAt: Date.now(),
      };
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      await this.audit(
        ctx,
        'awaiting_clarification',
        action.key,
        decision.confidence,
        decision.params,
        `Parâmetros inválidos: ${issues}`,
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return {
        status: 'awaiting_clarification',
        reply: `Preciso de mais informação para "${action.description}": ${issues}`,
      };
    }

    if (action.riskLevel === 'blocked') {
      // Não deveria ocorrer — getCandidateActions já excluiu blocked por padrão.
      state.pending = null;
      await this.audit(
        ctx,
        'hallucination_blocked',
        action.key,
        decision.confidence,
        parsed.data,
        'Ação blocked retornada apesar de excluída dos candidatos.',
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return { status: 'out_of_scope', reply: 'Não posso ajudar com isso.' };
    }

    if (action.riskLevel === 'confirm') {
      state.pending = {
        type: 'confirmation',
        actionKey: action.key,
        params: parsed.data,
        createdAt: Date.now(),
      };
      await this.audit(
        ctx,
        'awaiting_confirmation',
        action.key,
        decision.confidence,
        parsed.data,
        'Aguardando confirmação explícita do usuário.',
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return {
        status: 'awaiting_confirmation',
        reply: this.templates.confirmationPrompt(action, parsed.data),
        action: { key: action.key, description: action.description },
      };
    }

    // riskLevel === 'safe'
    state.pending = null;
    const allowed = await action.checkPermission(ctx);
    if (!allowed) {
      await this.audit(
        ctx,
        'permission_denied',
        action.key,
        decision.confidence,
        parsed.data,
        'Permissão negada na segunda checagem (defesa em profundidade).',
        shortlisted,
        modelTier,
        latencyMs,
        usage,
      );
      return { status: 'error', reply: 'Você não tem permissão para executar essa ação.' };
    }

    const execResult = await this.safeExecute(action, parsed.data, ctx);
    await this.audit(
      ctx,
      execResult.ok ? 'executed' : 'execution_failed',
      action.key,
      decision.confidence,
      parsed.data,
      execResult.message,
      shortlisted,
      modelTier,
      latencyMs,
      usage,
    );
    return {
      status: 'executed',
      reply: execResult.message,
      action: { key: action.key, description: action.description },
      executionOk: execResult.ok,
      navigateTo: execResult.data?.navigateTo,
    };
  }

  private async safeExecute(
    action: Action,
    params: unknown,
    ctx: ExecutionContext,
  ): Promise<ActionResult> {
    try {
      return await action.handler(params, ctx);
    } catch {
      return {
        ok: false,
        message: `Não consegui concluir "${action.description}" agora. Tente novamente em instantes.`,
      };
    }
  }

  private async audit(
    ctx: ExecutionContext,
    outcome: AuditOutcome,
    actionKey: string | null,
    confidence: number | null,
    params: unknown | null,
    message: string,
    shortlisted?: Action[],
    modelTier?: 'fast' | 'precise',
    latencyMs?: number,
    tokenUsage?: TokenUsage,
    onboardingFlowKey?: string,
    onboardingStepKey?: string,
  ): Promise<void> {
    await this.auditSink.record({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      actionKey,
      outcome,
      confidence,
      params: params ?? null,
      message,
      timestamp: Date.now(),
      shortlistedKeys: shortlisted?.map((a) => a.key),
      modelTier,
      latencyMs,
      tokenUsage,
      onboardingFlowKey,
      onboardingStepKey,
    });
  }
}
