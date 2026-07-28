import type { Action } from '../types/action.js';
import type { ActionShortlister, ShortlistQuery } from './types.js';

const STOPWORDS = new Set([
  // PT-BR
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'uns', 'umas', 'para', 'por', 'com', 'sem', 'que', 'e', 'ou', 'é', 'ao', 'à',
  'meu', 'minha', 'me', 'eu', 'você', 'voce', 'quero', 'gostaria', 'pode', 'por favor',
  // EN
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'with', 'and', 'or', 'is', 'my', 'i',
  'want', 'please', 'can', 'you',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (marcas diacríticas combinantes)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function tokenizeKey(key: string): string[] {
  return tokenize(key.replace(/[._-]/g, ' '));
}

function scoreAction(action: Action, queryTokens: Set<string>): number {
  let score = 0;

  for (const token of tokenizeKey(action.key)) {
    if (queryTokens.has(token)) score += 2;
  }
  for (const token of tokenize(action.description)) {
    if (queryTokens.has(token)) score += 1;
  }
  for (const example of action.examples ?? []) {
    for (const token of tokenize(example)) {
      if (queryTokens.has(token)) score += 1.5;
    }
  }

  return score;
}

/**
 * Implementação de referência: scoring léxico por overlap de termos entre a
 * mensagem (+ últimas mensagens do usuário no histórico) e
 * key/description/examples de cada ação. Determinístico, sem API externa.
 */
export class KeywordShortlister implements ActionShortlister {
  async shortlist(candidates: Action[], query: ShortlistQuery, limit: number): Promise<Action[]> {
    if (candidates.length <= limit) return candidates;

    const recentUserTurns = query.history
      .filter((t) => t.role === 'user')
      .slice(-3)
      .map((t) => t.content);
    const queryText = [query.userMessage, ...recentUserTurns].join(' ');
    const queryTokens = new Set(tokenize(queryText));

    const scored = candidates.map((action, index) => ({
      action,
      index,
      score: scoreAction(action, queryTokens),
    }));

    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));

    return scored.slice(0, limit).map((s) => s.action);
  }
}
