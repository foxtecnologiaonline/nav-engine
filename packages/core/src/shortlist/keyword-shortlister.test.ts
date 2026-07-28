import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KeywordShortlister } from './keyword-shortlister.js';
import type { Action } from '../types/action.js';

function makeAction(key: string, description: string, examples: string[] = []): Action {
  return {
    key,
    description,
    examples,
    paramsSchema: z.object({}),
    riskLevel: 'safe',
    checkPermission: async () => true,
    handler: async () => ({ ok: true, message: 'ok' }),
  };
}

describe('KeywordShortlister', () => {
  it('retorna todos os candidatos se couberem no limite', async () => {
    const shortlister = new KeywordShortlister();
    const actions = [makeAction('a', 'ação A'), makeAction('b', 'ação B')];
    const result = await shortlister.shortlist(actions, { userMessage: 'oi', history: [] }, 12);
    expect(result).toHaveLength(2);
  });

  it('nunca retorna mais que o limite', async () => {
    const shortlister = new KeywordShortlister();
    const actions = Array.from({ length: 50 }, (_, i) =>
      makeAction(`action.${i}`, `faz a tarefa número ${i} de configuração`),
    );
    const result = await shortlister.shortlist(
      actions,
      { userMessage: 'quero configurar a tarefa número 7', history: [] },
      12,
    );
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it('prioriza ações cujo texto tem maior overlap com a mensagem', async () => {
    const shortlister = new KeywordShortlister();
    const actions = [
      ...Array.from({ length: 30 }, (_, i) => makeAction(`filler.${i}`, `tela de configuração genérica ${i}`)),
      makeAction('billing.cancel_subscription', 'cancelar a assinatura e encerrar a cobrança recorrente', [
        'quero cancelar minha assinatura',
        'cancela meu plano',
      ]),
    ];

    const result = await shortlister.shortlist(
      actions,
      { userMessage: 'quero cancelar minha assinatura agora', history: [] },
      12,
    );

    expect(result.map((a) => a.key)).toContain('billing.cancel_subscription');
  });

  it('é determinístico para o mesmo input', async () => {
    const shortlister = new KeywordShortlister();
    const actions = Array.from({ length: 20 }, (_, i) => makeAction(`a.${i}`, `descrição ${i} sobre tarefas`));
    const query = { userMessage: 'quero ver minhas tarefas', history: [] };

    const first = await shortlister.shortlist(actions, query, 5);
    const second = await shortlister.shortlist(actions, query, 5);
    expect(first.map((a) => a.key)).toEqual(second.map((a) => a.key));
  });
});
