import type { Action, ActionResult } from '../types/action.js';
import type { ExecutionContext } from '../types/context.js';
import type { ConversationState, ConversationTurn, PendingInteraction } from '../types/session.js';
import type { SessionStore } from '../types/session.js';
import type { AuditOutcome, AuditSink } from '../types/audit.js';
import type { LLMProvider } from '../types/llm.js';
import type { TranscriptionProvider } from '../types/transcription.js';
import type { TTSProvider } from '../types/tts.js';
import type { ActionRegistry } from '../registry/action-registry.js';
import type { ActionShortlister } from '../shortlist/types.js';
import { KeywordShortlister } from '../shortlist/keyword-shortlister.js';
import { DEFAULT_CONFIDENCE_THRESHOLD, isAboveThreshold } from '../resolver/confidence.js';
import { findCandidateAction } from '../resolver/candidate-cross-check.js';
import { toCandidateDescriptor } from '../resolver/to-candidate-descriptor.js';
import { defaultTemplates, type EngineTemplates } from './templates.js';

export type EngineStatus =
  | 'executed'
  | 'awaiting_confirmation'
  | 'awaiting_clarification'
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
}

export interface NavEngineConfig {
  registry: ActionRegistry;
  llmProvider: LLMProvider;
  sessionStore: SessionStore;
  auditSink: AuditSink;
  transcriptionProvider?: TranscriptionProvider;
  ttsProvider?: TTSProvider;
  /** Default: `KeywordShortlister` (léxico, sem dependência externa). */
  shortlister?: ActionShortlister;
  /** Quantas ações no máximo viram tools por turno. Default 12. */
  shortlistSize?: number;
  /** Default 70 — mesmo patamar conservador validado no zapscript. */
  confidenceThreshold?: number;
  /** Quantas rodadas de esclarecimento antes de desistir graciosamente. Default 3. */
  maxClarificationTurns?: number;
  /** Quantos turnos manter na sessão. Default 20. */
  historyLimit?: number;
  templates?: Partial<EngineTemplates>;
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
  private readonly shortlister: ActionShortlister;
  private readonly shortlistSize: number;
  private readonly confidenceThreshold: number;
  private readonly maxClarificationTurns: number;
  private readonly historyLimit: number;
  private readonly templates: EngineTemplates;

  constructor(config: NavEngineConfig) {
    this.registry = config.registry;
    this.llmProvider = config.llmProvider;
    this.sessionStore = config.sessionStore;
    this.auditSink = config.auditSink;
    this.transcriptionProvider = config.transcriptionProvider;
    this.ttsProvider = config.ttsProvider;
    this.shortlister = config.shortlister ?? new KeywordShortlister();
    this.shortlistSize = config.shortlistSize ?? 12;
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.maxClarificationTurns = config.maxClarificationTurns ?? 3;
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
    } else {
      result = await this.resolveAndAct(ctx, state, message, 0);
    }

    state.history = trimHistory([...state.history, turn('assistant', result.reply)], this.historyLimit);
    state.updatedAt = Date.now();
    await this.sessionStore.save(state);

    if (this.ttsProvider && result.reply) {
      const synthesized = await this.ttsProvider.synthesize(result.reply);
      result = { ...result, audio: { data: synthesized.audio, mimeType: synthesized.mimeType } };
    }

    return result;
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

    const confirmation = await this.llmProvider.resolveConfirmation({
      history: state.history,
      userReply: message,
      pendingActionDescription: action.description,
    });

    if (confirmation.decision === 'unclear') {
      return {
        status: 'awaiting_confirmation',
        reply: this.templates.confirmationPrompt(action, pending.params),
        action: { key: action.key, description: action.description },
      };
    }

    if (confirmation.decision === 'declined') {
      state.pending = null;
      await this.audit(ctx, 'confirmation_declined', action.key, null, pending.params, 'Usuário cancelou a confirmação.');
      return { status: 'declined', reply: 'Tudo bem, cancelado. Posso ajudar com mais alguma coisa?' };
    }

    // confirmed — defesa em profundidade: re-checa permissão e revalida params
    state.pending = null;
    const allowed = await action.checkPermission(ctx);
    if (!allowed) {
      await this.audit(ctx, 'permission_denied', action.key, null, pending.params, 'Permissão negada na reconfirmação.');
      return { status: 'error', reply: 'Você não tem permissão para executar essa ação.' };
    }

    const parsed = action.paramsSchema.safeParse(pending.params);
    if (!parsed.success) {
      await this.audit(ctx, 'execution_failed', action.key, null, pending.params, 'Parâmetros inválidos na reconfirmação.');
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

  private async resolveAndAct(
    ctx: ExecutionContext,
    state: ConversationState,
    message: string,
    priorClarificationTurns: number,
  ): Promise<EngineTurnResult> {
    const candidates = await this.registry.getCandidateActions(ctx);
    const shortlisted = await this.shortlister.shortlist(
      candidates,
      { userMessage: message, history: state.history },
      this.shortlistSize,
    );
    const descriptors = shortlisted.map(toCandidateDescriptor);

    const { decision, modelTier } = await this.llmProvider.resolveIntent({
      history: state.history,
      userMessage: message,
      candidateActions: descriptors,
    });

    if (decision.kind === 'chat') {
      state.pending = null;
      await this.audit(ctx, 'chat', null, null, null, decision.message, shortlisted, modelTier);
      return { status: 'chat', reply: decision.message };
    }

    if (decision.kind === 'out_of_scope') {
      state.pending = null;
      await this.audit(ctx, 'out_of_scope', null, null, null, decision.message, shortlisted, modelTier);
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
      await this.audit(ctx, 'awaiting_clarification', null, null, null, decision.question, shortlisted, modelTier);
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
    });
  }
}
