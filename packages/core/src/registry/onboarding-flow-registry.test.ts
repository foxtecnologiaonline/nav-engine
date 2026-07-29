import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createOnboardingFlowRegistry } from './onboarding-flow-registry.js';
import type { OnboardingFlow } from '../types/onboarding.js';

function makeFlow(overrides: Partial<OnboardingFlow> = {}): OnboardingFlow {
  return {
    key: 'demo-flow',
    steps: [{ key: 'name', question: 'Qual seu nome?', answerSchema: z.string() }],
    onComplete: async () => ({ ok: true, message: 'concluído' }),
    ...overrides,
  };
}

describe('createOnboardingFlowRegistry', () => {
  it('registra e recupera um flow por key', () => {
    const registry = createOnboardingFlowRegistry();
    const flow = makeFlow();
    registry.register(flow);
    expect(registry.get('demo-flow')).toBe(flow);
  });

  it('lança erro em key duplicada', () => {
    const registry = createOnboardingFlowRegistry();
    registry.register(makeFlow());
    expect(() => registry.register(makeFlow())).toThrow(/duplicado/i);
  });

  it('get devolve undefined para key inexistente', () => {
    const registry = createOnboardingFlowRegistry();
    expect(registry.get('nope')).toBeUndefined();
  });
});
