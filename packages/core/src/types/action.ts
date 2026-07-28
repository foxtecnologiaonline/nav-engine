import type { ZodType } from 'zod';
import type { ExecutionContext } from './context.js';

/**
 * safe    → executa direto assim que resolvido com confiança suficiente.
 * confirm → exige uma resposta explícita de confirmação do usuário no turno seguinte.
 * blocked → nunca entra no menu de ações candidatas a menos que o host peça
 *           explicitamente via `includeBlockedKeys` naquela chamada — nunca
 *           por decisão da LLM.
 */
export type RiskLevel = 'safe' | 'confirm' | 'blocked';

export interface ActionResult<TResult = unknown> {
  ok: boolean;
  /** Texto para mostrar (e opcionalmente falar, via TTS) de volta ao usuário. */
  message: string;
  /**
   * `navigateTo`, quando presente, é a convenção usada por `defineNavigationAction`
   * para o adapter React redirecionar o usuário automaticamente.
   */
  data?: TResult & { navigateTo?: string };
}

export interface Action<TParams = any, TResult = unknown> {
  /** Único no registry, ex. "billing.cancel_subscription" ou "nav.go_to_settings". */
  key: string;
  /** Linguagem natural — é o que a LLM lê para decidir se/quando usar esta ação. */
  description: string;
  paramsSchema: ZodType<TParams>;
  riskLevel: RiskLevel;
  /** Frases de exemplo que melhoram a precisão do shortlist e do resolver. */
  examples?: string[];
  /** O motor nunca decide permissão sozinho — sempre delega para o host. */
  checkPermission: (ctx: ExecutionContext) => Promise<boolean>;
  /** O motor nunca executa lógica de negócio própria — só invoca o handler do host. */
  handler: (params: TParams, ctx: ExecutionContext) => Promise<ActionResult<TResult>>;
}
