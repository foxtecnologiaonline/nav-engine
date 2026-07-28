import type { RiskLevel } from './action.js';
import type { TokenUsage } from './audit.js';
import type { ConversationTurn } from './session.js';

/** Descreve uma ação candidata (já filtrada por permissão e shortlist) para o LLMProvider. */
export interface CandidateActionDescriptor {
  key: string;
  description: string;
  riskLevel: RiskLevel;
  /** JSON Schema derivado do `paramsSchema` (zod) da ação. */
  jsonSchema: Record<string, unknown>;
  examples?: string[];
}

/**
 * União discriminada do que o LLM pode decidir. Note: NÃO existe variante de
 * confirmação aqui — decidir se uma ação precisa de confirmação é
 * responsabilidade exclusiva do `riskLevel` no registry, nunca da LLM.
 */
export type LLMDecision =
  | { kind: 'action'; actionKey: string; params: unknown; confidence: number }
  | { kind: 'clarify'; question: string; ambiguousActionKeys?: string[] }
  | { kind: 'chat'; message: string }
  | { kind: 'out_of_scope'; message: string };

export interface LLMResolveRequest {
  history: ConversationTurn[];
  userMessage: string;
  candidateActions: CandidateActionDescriptor[];
  extraSystemPrompt?: string;
}

export interface LLMResolveResponse {
  decision: LLMDecision;
  /** Qual tier de modelo respondeu (observabilidade do roteamento adaptativo). */
  modelTier?: 'fast' | 'precise';
  /** Uso de tokens do provider nesta resolução (soma de todas as tentativas, se houve escalada). */
  usage?: TokenUsage;
  /** Payload cru do provider, só para auditoria/debug. */
  raw?: unknown;
}

export type ConfirmationDecision = 'confirmed' | 'declined' | 'unclear';

export interface LLMConfirmationRequest {
  history: ConversationTurn[];
  userReply: string;
  pendingActionDescription: string;
}

export interface LLMConfirmationResponse {
  decision: ConfirmationDecision;
  usage?: TokenUsage;
}

export interface LLMProvider {
  resolveIntent(request: LLMResolveRequest): Promise<LLMResolveResponse>;
  resolveConfirmation(request: LLMConfirmationRequest): Promise<LLMConfirmationResponse>;
}
