export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type PendingInteraction =
  | { type: 'confirmation'; actionKey: string; params: unknown; createdAt: number }
  | {
      type: 'clarification';
      originalMessage: string;
      ambiguousActionKeys?: string[];
      turnCount: number;
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
