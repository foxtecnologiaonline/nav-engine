import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSystemPrompt } from './prompt-builder.js';
import type { Action } from '../types/action.js';

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

describe('buildSystemPrompt', () => {
  it('inclui key e description de cada ação candidata', () => {
    const prompt = buildSystemPrompt([makeAction('a.b', 'faz alguma coisa')]);
    expect(prompt).toContain('a.b');
    expect(prompt).toContain('faz alguma coisa');
  });

  it('inclui as regras de escopo obrigatórias', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toMatch(/NUNCA invente/i);
    expect(prompt).toMatch(/fora de escopo/i);
  });

  it('anexa extraSystemPrompt quando fornecido', () => {
    const prompt = buildSystemPrompt([], 'Regra extra do host.');
    expect(prompt).toContain('Regra extra do host.');
  });
});
