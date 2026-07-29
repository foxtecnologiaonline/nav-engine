import type { ZodType } from 'zod';
import type { ExecutionContext } from './context.js';

export interface OnboardingStep<TAnswer = unknown> {
  /** Único dentro do flow. */
  key: string;
  /** Pergunta FIXA — a LLM nunca decide o que perguntar, só extrai a resposta. Pode depender das respostas já coletadas. */
  question: string | ((answers: Record<string, unknown>, ctx: ExecutionContext) => string);
  answerSchema: ZodType<TAnswer>;
  /** Se true, a LLM pode oferecer "pular este passo" ao usuário. Default false. */
  optional?: boolean;
  /** Frases de exemplo de resposta válida — melhora a extração, mesmo padrão de `Action.examples`. */
  examples?: string[];
}

export interface OnboardingCompletionResult<TResult = unknown> {
  ok: boolean;
  message: string;
  data?: TResult & { navigateTo?: string };
}

export interface OnboardingFlow {
  /** Único no registry. */
  key: string;
  steps: OnboardingStep[];
  /** Mesmo padrão de `Action.checkPermission` — o motor nunca decide permissão sozinho. */
  checkPermission?: (ctx: ExecutionContext) => Promise<boolean>;
  /** Se a LLM pode oferecer "cancelar" em qualquer passo deste flow. Default true. */
  allowCancel?: boolean;
  /** Chamado pelo HOST ao completar todos os passos — nunca lógica de negócio dentro do motor. */
  onComplete: (answers: Record<string, unknown>, ctx: ExecutionContext) => Promise<OnboardingCompletionResult>;
}

export interface OnboardingFlowRegistry {
  register(flow: OnboardingFlow): void;
  get(key: string): OnboardingFlow | undefined;
}
