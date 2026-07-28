import type { Action } from '../types/action.js';

export interface EngineTemplates {
  confirmationPrompt: (action: Action, params: unknown) => string;
  clarificationGiveUp: string;
  /** Usado quando o LLMProvider/registry falha (rede, timeout, exceção) — nunca deixa o turno sem resposta. */
  providerError: string;
}

export const defaultTemplates: EngineTemplates = {
  confirmationPrompt: (action) =>
    `Confirma: ${action.description}? Responda "sim" para prosseguir ou "não" para cancelar.`,
  clarificationGiveUp:
    'Não consegui entender o que você precisa. Pode tentar de novo com mais detalhes ou reformular o pedido?',
  providerError: 'Não consegui processar seu pedido agora. Tente novamente em instantes.',
};
