import { describe, expect, it } from 'vitest';
import { InMemorySessionStore } from './in-memory-session-store.js';
import type { ConversationState } from '../types/session.js';

describe('InMemorySessionStore', () => {
  it('get retorna null para sessão inexistente', async () => {
    const store = new InMemorySessionStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('round-trip de save/get', async () => {
    const store = new InMemorySessionStore();
    const state: ConversationState = {
      sessionId: 's1',
      history: [{ role: 'user', content: 'oi', timestamp: 1 }],
      pending: null,
      updatedAt: 1,
    };
    await store.save(state);
    expect(await store.get('s1')).toEqual(state);
  });

  it('clear remove o estado', async () => {
    const store = new InMemorySessionStore();
    await store.save({ sessionId: 's1', history: [], pending: null, updatedAt: 1 });
    await store.clear('s1');
    expect(await store.get('s1')).toBeNull();
  });
});
