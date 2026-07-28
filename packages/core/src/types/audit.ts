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
  | 'provider_error';

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
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}
