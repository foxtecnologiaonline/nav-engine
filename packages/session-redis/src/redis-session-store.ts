import type { ConversationState, SessionStore } from '@nav-engine/core';

/**
 * Interface estrutural mínima compatível com `ioredis` (e, por extensão,
 * qualquer client cuja API bata este formato). Zero dependência de runtime
 * de propósito — o host injeta o client que já tiver, sem esse pacote
 * precisar declarar `ioredis` como dependência.
 */
export interface IoredisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface RedisSessionStoreConfig {
  client: IoredisLikeClient;
  /** Default: 'nav-engine:session:'. */
  keyPrefix?: string;
  /** Renovado a cada `save` — sessão ativa nunca expira no meio de uma conversa. Default: 1800 (30 min). */
  ttlSeconds?: number;
}

const DEFAULT_KEY_PREFIX = 'nav-engine:session:';
const DEFAULT_TTL_SECONDS = 1800;

/**
 * Implementação de `SessionStore` persistente via qualquer client
 * compatível com `ioredis`. Sobrevive a restart e escala entre múltiplas
 * instâncias do host — ao contrário de `InMemorySessionStore` (core), que é
 * só uma referência process-local.
 */
export class RedisSessionStore implements SessionStore {
  private readonly client: IoredisLikeClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;

  constructor(config: RedisSessionStoreConfig) {
    this.client = config.client;
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async get(sessionId: string): Promise<ConversationState | null> {
    const raw = await this.client.get(this.key(sessionId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as ConversationState;
    } catch {
      // Payload corrompido/malformado nunca derruba o processo — trata como sessão nova.
      return null;
    }
  }

  async save(state: ConversationState): Promise<void> {
    await this.client.set(this.key(state.sessionId), JSON.stringify(state), 'EX', this.ttlSeconds);
  }

  async clear(sessionId: string): Promise<void> {
    await this.client.del(this.key(sessionId));
  }
}
