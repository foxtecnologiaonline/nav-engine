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
