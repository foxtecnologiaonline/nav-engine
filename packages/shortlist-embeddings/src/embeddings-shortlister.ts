import OpenAI from 'openai';
import type { Action, ActionShortlister, ShortlistQuery } from '@nav-engine/core';
import { cosineSimilarity } from './cosine-similarity.js';

export interface EmbeddingsShortlisterConfig {
  /** Injeção para testes; se omitido, cria um client com `apiKey` ou `OPENAI_API_KEY` do ambiente. */
  client?: OpenAI;
  apiKey?: string;
  /** Default: 'text-embedding-3-small'. */
  model?: string;
  /** Quantas mensagens recentes do usuário entram no texto de consulta. Default 3 (mesmo do KeywordShortlister). */
  historyWindow?: number;
}

interface CachedEmbedding {
  contentHash: string;
  vector: number[];
}

function actionText(action: Action): string {
  const examples = action.examples?.length ? ` — exemplos: ${action.examples.join(' | ')}` : '';
  return `${action.description}${examples}`;
}

function buildQueryText(query: ShortlistQuery, historyWindow: number): string {
  const recentUserTurns = query.history
    .filter((t) => t.role === 'user')
    .slice(-historyWindow)
    .map((t) => t.content);
  return [query.userMessage, ...recentUserTurns].join(' ');
}

/** Hash determinístico e barato — só para invalidar cache quando o texto de uma ação muda, não precisa ser criptográfico. */
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * `ActionShortlister` semântico: em vez de overlap léxico
 * (`KeywordShortlister`, no core), embeda a mensagem do usuário e a
 * descrição/exemplos de cada ação candidata, e rankeia por similaridade de
 * cosseno. Embeddings de ações são cacheados em memória por processo
 * (invalidados automaticamente se description/examples mudarem) — evita
 * reembedar o catálogo inteiro a cada turno.
 */
export class EmbeddingsShortlister implements ActionShortlister {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly historyWindow: number;
  private readonly cache = new Map<string, CachedEmbedding>();

  constructor(config: EmbeddingsShortlisterConfig = {}) {
    this.client = config.client ?? new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'text-embedding-3-small';
    this.historyWindow = config.historyWindow ?? 3;
  }

  async shortlist(candidates: Action[], query: ShortlistQuery, limit: number): Promise<Action[]> {
    if (candidates.length <= limit) return candidates;

    const queryText = buildQueryText(query, this.historyWindow);
    const [queryVector, actionVectors] = await Promise.all([
      this.embedOne(queryText),
      this.embedActions(candidates),
    ]);

    const scored = candidates.map((action, index) => ({
      action,
      index,
      score: cosineSimilarity(queryVector, actionVectors[index] ?? []),
    }));

    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
    return scored.slice(0, limit).map((s) => s.action);
  }

  private async embedOne(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({ input: text, model: this.model });
    const embedding = response.data[0]?.embedding;
    if (!embedding) throw new Error('EmbeddingsShortlister: a API não devolveu embedding para a consulta.');
    return embedding;
  }

  private async embedActions(actions: Action[]): Promise<number[][]> {
    const toFetch: { index: number; text: string; key: string; hash: string }[] = [];
    const vectors: (number[] | undefined)[] = actions.map((action, index) => {
      const text = actionText(action);
      const hash = hashText(text);
      const cached = this.cache.get(action.key);
      if (cached && cached.contentHash === hash) return cached.vector;
      toFetch.push({ index, text, key: action.key, hash });
      return undefined;
    });

    if (toFetch.length > 0) {
      const response = await this.client.embeddings.create({
        input: toFetch.map((f) => f.text),
        model: this.model,
      });
      toFetch.forEach((f, i) => {
        const vector = response.data[i]?.embedding;
        if (!vector) {
          throw new Error(`EmbeddingsShortlister: a API não devolveu embedding para a ação "${f.key}".`);
        }
        vectors[f.index] = vector;
        this.cache.set(f.key, { contentHash: f.hash, vector });
      });
    }

    return vectors as number[][];
  }
}
