import type {
  LLMConfirmationRequest,
  LLMConfirmationResponse,
  LLMExtractAnswerRequest,
  LLMExtractAnswerResponse,
  LLMProvider,
  LLMResolveRequest,
  LLMResolveResponse,
} from '@nav-engine/core';

/**
 * Provider de heurística léxica simples — só para o playground rodar sem
 * exigir ANTHROPIC_API_KEY. NÃO é um LLM de verdade (não entende linguagem
 * natural de verdade, só overlap de palavras-chave). Troque por
 * `AnthropicLLMProvider` (ou outro `LLMProvider` real) em qualquer uso sério.
 */
export class HeuristicLLMProvider implements LLMProvider {
  async resolveIntent(request: LLMResolveRequest): Promise<LLMResolveResponse> {
    const text = request.userMessage.toLowerCase();

    for (const action of request.candidateActions) {
      const haystack = [action.description, ...(action.examples ?? [])].join(' ').toLowerCase();
      const keywords = haystack.split(/[^a-zà-ú0-9]+/).filter((w) => w.length > 3);
      if (keywords.some((k) => text.includes(k))) {
        const titleAfterColon = request.userMessage.split(':')[1]?.trim();
        return {
          decision: {
            kind: 'action',
            actionKey: action.key,
            params: titleAfterColon ? { title: titleAfterColon } : {},
            confidence: 85,
          },
          modelTier: 'fast',
        };
      }
    }

    if (/\b(oi|ol[aá]|ajuda|hello)\b/.test(text)) {
      return {
        decision: { kind: 'chat', message: 'Oi! Posso ajudar a navegar ou executar ações do app.' },
        modelTier: 'fast',
      };
    }

    return {
      decision: {
        kind: 'out_of_scope',
        message: 'Não encontrei nada que corresponda a esse pedido nas ações disponíveis agora.',
      },
      modelTier: 'fast',
    };
  }

  async resolveConfirmation(request: LLMConfirmationRequest): Promise<LLMConfirmationResponse> {
    const text = request.userReply.toLowerCase();
    if (/\b(sim|yes|pode|confirmo|confirmar)\b/.test(text)) return { decision: 'confirmed' };
    if (/\b(n[aã]o|no|cancela|cancelar)\b/.test(text)) return { decision: 'declined' };
    return { decision: 'unclear' };
  }

  /**
   * Heurística simples de extração — NÃO é um LLM de verdade. Aceita a
   * resposta literal como valor quando o passo espera string/boolean,
   * respeitando skip/cancel só quando a política do host permite.
   */
  async extractStructuredAnswer(request: LLMExtractAnswerRequest): Promise<LLMExtractAnswerResponse> {
    const text = request.userReply.trim();
    const lower = text.toLowerCase();

    if (request.allowCancel && /\b(cancela|cancelar|para tudo|desiste)\b/.test(lower)) {
      return { decision: { kind: 'cancel' } };
    }
    if (request.allowSkip && /\b(pula|pular|skip|depois)\b/.test(lower)) {
      return { decision: { kind: 'skip' } };
    }
    if (!text) {
      return { decision: { kind: 'unclear' } };
    }

    const schemaType = (request.answerJsonSchema as { type?: string }).type;
    if (schemaType === 'boolean') {
      if (/\b(sim|yes|pode|aceito|aceita)\b/.test(lower)) {
        return { decision: { kind: 'answer', value: true, confidence: 90 } };
      }
      if (/\b(n[aã]o|no|nunca)\b/.test(lower)) {
        return { decision: { kind: 'answer', value: false, confidence: 90 } };
      }
      return { decision: { kind: 'unclear' } };
    }

    return { decision: { kind: 'answer', value: text, confidence: 90 } };
  }
}
