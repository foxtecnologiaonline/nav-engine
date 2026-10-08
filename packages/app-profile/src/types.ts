import type { RiskLevel } from '@nav-engine/core';
import type { ParamFieldSchema, ParamsProfile } from './param-schema.js';

/**
 * Ação de negócio declarativa: metadados que a IA lê ficam em dados; a
 * lógica (handler/checkPermission) continua sendo código do host, fornecida
 * via `ActionHandlers` em `loadAppProfile` — o motor nunca ganha lógica de
 * negócio própria, mesmo princípio do core.
 */
export interface BusinessActionProfile {
  kind: 'action';
  key: string;
  description: string;
  riskLevel: RiskLevel;
  params?: ParamsProfile;
  examples?: string[];
}

/**
 * Ação de navegação totalmente declarativa — nenhum código do host é
 * necessário. `toTemplate` usa placeholders `{paramName}` substituídos
 * pelos parâmetros extraídos (ex.: `/app/tasks/{taskId}`).
 */
export interface NavigationActionProfile {
  kind: 'navigation';
  key: string;
  description: string;
  toTemplate: string;
  params?: ParamsProfile;
  examples?: string[];
  /** Se presente, resolve em `navigationPermissions[key]` em `loadAppProfile`. Default: sempre permitido. */
  permissionHandlerKey?: string;
}

export type ActionProfileEntry = BusinessActionProfile | NavigationActionProfile;

export interface OnboardingStepProfile {
  key: string;
  /** Pergunta fixa. Pode referenciar `{campo}` das respostas já coletadas nos passos anteriores. */
  question: string;
  answer: ParamFieldSchema;
  optional?: boolean;
  examples?: string[];
}

export interface OnboardingFlowProfile {
  key: string;
  steps: OnboardingStepProfile[];
  allowCancel?: boolean;
  /** Resolve em `onboardingHandlers[key]` em `loadAppProfile` — onComplete é obrigatório lá. */
  handlerKey: string;
}

/** O "modelo" declarativo de um app: o que a IA pode fazer nele, sem nenhum código ainda. */
export interface AppProfile {
  appId: string;
  actions: ActionProfileEntry[];
  onboardingFlows?: OnboardingFlowProfile[];
}
