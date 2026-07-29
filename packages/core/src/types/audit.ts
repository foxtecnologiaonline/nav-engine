export type AuditOutcome =
  | 'executed'
  | 'execution_failed'
  | 'awaiting_confirmation'
  | 'confirmed_and_executed'
  | 'confirmation_declined'
  | 'awaiting_clarification'
  | 'chat'
  | 'out_of_scope'
  | 'permission_denied'
  /** actionKey que o LLM retornou não estava no conjunto de candidatos enviado. */
  | 'hallucination_blocked'
  /** Falha do LLMProvider/registry/shortlister (rede, timeout, exceção) — nunca deixa o turno sem resposta. */
  | 'provider_error'
  | 'onboarding_started'
  | 'onboarding_step_answered'
  | 'onboarding_step_skipped'
  | 'onboarding_answer_unclear'
  /** Esgotou as tentativas no passo atual (`maxOnboardingRetriesPerStep`) — distinto de uma única resposta ambígua. */
  | 'onboarding_abandoned'
  /** Usuário cancelou explicitamente — distinto de `onboarding_abandoned` (esgotar tentativas). */
  | 'onboarding_cancelled'
  | 'onboarding_completed'
  /** Todos os passos coletados, mas `onComplete` do host falhou/lançou. */
  | 'onboarding_completion_failed'
  /** `startOnboarding` chamado com uma flowKey que não existe no registry. */
  | 'onboarding_flow_not_found';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AuditEntry {
  sessionId: string;
  userId: string;
  actionKey: string | null;
  outcome: AuditOutcome;
  confidence: number | null;
  params: unknown | null;
  message: string;
  timestamp: number;
  /** Observabilidade das otimizações: quais ações chegaram a virar tools nesse turno. */
  shortlistedKeys?: string[];
  modelTier?: 'fast' | 'precise';
  /** Observabilidade de custo/latência — quanto o provider demorou e consumiu neste turno. */
  latencyMs?: number;
  tokenUsage?: TokenUsage;
  onboardingFlowKey?: string;
  onboardingStepKey?: string;
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}
