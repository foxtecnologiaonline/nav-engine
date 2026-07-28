import { describe, expect, it, vi } from 'vitest';
import { InMemoryTokenBucketRateLimiter } from './rate-limiter.js';

describe('InMemoryTokenBucketRateLimiter', () => {
  it('permite até `capacity` requisições em rajada, depois bloqueia', () => {
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 3, refillRatePerSecond: 0 });
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(false);
  });

  it('chaves diferentes têm buckets independentes', () => {
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 1, refillRatePerSecond: 0 });
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(false);
    expect(limiter.consume('user-2')).toBe(true);
  });

  it('reabastece tokens ao longo do tempo, respeitando refillRatePerSecond', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 1, refillRatePerSecond: 1 });

    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(false);

    vi.setSystemTime(1000); // 1s depois, 1 token deveria ter voltado
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(false);

    vi.useRealTimers();
  });

  it('nunca ultrapassa a capacidade máxima ao reabastecer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 2, refillRatePerSecond: 100 });

    limiter.consume('user-1');
    vi.setSystemTime(100_000); // muito tempo depois — não deveria acumular além de 2
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(true);
    expect(limiter.consume('user-1')).toBe(false);

    vi.useRealTimers();
  });

  it('remove o bucket mais antigo ao exceder maxBuckets (LRU)', () => {
    const limiter = new InMemoryTokenBucketRateLimiter({ capacity: 1, refillRatePerSecond: 0, maxBuckets: 2 });
    limiter.consume('a'); // a: 0 tokens restantes
    limiter.consume('b'); // b: 0 tokens restantes
    limiter.consume('c'); // expulsa 'a' (mais antigo), c: 0 tokens restantes

    // 'a' foi expulso — bucket novo, cheio de novo
    expect(limiter.consume('a')).toBe(true);
  });
});
