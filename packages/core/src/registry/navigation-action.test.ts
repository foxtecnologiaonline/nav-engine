import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineNavigationAction } from './navigation-action.js';
import type { ExecutionContext } from '../types/context.js';

const ctx: ExecutionContext = { sessionId: 's1', userId: 'u1', hostContext: {} };

describe('defineNavigationAction', () => {
  it('cria uma ação safe cujo handler devolve data.navigateTo, sem lógica de negócio do host', async () => {
    const action = defineNavigationAction({
      key: 'nav.go_to_settings',
      description: 'ir para configurações',
      to: () => '/app/settings',
    });

    expect(action.riskLevel).toBe('safe');
    const result = await action.handler({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.data?.navigateTo).toBe('/app/settings');
  });

  it('usa parâmetros extraídos para montar a rota', async () => {
    const action = defineNavigationAction({
      key: 'nav.go_to_task',
      description: 'ir para uma tarefa específica',
      paramsSchema: z.object({ taskId: z.string() }),
      to: (params) => `/app/tasks/${params.taskId}`,
    });

    const result = await action.handler({ taskId: 'abc' }, ctx);
    expect(result.data?.navigateTo).toBe('/app/tasks/abc');
  });

  it('checkPermission default sempre permite; pode ser sobrescrito', async () => {
    const open = defineNavigationAction({ key: 'nav.open', description: 'd', to: () => '/x' });
    expect(await open.checkPermission(ctx)).toBe(true);

    const restricted = defineNavigationAction({
      key: 'nav.restricted',
      description: 'd',
      to: () => '/admin',
      checkPermission: async (c) => c.hostContext.role === 'admin',
    });
    expect(await restricted.checkPermission(ctx)).toBe(false);
    expect(
      await restricted.checkPermission({ ...ctx, hostContext: { role: 'admin' } }),
    ).toBe(true);
  });
});
