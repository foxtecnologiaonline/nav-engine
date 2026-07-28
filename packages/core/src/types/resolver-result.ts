import type { Action } from './action.js';

export type ResolverResult =
  | { type: 'execute'; action: Action; params: unknown; confidence: number }
  | { type: 'confirm_required'; action: Action; params: unknown; confidence: number }
  | { type: 'clarify'; question: string; ambiguousActionKeys?: string[] }
  | { type: 'chat'; message: string }
  | { type: 'out_of_scope'; message: string }
  | { type: 'invalid_params'; action: Action; issues: string[] };
