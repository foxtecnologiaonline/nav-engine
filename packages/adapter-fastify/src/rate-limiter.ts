/**
 * Contrato mínimo de rate limiter — o adapter Fastify chama `consume(key)`
 * antes de processar `/message`/`/audio`. Pluggable: troque a implementação
 * de referência por Redis (ex. `rate-limiter-flexible`) sem tocar nas rotas.
 */
export interface RateLimiter {
  /** Devolve `true` se a requisição pode prosseguir, `false` se deve ser bloqueada (429). */
  consume(key: string): Promise<boolean> | boolean;
}

export interface TokenBucketConfig {
  /** Máximo de requisições em rajada por chave. */
  capacity: number;
  /** Quantos tokens são devolvidos por segundo (regime sustentado). */
  refillRatePerSecond: number;
  /** Máximo de chaves simultâneas guardadas — excedente remove a mais antiga (LRU). Default: 10_000. */
  maxBuckets?: number;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

const DEFAULT_MAX_BUCKETS = 10_000;

/**
 * Implementação de referência de rate limiting: token bucket em memória,
 * process-local (mesma limitação de `InMemorySessionStore` — não escala
 * entre instâncias). Suficiente para um único processo; troque por uma
 * implementação distribuída (Redis) em produção multi-instância.
 */
export class InMemoryTokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;
  private readonly maxBuckets: number;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.refillRatePerSecond = config.refillRatePerSecond;
    this.maxBuckets = config.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  }

  consume(key: string): boolean {
    const now = Date.now();
    const existing = this.buckets.get(key);
    // Remove e reinsere para mover ao fim do Map (ordem de inserção = LRU).
    if (existing) this.buckets.delete(key);
    const bucket: Bucket = existing ?? { tokens: this.capacity, lastRefillAt: now };

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefillAt) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillRatePerSecond);
    bucket.lastRefillAt = now;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;

    this.buckets.set(key, bucket);
    while (this.buckets.size > this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }

    return allowed;
  }
}
