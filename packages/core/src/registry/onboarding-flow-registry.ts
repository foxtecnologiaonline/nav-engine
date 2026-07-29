import type { OnboardingFlow, OnboardingFlowRegistry } from '../types/onboarding.js';
import { DuplicateOnboardingFlowKeyError } from '../errors.js';

export function createOnboardingFlowRegistry(): OnboardingFlowRegistry {
  const flows = new Map<string, OnboardingFlow>();

  return {
    register(flow) {
      if (flows.has(flow.key)) {
        throw new DuplicateOnboardingFlowKeyError(flow.key);
      }
      flows.set(flow.key, flow);
    },

    get(key) {
      return flows.get(key);
    },
  };
}
