import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createActionRegistry } from './action-registry.js';
import type { Action } from '../types/action.js';
import type { ExecutionContext } from '../types/context.js';

const ctx: ExecutionContext = { sessionId: 's1', userId: 'u1', hostContext: {} };

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    key: 'demo.action',
    description: 'ação de demonstração',
    paramsSchema: z.object({}),
    riskLevel: 'safe',
    checkPermission: async () => true,
    handler: async () => ({ ok: true, message: 'feito' }),
    ...overrides,
  };
}

describe('createActionRegistry', () => {
  it('registra e recupera uma ação por key', () => {
    const registry = createActionRegistry();
    const action = makeAction();
    registry.register(action);
    expect(registry.get('demo.action')).toBe(action);
    expect(registry.getAll()).toHaveLength(1);
  });

  it('lança erro em key duplicada', () => {
    const registry = createActionRegistry();
    registry.register(makeAction());
    expect(() => registry.register(makeAction())).toThrow(/duplicada/i);
  });

  it('getCandidateActions exclui ações blocked por padrão', async () => {
    const registry = createActionRegistry();
    registry.register(makeAction({ key: 'safe.one', riskLevel: 'safe' }));
    registry.register(makeAction({ key: 'blocked.one', riskLevel: 'blocked' }));

    const candidates = await registry.getCandidateActions(ctx);
    expect(candidates.map((a) => a.key)).toEqual(['safe.one']);
  });

  it('getCandidateActions inclui blocked só via includeBlockedKeys explícito', async () => {
    const registry = createActionRegistry();
    registry.register(makeAction({ key: 'blocked.one', riskLevel: 'blocked' }));

    const withoutOptIn = await registry.getCandidateActions(ctx);
    expect(withoutOptIn).toHaveLength(0);

    const withOptIn = await registry.getCandidateActions(ctx, { includeBlockedKeys: ['blocked.one'] });
    expect(withOptIn.map((a) => a.key)).toEqual(['blocked.one']);
  });

  it('getCandidateActions filtra por checkPermission', async () => {
    const registry = createActionRegistry();
    registry.register(makeAction({ key: 'allowed', checkPermission: async () => true }));
    registry.register(makeAction({ key: 'denied', checkPermission: async () => false }));

    const candidates = await registry.getCandidateActions(ctx);
    expect(candidates.map((a) => a.key)).toEqual(['allowed']);
  });
});
