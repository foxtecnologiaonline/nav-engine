import type { Action } from '../types/action.js';
import type { ExecutionContext } from '../types/context.js';
import { DuplicateActionKeyError } from '../errors.js';

export interface GetCandidateActionsOptions {
  /**
   * Keys de ações `riskLevel: 'blocked'` que o HOST está explicitamente
   * liberando para esta chamada. Nunca vem da LLM — é decisão do host, por
   * chamada, nunca por registro permanente.
   */
  includeBlockedKeys?: string[];
}

export interface ActionRegistry {
  register<TParams, TResult>(action: Action<TParams, TResult>): void;
  get(key: string): Action | undefined;
  getAll(): Action[];
  /**
   * Ações não-`blocked` (mais as explicitamente liberadas via
   * `includeBlockedKeys`) cujo `checkPermission(ctx)` retornou true.
   * Nunca envia ação `blocked` para o resolver a menos que o host peça.
   */
  getCandidateActions(
    ctx: ExecutionContext,
    opts?: GetCandidateActionsOptions,
  ): Promise<Action[]>;
}

export function createActionRegistry(): ActionRegistry {
  const actions = new Map<string, Action>();

  return {
    register(action) {
      if (actions.has(action.key)) {
        throw new DuplicateActionKeyError(action.key);
      }
      actions.set(action.key, action as Action);
    },

    get(key) {
      return actions.get(key);
    },

    getAll() {
      return Array.from(actions.values());
    },

    async getCandidateActions(ctx, opts = {}) {
      const includeBlocked = new Set(opts.includeBlockedKeys ?? []);
      const eligible = Array.from(actions.values()).filter(
        (action) => action.riskLevel !== 'blocked' || includeBlocked.has(action.key),
      );

      const checks = await Promise.all(
        eligible.map(async (action) => ({
          action,
          allowed: await action.checkPermission(ctx),
        })),
      );

      return checks.filter((c) => c.allowed).map((c) => c.action);
    },
  };
}
