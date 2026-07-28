export type { Action, ActionResult, RiskLevel } from './types/action.js';
export type { ExecutionContext } from './types/context.js';
export type {
  ConversationTurn,
  ConversationState,
  PendingInteraction,
  SessionStore,
} from './types/session.js';
export type {
  LLMProvider,
  LLMDecision,
  LLMResolveRequest,
  LLMResolveResponse,
  LLMConfirmationRequest,
  LLMConfirmationResponse,
  ConfirmationDecision,
  CandidateActionDescriptor,
} from './types/llm.js';
export type { TranscriptionProvider } from './types/transcription.js';
export type { TTSProvider } from './types/tts.js';
export type { AuditOutcome, AuditEntry, AuditSink } from './types/audit.js';
export type { ResolverResult } from './types/resolver-result.js';

export { createActionRegistry, type ActionRegistry, type GetCandidateActionsOptions } from './registry/action-registry.js';
export { defineNavigationAction, type DefineNavigationActionInput } from './registry/navigation-action.js';

export { KeywordShortlister } from './shortlist/keyword-shortlister.js';
export type { ActionShortlister, ShortlistQuery } from './shortlist/types.js';

export { buildSystemPrompt, type PromptCatalogEntry } from './resolver/prompt-builder.js';
export { DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_ESCALATION_MARGIN, isAboveThreshold } from './resolver/confidence.js';
export { findCandidateAction } from './resolver/candidate-cross-check.js';
export { toCandidateDescriptor } from './resolver/to-candidate-descriptor.js';

export { InMemorySessionStore } from './session/in-memory-session-store.js';
export { ConsoleAuditSink } from './audit/console-audit-sink.js';
export { FakeLLMProvider } from './llm/fake-llm-provider.js';

export { NavEngine, type NavEngineConfig, type EngineTurnResult, type EngineStatus } from './engine/nav-engine.js';
export { defaultTemplates, type EngineTemplates } from './engine/templates.js';

export { DuplicateActionKeyError } from './errors.js';
