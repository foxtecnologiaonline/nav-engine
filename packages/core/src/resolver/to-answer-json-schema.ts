import { zodToJsonSchema } from 'zod-to-json-schema';
import type { OnboardingStep } from '../types/onboarding.js';

/** Análogo a `toCandidateDescriptor` — deriva o JSON Schema do `answerSchema` (zod) de um passo de onboarding. */
export function toAnswerJsonSchema(step: OnboardingStep): Record<string, unknown> {
  return zodToJsonSchema(step.answerSchema, { target: 'openApi3' }) as Record<string, unknown>;
}
