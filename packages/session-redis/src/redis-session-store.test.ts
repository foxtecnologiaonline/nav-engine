import { describe, expect, it, vi } from 'vitest';
import { RedisSessionStore, type IoredisLikeClient } from './redis-session-store.js';
import type { ConversationState } from '@nav-engine/core';

function makeFakeClient(): IoredisLikeClient & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

function makeState(sessionId: string): ConversationState {
  return {
    sessionId,
    history: [{ role: 'user', content: 'oi', timestamp: 1 }],
    pending: null,
    updatedAt: 1,
  };
}

describe('RedisSessionStore', () => {
  it('get retorna null quando a chave não existe', async () => {
    const client = makeFakeClient();
    const store = new RedisSessionStore({ client });
    expect(await store.get('nope')).toBeNull();
  });

  it('round-trip de save/get via JSON', async () => {
    const client = makeFakeClient();
    const store = new RedisSessionStore({ client });
    const state = makeState('s1');

    await store.save(state);
    expect(await store.get('s1')).toEqual(state);
  });

  it('clear remove a chave', async () => {
    const client = makeFakeClient();
    const store = new RedisSessionStore({ client });
    await store.save(makeState('s1'));
    await store.clear('s1');
    expect(await store.get('s1')).toBeNull();
  });

  it('aplica o keyPrefix configurado', async () => {
    const client = makeFakeClient();
    const store = new RedisSessionStore({ client, keyPrefix: 'myapp:sess:' });
    await store.save(makeState('s1'));
    expect(client.set).toHaveBeenCalledWith('myapp:sess:s1', expect.any(String), 'EX', expect.any(Number));
  });

  it('usa o ttlSeconds configurado no comando EX', async () => {
    const client = makeFakeClient();
    const store = new RedisSessionStore({ client, ttlSeconds: 60 });
    await store.save(makeState('s1'));
    expect(client.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 60);
  });

  it('default ttlSeconds é 1800 (30 min) quando não configurado', async () => {
    const client = makeFakeClient();
    const store = new RedisSessionStore({ client });
    await store.save(makeState('s1'));
    expect(client.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 1800);
  });

  it('JSON malformado no Redis nunca lança — devolve null (sessão tratada como nova)', async () => {
    const client = makeFakeClient();
    client.get.mockResolvedValueOnce('{ isso não é json válido');
    const store = new RedisSessionStore({ client });
    await expect(store.get('s1')).resolves.toBeNull();
  });
});
