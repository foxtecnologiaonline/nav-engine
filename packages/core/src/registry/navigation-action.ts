import { z, type ZodType } from 'zod';
import type { Action } from '../types/action.js';
import type { ExecutionContext } from '../types/context.js';

export interface DefineNavigationActionInput<TParams> {
  key: string;
  description: string;
  /** Default: objeto vazio (ação de navegação sem parâmetros). */
  paramsSchema?: ZodType<TParams>;
  /** Constrói a rota/deep-link de destino a partir dos parâmetros extraídos. */
  to: (params: TParams) => string;
  /** Default: sempre permitido. O host ainda pode restringir por papel/rota. */
  checkPermission?: (ctx: ExecutionContext) => Promise<boolean>;
  examples?: string[];
}

/**
 * Açúcar sintático sobre `Action`: define uma ação de navegação de primeira
 * classe. `riskLevel` fixo em 'safe' (navegar não muda dados) e o `handler`
 * só devolve `data.navigateTo` — o adapter React reconhece essa convenção e
 * chama `onNavigate(path)` automaticamente, sem o host escrever handler de
 * negócio nenhum.
 */
export function defineNavigationAction<TParams = Record<string, never>>(
  input: DefineNavigationActionInput<TParams>,
): Action<TParams, { navigateTo: string }> {
  const paramsSchema = input.paramsSchema ?? (z.object({}) as unknown as ZodType<TParams>);

  return {
    key: input.key,
    description: input.description,
    paramsSchema,
    riskLevel: 'safe',
    examples: input.examples,
    checkPermission: input.checkPermission ?? (async () => true),
    async handler(params) {
      const navigateTo = input.to(params);
      return {
        ok: true,
        message: `Levando você para ${navigateTo}.`,
        data: { navigateTo },
      };
    },
  };
}
