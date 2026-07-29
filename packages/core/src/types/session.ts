export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * `confirmation`/`clarification` são sempre a CAUDA de uma tentativa de
 * `resolveAndAct` — resolvidos em 1-2 turnos e descartados. `onboarding` é
 * estruturalmente diferente: é o MODO PRIMÁRIO da conversa por múltiplos
 * turnos, iniciado explicitamente via `NavEngine.startOnboarding` (não
 * como cauda de uma resolução normal). Continuam na mesma união porque o
 * invariante "no máximo um sub-diálogo dono do próximo turno" é o que
 * importa preservar — nunca dois campos de estado concorrentes.
 */
export type PendingInteraction =
  | { type: 'confirmation'; actionKey: string; params: unknown; createdAt: number }
  | {
      type: 'clarification';
      originalMessage: string;
      ambiguousActionKeys?: string[];
      turnCount: number;
      createdAt: number;
    }
  | {
      type: 'onboarding';
      flowKey: string;
      stepIndex: number;
      answers: Record<string, unknown>;
      /** Tentativas no passo atual — zera ao avançar de passo. */
      attemptsOnCurrentStep: number;
      createdAt: number;
    };

export interface ConversationState {
  sessionId: string;
  history: ConversationTurn[];
  pending: PendingInteraction | null;
  updatedAt: number;
}

export interface SessionStore {
  get(sessionId: string): Promise<ConversationState | null>;
  save(state: ConversationState): Promise<void>;
  clear(sessionId: string): Promise<void>;
}
