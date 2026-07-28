import type { Action } from '../types/action.js';

/** Guarda contra alucinação: só aceita uma actionKey que de fato estava no shortlist enviado. */
export function findCandidateAction(candidates: Action[], actionKey: string): Action | undefined {
  return candidates.find((a) => a.key === actionKey);
}
