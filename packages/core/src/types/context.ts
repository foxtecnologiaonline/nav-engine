/** Contexto de execução de um turno: quem é o usuário e o que o host quiser anexar (tenant, papéis, locale, flags). */
export interface ExecutionContext {
  sessionId: string;
  userId: string;
  hostContext: Record<string, unknown>;
}
