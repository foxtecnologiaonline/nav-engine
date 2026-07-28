import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemorySessionStore } from './in-memory-session-store.js';
import type { ConversationState } from '../types/session.js';

function makeState(sessionId: string, updatedAt: number): ConversationState {
  return { sessionId, history: [], pending: null, updatedAt };
}

describe('InMemorySessionStore', () => {
  it('get retorna null para sessão inexistente', async () => {
    const store = new InMemorySessionStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('round-trip de save/get', async () => {
    const store = new InMemorySessionStore();
    const state: ConversationState = {
      sessionId: 's1',
      history: [{ role: 'user', content: 'oi', timestamp: Date.now() }],
      pending: null,
      updatedAt: Date.now(),
    };
    await store.save(state);
    expect(await store.get('s1')).toEqual(state);
  });

  it('clear remove o estado', async () => {
    const store = new InMemorySessionStore();
    await store.save({ sessionId: 's1', history: [], pending: null, updatedAt: Date.now() });
    await store.clear('s1');
    expect(await store.get('s1')).toBeNull();
  });

  describe('TTL', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sessão expira após ttlMs sem atividade', async () => {
      const store = new InMemorySessionStore({ ttlMs: 1000 });
      await store.save(makeState('s1', Date.now()));

      vi.setSystemTime(500);
      expect(await store.get('s1')).not.toBeNull();

      vi.setSystemTime(1500);
      expect(await store.get('s1')).toBeNull();
    });

    it('ttlMs: Infinity nunca expira', async () => {
      const store = new InMemorySessionStore({ ttlMs: Infinity });
      await store.save(makeState('s1', Date.now()));

      vi.setSystemTime(1e12);
      expect(await store.get('s1')).not.toBeNull();
    });
  });

  describe('maxSessions (LRU)', () => {
    it('remove a sessão mais antiga ao exceder o limite', async () => {
      const store = new InMemorySessionStore({ maxSessions: 2 });
      await store.save(makeState('s1', Date.now()));
      await store.save(makeState('s2', Date.now()));
      await store.save(makeState('s3', Date.now()));

      expect(await store.get('s1')).toBeNull();
      expect(await store.get('s2')).not.toBeNull();
      expect(await store.get('s3')).not.toBeNull();
    });

    it('salvar de novo uma sessão existente a atualiza para o topo do LRU', async () => {
      const store = new InMemorySessionStore({ maxSessions: 2 });
      await store.save(makeState('s1', Date.now()));
      await store.save(makeState('s2', Date.now()));
      await store.save(makeState('s1', Date.now())); // reativa s1
      await store.save(makeState('s3', Date.now())); // deveria expulsar s2, não s1

      expect(await store.get('s1')).not.toBeNull();
      expect(await store.get('s2')).toBeNull();
      expect(await store.get('s3')).not.toBeNull();
    });
  });
});
