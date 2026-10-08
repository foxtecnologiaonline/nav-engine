import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nav-engine/core';
import { loadAppProfile } from './load-app-profile.js';
import type { AppProfile } from './types.js';

function ctx(): ExecutionContext {
  return { sessionId: 's1', userId: 'u1', hostContext: {} };
}

describe('loadAppProfile', () => {
  it('registra ação de negócio e liga ao handler fornecido', async () => {
    const profile: AppProfile = {
      appId: 'todo-app',
      actions: [
        {
          kind: 'action',
          key: 'tasks.create',
          description: 'cria uma tarefa',
          riskLevel: 'safe',
          params: { title: { type: 'string', minLength: 1 } },
        },
      ],
    };

    const { registry } = loadAppProfile({
      profile,
      actionHandlers: {
        'tasks.create': {
          handler: async (params) => ({ ok: true, message: `Criei "${params.title}"` }),
        },
      },
    });

    const action = registry.get('tasks.create');
    expect(action).toBeDefined();
    const result = await action!.handler({ title: 'comprar pão' }, ctx());
    expect(result).toEqual({ ok: true, message: 'Criei "comprar pão"' });
  });

  it('lança erro claro se faltar handler de uma ação de negócio', () => {
    const profile: AppProfile = {
      appId: 'todo-app',
      actions: [
        { kind: 'action', key: 'tasks.create', description: 'cria uma tarefa', riskLevel: 'safe' },
      ],
    };

    expect(() => loadAppProfile({ profile, actionHandlers: {} })).toThrow(/tasks.create/);
  });

  it('registra ação de navegação totalmente declarativa (sem handler no host)', async () => {
    const profile: AppProfile = {
      appId: 'todo-app',
      actions: [
        {
          kind: 'navigation',
          key: 'nav.go_to_task',
          description: 'ir para uma tarefa',
          toTemplate: '/app/tasks/{taskId}',
          params: { taskId: { type: 'string' } },
        },
      ],
    };

    const { registry } = loadAppProfile({ profile });
    const action = registry.get('nav.go_to_task');
    const allowed = await action!.checkPermission(ctx());
    expect(allowed).toBe(true);

    const result = await action!.handler({ taskId: 'abc' }, ctx());
    expect(result.data?.navigateTo).toBe('/app/tasks/abc');
  });

  it('lança erro claro se a ação de navegação exigir uma permissão não fornecida', () => {
    const profile: AppProfile = {
      appId: 'todo-app',
      actions: [
        {
          kind: 'navigation',
          key: 'nav.go_to_billing',
          description: 'ir para faturamento',
          toTemplate: '/app/billing',
          permissionHandlerKey: 'isAdmin',
        },
      ],
    };

    expect(() => loadAppProfile({ profile })).toThrow(/isAdmin/);
  });

  it('registra onboarding flow e resolve a pergunta do primeiro passo', () => {
    const profile: AppProfile = {
      appId: 'todo-app',
      actions: [],
      onboardingFlows: [
        {
          key: 'business-setup',
          handlerKey: 'business-setup',
          steps: [{ key: 'name', question: 'Qual o nome do seu negócio?', answer: { type: 'string', minLength: 1 } }],
        },
      ],
    };

    const { onboardingRegistry } = loadAppProfile({
      profile,
      onboardingHandlers: {
        'business-setup': {
          onComplete: async () => ({ ok: true, message: 'Tudo configurado!' }),
        },
      },
    });

    const flow = onboardingRegistry.get('business-setup');
    expect(flow).toBeDefined();
    const question = flow!.steps[0]!.question;
    expect(typeof question === 'function' ? question({}, ctx()) : question).toBe(
      'Qual o nome do seu negócio?',
    );
  });

  it('lança erro claro se faltar handler de um onboarding flow', () => {
    const profile: AppProfile = {
      appId: 'todo-app',
      actions: [],
      onboardingFlows: [
        {
          key: 'business-setup',
          handlerKey: 'business-setup',
          steps: [{ key: 'name', question: 'Nome?', answer: { type: 'string' } }],
        },
      ],
    };

    expect(() => loadAppProfile({ profile })).toThrow(/business-setup/);
  });
});
