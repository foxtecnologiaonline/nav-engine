import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EmbeddingsShortlister } from './embeddings-shortlister.js';
import type { Action } from '@nav-engine/core';

function makeAction(key: string, description: string): Action {
  return {
    key,
    description,
    paramsSchema: z.object({}),
    riskLevel: 'safe',
    checkPermission: async () => true,
    handler: async () => ({ ok: true, message: 'ok' }),
  };
}

/** Vetores conhecidos por substring do texto — permite montar cenários determinísticos. */
function makeFakeClient(vectorFor: (text: string) => number[]) {
  const create = vi.fn(async ({ input }: { input: string | string[] }) => {
    const inputs = Array.isArray(input) ? input : [input];
    return { data: inputs.map((text) => ({ embedding: vectorFor(text) })) };
  });
  return { embeddings: { create } } as any;
}

const VECTORS: Record<string, number[]> = {
  billing: [1, 0],
  cancel: [1, 0],
  task: [0, 1],
  create: [0, 1],
};

function vectorForText(text: string): number[] {
  const lower = text.toLowerCase();
  for (const [term, vector] of Object.entries(VECTORS)) {
    if (lower.includes(term)) return vector;
  }
  return [0.5, 0.5];
}

describe('EmbeddingsShortlister', () => {
  it('retorna todos os candidatos sem chamar a API se couberem no limite', async () => {
    const client = makeFakeClient(vectorForText);
    const shortlister = new EmbeddingsShortlister({ client });
    const actions = [makeAction('a', 'ação A'), makeAction('b', 'ação B')];

    const result = await shortlister.shortlist(actions, { userMessage: 'oi', history: [] }, 12);

    expect(result).toHaveLength(2);
    expect(client.embeddings.create).not.toHaveBeenCalled();
  });

  it('rankeia por similaridade de cosseno entre a mensagem e a ação', async () => {
    const client = makeFakeClient(vectorForText);
    const shortlister = new EmbeddingsShortlister({ client });
    const actions = [
      makeAction('billing.cancel', 'cancelar a assinatura de billing'),
      makeAction('task.create', 'criar uma nova task'),
      ...Array.from({ length: 10 }, (_, i) => makeAction(`filler.${i}`, `ação genérica ${i}`)),
    ];

    const result = await shortlister.shortlist(actions, { userMessage: 'quero cancelar', history: [] }, 1);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('billing.cancel');
  });

  it('nunca retorna mais que o limite', async () => {
    const client = makeFakeClient(vectorForText);
    const shortlister = new EmbeddingsShortlister({ client });
    const actions = Array.from({ length: 20 }, (_, i) => makeAction(`a.${i}`, `ação número ${i}`));

    const result = await shortlister.shortlist(actions, { userMessage: 'algo', history: [] }, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('cacheia embeddings de ações entre chamadas — não reembeda ação inalterada', async () => {
    const client = makeFakeClient(vectorForText);
    const shortlister = new EmbeddingsShortlister({ client });
    const actions = Array.from({ length: 15 }, (_, i) => makeAction(`a.${i}`, `ação estável número ${i}`));

    await shortlister.shortlist(actions, { userMessage: 'primeira consulta', history: [] }, 5);
    const callsAfterFirst = client.embeddings.create.mock.calls.length;
    expect(callsAfterFirst).toBe(2); // 1 para a query + 1 batch para as 15 ações

    await shortlister.shortlist(actions, { userMessage: 'segunda consulta diferente', history: [] }, 5);
    const callsAfterSecond = client.embeddings.create.mock.calls.length;

    // só mais 1 chamada (a nova query) — nenhuma ação foi reembedada
    expect(callsAfterSecond).toBe(callsAfterFirst + 1);
  });

  it('reembeda uma ação se a descrição dela mudar (invalidação de cache por conteúdo)', async () => {
    const client = makeFakeClient(vectorForText);
    const shortlister = new EmbeddingsShortlister({ client });
    const original = Array.from({ length: 15 }, (_, i) => makeAction(`a.${i}`, `ação estável número ${i}`));

    await shortlister.shortlist(original, { userMessage: 'consulta', history: [] }, 5);
    client.embeddings.create.mockClear();

    const changed = [...original.slice(1), makeAction('a.0', 'descrição TOTALMENTE diferente agora')];
    await shortlister.shortlist(changed, { userMessage: 'consulta 2', history: [] }, 5);

    // 1 chamada para a query + 1 chamada batch só com a ação alterada
    const batchCall = client.embeddings.create.mock.calls.find((c: any[]) => Array.isArray(c[0].input));
    expect(batchCall?.[0].input).toEqual(['descrição TOTALMENTE diferente agora']);
  });

  it('usa o histórico recente do usuário na consulta (historyWindow)', async () => {
    const client = makeFakeClient(vectorForText);
    const shortlister = new EmbeddingsShortlister({ client, historyWindow: 2 });
    const actions = Array.from({ length: 15 }, (_, i) => makeAction(`a.${i}`, `ação número ${i}`));

    await shortlister.shortlist(
      actions,
      {
        userMessage: 'e agora?',
        history: [
          { role: 'user', content: 'quero cancelar billing', timestamp: 1 },
          { role: 'assistant', content: 'confirma?', timestamp: 2 },
        ],
      },
      5,
    );

    const queryCall = client.embeddings.create.mock.calls.find((c: any[]) => typeof c[0].input === 'string');
    expect(queryCall?.[0].input).toContain('cancelar billing');
  });
});
