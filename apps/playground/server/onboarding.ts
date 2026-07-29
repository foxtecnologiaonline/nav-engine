import { z } from 'zod';
import { createOnboardingFlowRegistry, type OnboardingFlowRegistry } from '@nav-engine/core';
import type { FakeTaskDb } from './fake-db.js';

/**
 * Flow de exemplo: onboarding proativo por IA. A IA "fala primeiro" —
 * `NavEngine.startOnboarding` empurra a pergunta do 1º passo sem nenhum
 * turno de usuário associado. Cada pergunta é FIXA (definida pelo host,
 * nunca decidida pela LLM); a LLM só extrai a resposta estruturada.
 */
export function buildPlaygroundOnboardingRegistry(db: FakeTaskDb): OnboardingFlowRegistry {
  const registry = createOnboardingFlowRegistry();

  registry.register({
    key: 'business-setup',
    steps: [
      {
        key: 'name',
        question: 'Vamos configurar seu negócio. Qual é o nome dele?',
        answerSchema: z.string().min(1),
        examples: ['Padaria do João', 'Salão da Ana'],
      },
      {
        key: 'openingHours',
        question: (answers) => `Certo, "${answers.name}"! Qual o horário de atendimento?`,
        answerSchema: z.string().min(1),
        examples: ['08h às 18h, seg a sáb', '24 horas'],
      },
      {
        key: 'acceptsOnlinePayment',
        question: 'Você aceita pagamento online (cartão/pix)? Pode responder sim, não, ou pular esta pergunta.',
        answerSchema: z.boolean(),
        optional: true,
      },
    ],
    allowCancel: true,
    onComplete: async (answers) => {
      db.saveBusinessSettings({
        name: answers.name as string,
        openingHours: answers.openingHours as string,
        acceptsOnlinePayment: answers.acceptsOnlinePayment as boolean | undefined,
      });
      return {
        ok: true,
        message: `Prontinho! "${answers.name}" está configurado. Você já pode navegar pelo app.`,
        data: { navigateTo: '/app/dashboard' },
      };
    },
  });

  return registry;
}
