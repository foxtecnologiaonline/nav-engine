import type { ConversationState, SessionStore } from '../types/session.js';

export interface InMemorySessionStoreConfig {
  /** Sessão sem atividade por mais que isso é tratada como expirada. Default: 30 min. Use `Infinity` para nunca expirar. */
  ttlMs?: number;
  /** Máximo de sessões simultâneas guardadas — excedente remove a mais antiga (LRU). Default: 10_000. */
  maxSessions?: number;
}

const DEFAULT_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_SESSIONS = 10_000;

/**
 * Implementação de referência, em memória — process-local, não sobrevive a
 * restart nem escala entre múltiplas instâncias. Um host de produção deve
 * trocar por uma implementação persistente (ex. `@nav-engine/session-redis`)
 * que satisfaça o mesmo contrato `SessionStore`.
 *
 * Por padrão é LIMITADA (TTL + teto de sessões com eviction LRU) — sem
 * isso, um processo de longa duração vazaria memória indefinidamente a
 * cada sessionId novo. Quem realmente quiser ilimitado passa `ttlMs:
 * Infinity` e/ou `maxSessions: Infinity` explicitamente.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly states = new Map<string, ConversationState>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;

  constructor(config: InMemorySessionStoreConfig = {}) {
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSessions = config.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  async get(sessionId: string): Promise<ConversationState | null> {
    const state = this.states.get(sessionId);
    if (!state) return null;

    if (Date.now() - state.updatedAt > this.ttlMs) {
      this.states.delete(sessionId);
      return null;
    }

    return state;
  }

  async save(state: ConversationState): Promise<void> {
    // Remove e reinsere para mover ao fim do Map (ordem de inserção = LRU).
    this.states.delete(state.sessionId);
    this.states.set(state.sessionId, state);

    while (this.states.size > this.maxSessions) {
      const oldestKey = this.states.keys().next().value;
      if (oldestKey === undefined) break;
      this.states.delete(oldestKey);
    }
  }

  async clear(sessionId: string): Promise<void> {
    this.states.delete(sessionId);
  }
}
