import type { Action } from '../types/action.js';
import type { ConversationTurn } from '../types/session.js';

export interface ShortlistQuery {
  userMessage: string;
  /** Histórico recente — só as últimas mensagens do usuário pesam no score léxico. */
  history: ConversationTurn[];
}

/**
 * Reduz um catálogo de ações (que pode ter centenas de itens) para as mais
 * relevantes à mensagem atual, ANTES da chamada cara ao LLM. Pluggable: a
 * implementação de referência (`KeywordShortlister`) é léxica e sem
 * dependência externa; um host pode trocar por embeddings/vetorial depois
 * sem tocar no `NavEngine`.
 */
export interface ActionShortlister {
  shortlist(candidates: Action[], query: ShortlistQuery, limit: number): Promise<Action[]>;
}
