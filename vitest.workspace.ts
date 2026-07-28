import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/llm-anthropic/vitest.config.ts',
  'packages/adapter-fastify/vitest.config.ts',
  'packages/adapter-react/vitest.config.ts',
  'packages/stt-groq/vitest.config.ts',
  'packages/tts-groq/vitest.config.ts',
  'packages/session-redis/vitest.config.ts',
  'packages/shortlist-embeddings/vitest.config.ts',
]);
