import Fastify from 'fastify';
import cors from '@fastify/cors';
import { NavEngine, InMemorySessionStore, ConsoleAuditSink, type LLMProvider } from '@nav-engine/core';
import { AnthropicLLMProvider } from '@nav-engine/llm-anthropic';
import { registerNavEngineRoutes } from '@nav-engine/adapter-fastify';
import { FakeTaskDb } from './fake-db.js';
import { buildPlaygroundRegistry } from './actions.js';
import { HeuristicLLMProvider } from './heuristic-llm-provider.js';

const db = new FakeTaskDb();
const registry = buildPlaygroundRegistry(db);

let llmProvider: LLMProvider;
if (process.env.ANTHROPIC_API_KEY) {
  llmProvider = new AnthropicLLMProvider();
  console.log('[playground] usando AnthropicLLMProvider (ANTHROPIC_API_KEY presente).');
} else {
  llmProvider = new HeuristicLLMProvider();
  console.warn(
    '[playground] ANTHROPIC_API_KEY não definido — usando HeuristicLLMProvider (NÃO é um LLM de verdade, só heurística léxica para smoke test manual).',
  );
}

const engine = new NavEngine({
  registry,
  llmProvider,
  sessionStore: new InMemorySessionStore(),
  auditSink: new ConsoleAuditSink(),
});

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

await registerNavEngineRoutes(app, {
  engine,
  getUserId: () => 'playground-user',
  resolveHostContext: () => ({ role: 'admin' }),
});

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    console.log(`[playground] servidor ouvindo em http://localhost:${port}`);
    console.log(`[playground] catálogo com ${registry.getAll().length} ações registradas.`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
