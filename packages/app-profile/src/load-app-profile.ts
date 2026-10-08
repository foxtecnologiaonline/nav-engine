import {
  createActionRegistry,
  createOnboardingFlowRegistry,
  defineNavigationAction,
  type ActionRegistry,
  type ActionResult,
  type ExecutionContext,
  type OnboardingCompletionResult,
  type OnboardingFlowRegistry,
} from '@nav-engine/core';
import { compileField, compileParamsSchema } from './param-schema.js';
import { resolveTemplate } from './resolve-template.js';
import type { AppProfile } from './types.js';

export interface ActionHandlers {
  /** Default: sempre permitido — mesmo default do core para ações sem checagem explícita. */
  checkPermission?: (ctx: ExecutionContext) => Promise<boolean>;
  handler: (params: Record<string, unknown>, ctx: ExecutionContext) => Promise<ActionResult>;
}

export interface OnboardingHandlers {
  checkPermission?: (ctx: ExecutionContext) => Promise<boolean>;
  onComplete: (
    answers: Record<string, unknown>,
    ctx: ExecutionContext,
  ) => Promise<OnboardingCompletionResult>;
}

export interface LoadAppProfileInput {
  profile: AppProfile;
  /** Uma entrada por ação `kind: 'action'` do profile — obrigatório, lança erro claro se faltar. */
  actionHandlers?: Record<string, ActionHandlers>;
  /** Uma entrada por onboarding flow do profile — obrigatório se o profile tiver `onboardingFlows`. */
  onboardingHandlers?: Record<string, OnboardingHandlers>;
  /** `checkPermission` por ação de navegação que declarou `permissionHandlerKey`. */
  navigationPermissions?: Record<string, (ctx: ExecutionContext) => Promise<boolean>>;
}

export interface LoadedAppProfile {
  registry: ActionRegistry;
  onboardingRegistry: OnboardingFlowRegistry;
}

/**
 * Constrói o `ActionRegistry`/`OnboardingFlowRegistry` do core a partir de um
 * `AppProfile` (dados) + mapas de handlers (lógica de negócio do host). É a
 * camada de "modelar cada app sem reescrever boilerplate de registro" — o
 * motor (`NavEngine`) continua exatamente o mesmo depois disso, só a forma
 * de montar o registry muda.
 */
export function loadAppProfile(input: LoadAppProfileInput): LoadedAppProfile {
  const registry = createActionRegistry();
  const onboardingRegistry = createOnboardingFlowRegistry();

  for (const entry of input.profile.actions) {
    const paramsSchema = compileParamsSchema(entry.params ?? {});

    if (entry.kind === 'navigation') {
      let checkPermission: ((ctx: ExecutionContext) => Promise<boolean>) | undefined;
      if (entry.permissionHandlerKey) {
        checkPermission = input.navigationPermissions?.[entry.permissionHandlerKey];
        if (!checkPermission) {
          throw new Error(
            `loadAppProfile: navigationPermissions não tem a key "${entry.permissionHandlerKey}" ` +
              `exigida pela ação de navegação "${entry.key}".`,
          );
        }
      }

      registry.register(
        defineNavigationAction({
          key: entry.key,
          description: entry.description,
          paramsSchema,
          examples: entry.examples,
          checkPermission,
          to: (params) => resolveTemplate(entry.toTemplate, params as Record<string, unknown>),
        }),
      );
      continue;
    }

    const handlers = input.actionHandlers?.[entry.key];
    if (!handlers) {
      throw new Error(
        `loadAppProfile: actionHandlers não tem handler para a ação "${entry.key}" declarada no profile.`,
      );
    }

    registry.register({
      key: entry.key,
      description: entry.description,
      paramsSchema,
      riskLevel: entry.riskLevel,
      examples: entry.examples,
      checkPermission: handlers.checkPermission ?? (async () => true),
      handler: handlers.handler,
    });
  }

  for (const flow of input.profile.onboardingFlows ?? []) {
    const handlers = input.onboardingHandlers?.[flow.handlerKey];
    if (!handlers) {
      throw new Error(
        `loadAppProfile: onboardingHandlers não tem handler para a key "${flow.handlerKey}" ` +
          `exigida pelo flow "${flow.key}".`,
      );
    }

    onboardingRegistry.register({
      key: flow.key,
      allowCancel: flow.allowCancel,
      checkPermission: handlers.checkPermission,
      onComplete: handlers.onComplete,
      steps: flow.steps.map((step) => ({
        key: step.key,
        optional: step.optional,
        examples: step.examples,
        answerSchema: compileField(step.answer),
        question: (answers) => resolveTemplate(step.question, answers),
      })),
    });
  }

  return { registry, onboardingRegistry };
}
