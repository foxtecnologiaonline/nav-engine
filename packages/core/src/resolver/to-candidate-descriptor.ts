import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Action } from '../types/action.js';
import type { CandidateActionDescriptor } from '../types/llm.js';

export function toCandidateDescriptor(action: Action): CandidateActionDescriptor {
  return {
    key: action.key,
    description: action.description,
    riskLevel: action.riskLevel,
    jsonSchema: zodToJsonSchema(action.paramsSchema, { target: 'openApi3' }) as Record<
      string,
      unknown
    >,
    examples: action.examples,
  };
}
