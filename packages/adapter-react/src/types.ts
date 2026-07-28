export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export type NavCopilotStatus = 'idle' | 'thinking' | 'awaiting_confirmation' | 'error';

/**
 * Forma da resposta HTTP — espelha o contrato documentado no README, o
 * mesmo que `@nav-engine/adapter-fastify` produz. Definido aqui de forma
 * independente (não importa tipos do adapter-fastify) porque o widget deve
 * funcionar contra QUALQUER backend que implemente o mesmo contrato HTTP,
 * não só o adapter Fastify de referência.
 */
export interface NavEngineHttpResponse {
  reply: string;
  status: string;
  action?: { key: string; description: string } | null;
  executionOk?: boolean;
  navigateTo?: string;
  audioBase64?: string;
  audioMimeType?: string;
}
