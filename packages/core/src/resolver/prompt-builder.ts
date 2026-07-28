/**
 * Forma mínima aceita pelo prompt builder — tanto `Action` (core) quanto
 * `CandidateActionDescriptor` (já serializado para um `LLMProvider`)
 * satisfazem essa forma estruturalmente, então qualquer um dos dois pode
 * ser passado direto.
 */
export interface PromptCatalogEntry {
  key: string;
  description: string;
  examples?: string[];
}

/**
 * System prompt compartilhado por qualquer `LLMProvider` — não é específico
 * da Anthropic. Enumera as ações do shortlist e fixa as regras de escopo.
 */
export function buildSystemPrompt(candidates: PromptCatalogEntry[], extra?: string): string {
  const catalog = candidates
    .map((a) => {
      const examples = a.examples?.length ? `\n  Exemplos: ${a.examples.join(' | ')}` : '';
      return `- ${a.key}: ${a.description}${examples}`;
    })
    .join('\n');

  return [
    'Você é o motor de navegação/ação de um app. Sua única função é traduzir o pedido do usuário em UMA das ações listadas abaixo, ou decidir que nenhuma se aplica.',
    '',
    'Ações disponíveis neste turno:',
    catalog || '(nenhuma ação disponível para este usuário agora)',
    '',
    'Regras obrigatórias:',
    '- Você só pode escolher entre as ações listadas acima. NUNCA invente uma ação ou key fora dessa lista.',
    '- Se o pedido do usuário não corresponde a nenhuma ação listada, decline por estar fora de escopo — não tente adivinhar a intenção mais próxima.',
    '- Se faltar informação obrigatória para preencher os parâmetros, ou se o pedido puder corresponder a mais de uma ação, peça esclarecimento em vez de chutar.',
    '- Seja conservador ao reportar confiança: o sistema pede esclarecimento automaticamente abaixo de um limiar, então é seguro reportar confiança baixa quando em dúvida.',
    extra ? `\n${extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
