import type { ConversationState, SessionStore } from '../types/session.js';

/**
 * Implementação de referência, em memória — process-local, não sobrevive a
 * restart nem escala entre múltiplas instâncias. Um host de produção deve
 * trocar por uma implementação persistente (ex. Redis) que satisfaça o
 * mesmo contrato `SessionStore`.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly states = new Map<string, ConversationState>();

  async get(sessionId: string): Promise<ConversationState | null> {
    return this.states.get(sessionId) ?? null;
  }

  async save(state: ConversationState): Promise<void> {
    this.states.set(state.sessionId, state);
  }

  async clear(sessionId: string): Promise<void> {
    this.states.delete(sessionId);
  }
}
