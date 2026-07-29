import type { CandidateActionDescriptor } from '@nav-engine/core';

export interface AnthropicToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const CONTROL_TOOL_NAMES = {
  clarify: 'ask_clarification',
  chat: 'chat_reply',
  outOfScope: 'decline_out_of_scope',
} as const;

export const CONFIRMATION_TOOL_NAME = 'classify_reply';

export const ONBOARDING_TOOL_NAMES = {
  answer: 'answer_step',
  skip: 'skip_step',
  cancel: 'cancel_onboarding',
} as const;

export function buildActionTool(
  action: CandidateActionDescriptor,
  toolName: string,
): AnthropicToolSpec {
  const examples = action.examples?.length ? `\nExemplos: ${action.examples.join(' | ')}` : '';
  return {
    name: toolName,
    description: `${action.description}${examples}`,
    input_schema: {
      type: 'object',
      properties: {
        params: action.jsonSchema,
        confidence: {
          type: 'number',
          description:
            '0-100: confiança de que esta é a ação certa com os parâmetros certos extraídos ' +
            'corretamente. Seja conservador — na dúvida, use um valor baixo.',
        },
      },
      required: ['params', 'confidence'],
    },
  };
}

export function buildControlTools(): AnthropicToolSpec[] {
  return [
    {
      name: CONTROL_TOOL_NAMES.clarify,
      description:
        'Use quando faltar informação obrigatória OU houver ambiguidade entre 2+ ações candidatas.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          ambiguous_action_keys: { type: 'array', items: { type: 'string' } },
        },
        required: ['question'],
      },
    },
    {
      name: CONTROL_TOOL_NAMES.chat,
      description: 'Use para conversa/ajuda que não executa nenhuma ação.',
      input_schema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    },
    {
      name: CONTROL_TOOL_NAMES.outOfScope,
      description:
        'Use quando o pedido do usuário NÃO corresponde a NENHUMA das ações listadas. ' +
        'Nunca invente uma ação fora da lista.',
      input_schema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    },
  ];
}

export function buildConfirmationTool(): AnthropicToolSpec {
  return {
    name: CONFIRMATION_TOOL_NAME,
    description: 'Classifica a resposta do usuário a um pedido de confirmação explícita.',
    input_schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['confirmed', 'declined', 'unclear'] },
      },
      required: ['decision'],
    },
  };
}

/** Tool sempre presente na extração de resposta de onboarding — resposta estruturada conforme o schema do passo. */
export function buildAnswerTool(answerJsonSchema: Record<string, unknown>, examples?: string[]): AnthropicToolSpec {
  const examplesText = examples?.length ? `\nExemplos de resposta válida: ${examples.join(' | ')}` : '';
  return {
    name: ONBOARDING_TOOL_NAMES.answer,
    description: `Use quando a resposta do usuário contiver a informação pedida, no formato certo.${examplesText}`,
    input_schema: {
      type: 'object',
      properties: {
        value: answerJsonSchema,
        confidence: {
          type: 'number',
          description:
            '0-100: confiança de que extraiu o valor certo da resposta. Seja conservador — na dúvida, use um valor baixo.',
        },
      },
      required: ['value', 'confidence'],
    },
  };
}

/**
 * Tools de controle do onboarding — condicionais por design (guardrail):
 * `skip`/`cancel` só entram na lista quando a POLÍTICA DO HOST permite
 * (`allowSkip`/`allowCancel`), nunca por decisão da LLM. Sempre inclui uma
 * tool de "resposta ambígua" (equivalente a `unclear`).
 */
export function buildOnboardingControlTools(options: { allowSkip: boolean; allowCancel: boolean }): AnthropicToolSpec[] {
  const tools: AnthropicToolSpec[] = [
    {
      name: 'unclear_reply',
      description: 'Use quando a resposta do usuário não permitir extrair a informação pedida com segurança.',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  if (options.allowSkip) {
    tools.push({
      name: ONBOARDING_TOOL_NAMES.skip,
      description: 'Use quando o usuário pedir explicitamente para pular esta pergunta.',
      input_schema: { type: 'object', properties: {} },
    });
  }

  if (options.allowCancel) {
    tools.push({
      name: ONBOARDING_TOOL_NAMES.cancel,
      description: 'Use quando o usuário pedir explicitamente para cancelar/parar esta configuração.',
      input_schema: { type: 'object', properties: {} },
    });
  }

  return tools;
}
