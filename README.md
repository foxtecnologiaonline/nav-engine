# nav-engine

Motor de navegação por IA (texto + voz) para instalar em qualquer app/SaaS.
O usuário conversa com o app como se fosse um chat de IA — a IA conduz o
usuário pelas decisões e configurações do produto, e o usuário pode pedir
para o app fazer ou navegar para algo, **sempre dentro de um escopo de ações
que o app host define explicitamente**. Nada fora desse escopo é executado,
nem sugerido.

Este repositório contém só o **núcleo do motor**: a lógica central, dois
adapters de referência (Fastify no backend, React no frontend), um
provider de referência para a API da Anthropic, e providers de voz/sessão
prontos para produção (`stt-groq`, `session-redis`). Ele não está integrado
a nenhum produto real ainda — a integração com um app específico é o
próximo passo, feito pelo host que instalar este pacote.

> Vai instalar em outro app? Veja **[GUIA-DE-INTEGRACAO.md](./GUIA-DE-INTEGRACAO.md)**
> — checklist prático de como consumir o pacote hoje, o que modelar, quais
> providers escolher por ambiente, e o que checar antes de produção.

## Por que existe

A maioria dos "comandos de voz"/chatbots embutidos em produtos são
implementações ad-hoc: um switch fixo de poucos intents, parsing de JSON
solto por regex sobre a resposta de um LLM, sem confirmação antes de agir, e
sem um jeito de garantir que a IA nunca faça algo fora do que o produto
permite. O nav-engine resolve isso como uma peça de infraestrutura
reutilizável:

- **Registry de ações explícito** — o host declara exatamente o que a IA
  pode fazer (nenhuma ação existe "por acaso").
- **Extração via tool use forçado**, não regex sobre texto livre.
- **Default-deny rígido**: se o LLM referenciar uma ação que não fazia parte
  do menu enviado naquele turno, o motor trata como alucinação e nunca
  executa — nunca "confia no crédito" do que o modelo disse.
- **Risco por ação**: ações sensíveis exigem confirmação explícita do
  usuário no turno seguinte antes de rodar; ações "blocked" nunca entram no
  menu a menos que o host libere explicitamente naquela chamada.
- **Navegação como cidadão de primeira classe**: "me leva pra tela de X" é
  uma ação tão nativa quanto "cria uma tarefa".
- **Escalável de verdade**: um app com centenas de ações/telas não devia
  mandar todas como "tools" do LLM a cada turno — o motor faz um shortlist
  em 2 estágios antes de qualquer chamada cara ao modelo.

## Arquitetura

```
packages/
  core/            núcleo agnóstico — zero dependência de framework
  llm-anthropic/   provider de referência (Anthropic, tool use forçado)
  adapter-fastify/ expõe o motor como rotas HTTP (POST /message, /audio)
  adapter-react/   widget de chat (texto + voz) para qualquer app React
  stt-groq/        TranscriptionProvider real (Groq Whisper + fallback OpenAI)
  tts-groq/        TTSProvider real (Groq playai-tts + fallback OpenAI TTS)
  session-redis/   SessionStore persistente (compatível com ioredis)
  shortlist-embeddings/ ActionShortlister semântico via embeddings (OpenAI)

apps/
  playground/      servidor + página mínimos para testar tudo manualmente
```

```
usuário digita/fala
        │
        ▼
NavCopilotWidget (adapter-react) ──HTTP──► registerNavEngineRoutes (adapter-fastify)
                                                        │
                                                        ▼
                                                    NavEngine (core)
                                                        │
                             ┌──────────────┬───────────┼────────────┬──────────────┐
                             ▼              ▼           ▼            ▼              ▼
                      ActionRegistry  ActionShortlister LLMProvider SessionStore  AuditSink
                      (ações do host)  (reduz catálogo) (decide intenção) (memória) (log)
```

O `core` nunca fala com HTTP, React, Anthropic ou qualquer banco de dados —
tudo isso é injetado pelo host através de interfaces (`LLMProvider`,
`SessionStore`, `AuditSink`, `TranscriptionProvider`, `TTSProvider`) ou
implementado nos adapters.

## Guardrails de segurança (invariantes, não sugestões de prompt)

1. **A LLM nunca decide risco.** Ela só decide qual ação + parâmetros (ou
   clarificar/conversar/recusar). `riskLevel` vem 100% do registry do host.
2. **Default-deny + guarda anti-alucinação.** O conjunto de ações candidatas
   é montado (permissão + shortlist) *antes* de qualquer chamada ao LLM. Se
   a resposta referenciar uma ação fora desse conjunto, o motor nunca
   executa — audita como `hallucination_blocked`.
3. **`blocked` é opt-in explícito por chamada**, nunca decidido pela LLM.
4. **Confirmação é uma decisão separada e mais estreita** — nunca uma
   reformulação do menu completo de ações.
5. **Validação de parâmetros sempre via `zod` no core**, mesmo com tool use
   estruturado do provider.
6. **Permissão checada duas vezes**: ao montar candidatos e de novo
   imediatamente antes de executar (defesa em profundidade).
7. **Escalação de modelo nunca reduz rigor** — só decide qual modelo
   responde, nunca pula validação/confiança.
8. **Falha do provider nunca derruba o turno.** Se o `LLMProvider` (rede,
   timeout, erro da API) ou o registry/shortlister lançar exceção, o
   `NavEngine` captura, audita como `provider_error` e devolve uma resposta
   graciosa — nunca uma promise rejeitada sem tratamento. Falha durante uma
   confirmação pendente preserva o `pending`, para o usuário poder tentar de
   novo no próximo turno.

## Otimizações ("turbinado")

- **Shortlist em 2 estágios**: `ActionShortlister` reduz um catálogo de
  centenas de ações para as ~12 mais relevantes ao turno atual antes da
  chamada ao LLM. Duas implementações prontas: `KeywordShortlister` (core,
  léxico, sem API externa) e `EmbeddingsShortlister`
  (`@nav-engine/shortlist-embeddings`, semântico via embeddings da OpenAI,
  com cache por ação) — troque uma pela outra sem tocar no `NavEngine`.
- **Roteamento adaptativo de modelo**: tenta resolver primeiro com um
  modelo rápido/barato; só escala para um modelo mais preciso quando o
  resultado é ambíguo ou a confiança fica numa margem marginal.
- **Prompt caching** (`cache_control: ephemeral`) no bloco de sistema —
  turnos subsequentes da mesma sessão reaproveitam cache.
- **Voz bidirecional real**: `TranscriptionProvider` (entrada,
  `@nav-engine/stt-groq`) e `TTSProvider` (saída, `@nav-engine/tts-groq`) —
  o motor devolve áudio de verdade da resposta, não só aceita áudio como
  entrada. Mesmo padrão primário+fallback (Groq → OpenAI) nos dois sentidos.
- **Observabilidade de custo/latência**: toda entrada de auditoria carrega
  `latencyMs` e `tokenUsage` (input/output tokens, somados entre as
  chamadas fast+precise quando há escalada) — dá visibilidade real para
  ajustar `shortlistSize`/thresholds sem adivinhar.

## Onboarding proativo por IA

Além do chat reativo (usuário pede, IA executa), o motor também guia
sub-fluxos de configuração em que **a IA fala primeiro** — uma sequência
FIXA de perguntas definida pelo host, nunca inventada pela LLM. A LLM só
extrai a resposta estruturada de cada passo; ela nunca decide o que
perguntar nem quando encerrar o fluxo.

```ts
import { z } from 'zod';
import { createOnboardingFlowRegistry } from '@nav-engine/core';

const onboardingRegistry = createOnboardingFlowRegistry();

onboardingRegistry.register({
  key: 'business-setup',
  steps: [
    { key: 'name', question: 'Qual o nome do seu negócio?', answerSchema: z.string().min(1) },
    {
      key: 'openingHours',
      question: (answers) => `Certo, "${answers.name}"! Qual o horário de atendimento?`,
      answerSchema: z.string().min(1),
    },
    {
      key: 'acceptsOnlinePayment',
      question: 'Aceita pagamento online? (pode pular)',
      answerSchema: z.boolean(),
      optional: true, // só aqui a LLM pode oferecer "pular"
    },
  ],
  allowCancel: true, // só aqui a LLM pode oferecer "cancelar"
  onComplete: async (answers, ctx) => {
    await myBusinessService.save(ctx.userId, answers);
    return { ok: true, message: 'Tudo configurado!', data: { navigateTo: '/app/dashboard' } };
  },
});

const engine = new NavEngine({ registry, onboardingRegistry, llmProvider, sessionStore, auditSink });

// Dispara o fluxo — a resposta vem como turno assistant, sem turno de usuário associado.
await engine.startOnboarding({ sessionId, userId, hostContext }, 'business-setup');
```

Guardrails que valem aqui (mesmos princípios do resto do motor, aplicados a
um sub-fluxo fechado):

- **Perguntas são sempre fixas** (definidas pelo host) — a LLM nunca decide
  o roteiro, só classifica a resposta do usuário a cada passo.
- **Sair do fluxo é uma decisão de controle fechada** (`skip`/`cancel`),
  nunca uma reabertura do resolvedor de ações normal — `skip` só é
  oferecido à LLM quando `step.optional` é `true`, `cancel` só quando
  `flow.allowCancel !== false`, e o motor **revalida isso de novo**
  (defesa em profundidade) mesmo que a LLM devolva `skip`/`cancel` fora de
  política.
- **`resolveIntent`/`getCandidateActions` nunca são chamados durante um
  onboarding em curso** — isolamento total de escopo entre o sub-fluxo e o
  resolvedor de ações livre.
- **`onComplete` do host tem o mesmo tratamento de resiliência que
  `Action.handler`** — uma exceção nunca escapa sem tratamento; devolve uma
  resposta de fallback e audita `onboarding_completion_failed`.
- Esgotar `maxOnboardingRetriesPerStep` (default 3) desiste graciosamente
  do fluxo (`onboarding_abandoned`) em vez de travar a conversa.
- Requer que o `LLMProvider` implemente `extractStructuredAnswer` (método
  **opcional** na interface — `AnthropicLLMProvider` já implementa; um
  provider que não implementa lança um erro claro se `startOnboarding` for
  chamado).

No adapter Fastify: `POST {prefix}/onboarding/start`. No adapter React:
`useNavCopilot().startOnboarding(flowKey)`, ou a prop `autoStartOnboarding`
em `<NavCopilotPanel />`/`<NavCopilotWidget />` (dispara automaticamente ao
montar, uma única vez, quando ainda não há mensagens na sessão).

## Layout do chat: painel fixo, bolha flutuante, ou os dois por modo

O adapter React expõe 3 peças que se combinam conforme o tipo de produto:

- **`<NavCopilotPanel />`** — painel fixo do lado direito, sempre visível
  (`position: fixed; top:0; right:0; bottom:0`). Uso típico: **site/web**,
  onde o chat é dominante e convive lado a lado com a interface gráfica.
- **`<NavCopilotWidget />`** — bolha flutuante que abre/fecha por cima da
  tela. Uso típico: chat secundário, complementar à interface gráfica
  tradicional.
- **`useNavMode()` + `<NavModeSelector />`** — para **apps**, onde o
  produto pergunta "Modo App ou Modo Chat?" na entrada e o usuário escolhe:
  "Modo Chat" renderiza o painel fixo (chat dominante), "Modo App" renderiza
  a interface gráfica normal + o widget flutuante (chat secundário). A
  escolha persiste em `localStorage`; a composição de qual componente
  renderizar em cada modo é responsabilidade do host (ver `apps/playground`
  para um exemplo completo).

```tsx
const { mode, setMode, hasChosen } = useNavMode();

if (!hasChosen) return <NavModeSelector onSelect={setMode} />;

return mode === 'chat' ? (
  <NavCopilotPanel apiBaseUrl="/api" sessionId={sessionId} autoStartOnboarding="business-setup" />
) : (
  <>
    <MyGraphicalApp />
    <NavCopilotWidget apiBaseUrl="/api" sessionId={sessionId} autoStartOnboarding="business-setup" />
  </>
);
```

Para "site" (sempre painel fixo, sem escolha), passe `defaultMode: 'chat'`
para `useNavMode()` e pule o `NavModeSelector`.

## Pacotes

| Pacote | O que é |
|---|---|
| `@nav-engine/core` | Tipos, `ActionRegistry`, `OnboardingFlowRegistry`, `KeywordShortlister`, `NavEngine` (máquina de estados, resiliente a falha do provider, onboarding proativo), `InMemorySessionStore` (com TTL + LRU), `ConsoleAuditSink`, `FakeLLMProvider`, `defineNavigationAction`. |
| `@nav-engine/llm-anthropic` | `AnthropicLLMProvider` — tool use forçado, roteamento fast/precise, prompt caching, `maxRetries`, uso de tokens, `extractStructuredAnswer` (onboarding). |
| `@nav-engine/adapter-fastify` | `registerNavEngineRoutes(app, config)` — expõe `POST /message`, `POST /audio` e `POST /onboarding/start`, com rate limiting opcional (`InMemoryTokenBucketRateLimiter`). |
| `@nav-engine/adapter-react` | `useNavCopilot()` (com `startOnboarding`), `<NavCopilotWidget />` (bolha flutuante), `<NavCopilotPanel />` (painel fixo), `useNavMode()` + `<NavModeSelector />` (seletor Modo App/Chat). |
| `@nav-engine/stt-groq` | `GroqWhisperProvider` — Groq Whisper primário + fallback automático para OpenAI Whisper. |
| `@nav-engine/tts-groq` | `GroqTTSProvider` — Groq `playai-tts` primário + fallback automático para OpenAI TTS. |
| `@nav-engine/session-redis` | `RedisSessionStore` — persiste sessões via qualquer client compatível com `ioredis` (TTL renovado a cada turno). |
| `@nav-engine/shortlist-embeddings` | `EmbeddingsShortlister` — shortlist semântico via embeddings da OpenAI, com cache por ação. |

## Quickstart (rodar o playground)

```bash
pnpm install

# Terminal 1 — servidor (funciona sem nenhuma chave, usando uma heurística
# léxica de demonstração; defina ANTHROPIC_API_KEY para usar Claude de
# verdade, e GROQ_API_KEY para voz bidirecional real: transcreve /audio via
# Whisper e devolve audioBase64 sintetizado nas respostas de texto/áudio)
pnpm --filter playground dev:server

# Terminal 2 — frontend
pnpm --filter playground dev:web
```

Abra `http://localhost:5173`: primeiro escolha "Modo App" ou "Modo Chat"
(`NavModeSelector`) — em qualquer um dos dois a IA já fala primeiro,
puxando o onboarding "business-setup" (nome do negócio → horário →
aceita pagamento online, opcional). Depois disso, digite comandos livres:
"cria uma tarefa: comprar pão", "lista minhas tarefas", "apaga todas as
minhas tarefas" (pede confirmação), "abre as configurações" (navega).

## Contrato HTTP (fonte da verdade — independente de linguagem/backend)

```
POST {prefix}/message                       (default prefix: /nav-engine)
Body:     { sessionId: string, message: string, hostContext?: object }
Response: {
  reply: string,
  status: 'executed' | 'awaiting_confirmation' | 'awaiting_clarification'
        | 'chat' | 'declined' | 'out_of_scope' | 'error',
  action?: { key: string, description: string } | null,
  executionOk?: boolean,
  navigateTo?: string,        // presente quando a ação executada era de navegação
  audioBase64?: string,       // presente só se o host configurou um TTSProvider
  audioMimeType?: string,
}

POST {prefix}/audio   (multipart/form-data)
Fields:   sessionId, hostContext (JSON string, opcional), audio (arquivo)
Response: igual ao /message

POST {prefix}/onboarding/start
Body:     { sessionId: string, flowKey: string, hostContext?: object }
Response: igual ao /message, incluindo:
  onboarding?: { flowKey: string, stepIndex: number, totalSteps: number, completed: boolean }
```

`onboarding` (no `/message` e no `/onboarding/start`) só aparece enquanto um
fluxo está em curso ou acabou de completar naquele turno — ausente em
qualquer resposta fora de um onboarding.

Nota de segurança: `userId` **não** vem do body — o adapter Fastify sempre
deriva o usuário autenticado via `getUserId(req)`, fornecido pelo host (ex.:
lendo o JWT já validado). Nunca confie em identidade vinda do client.

## Como um host integraria (guia conceitual)

```ts
// 1. Declare suas ações
import { z } from 'zod';
import { createActionRegistry, defineNavigationAction } from '@nav-engine/core';

const registry = createActionRegistry();

registry.register({
  key: 'billing.cancel_subscription',
  description: 'cancelar a assinatura do usuário',
  paramsSchema: z.object({}),
  riskLevel: 'confirm', // exige confirmação explícita
  checkPermission: async (ctx) => userOwnsAccount(ctx.userId, ctx.hostContext),
  handler: async (_params, ctx) => {
    await myBillingService.cancel(ctx.userId);
    return { ok: true, message: 'Assinatura cancelada.' };
  },
});

registry.register(
  defineNavigationAction({
    key: 'nav.go_to_billing',
    description: 'ir para a tela de faturamento',
    to: () => '/app/billing',
  }),
);

// 2. Instancie o motor
import { NavEngine, ConsoleAuditSink } from '@nav-engine/core';
import { AnthropicLLMProvider } from '@nav-engine/llm-anthropic';
import { RedisSessionStore } from '@nav-engine/session-redis'; // ou InMemorySessionStore p/ prototipar
import { GroqWhisperProvider } from '@nav-engine/stt-groq';     // opcional, p/ voz de entrada
import { GroqTTSProvider } from '@nav-engine/tts-groq';         // opcional, p/ voz de saída

const engine = new NavEngine({
  registry,
  llmProvider: new AnthropicLLMProvider(),
  sessionStore: new RedisSessionStore({ client: myIoredisClient }),
  auditSink: new ConsoleAuditSink(),        // troque pelo seu log/BD
  transcriptionProvider: new GroqWhisperProvider({ openaiApiKey: process.env.OPENAI_API_KEY }),
  ttsProvider: new GroqTTSProvider({ openaiApiKey: process.env.OPENAI_API_KEY }),
});

// 3. Exponha as rotas HTTP
import { registerNavEngineRoutes } from '@nav-engine/adapter-fastify';

await registerNavEngineRoutes(app, {
  engine,
  getUserId: (req) => req.user.id, // do seu próprio middleware de auth
  resolveHostContext: (req) => ({ role: req.user.role, tenantId: req.user.tenantId }),
});

// 4. Monte o widget no frontend
import { NavCopilotWidget } from '@nav-engine/adapter-react';

<NavCopilotWidget
  apiBaseUrl="/api"
  sessionId={sessionId}
  hostContext={{ role: user.role }}
  onNavigate={(path) => router.push(path)}
/>
```

## Testes e CI

```bash
pnpm install
pnpm test        # vitest em todos os pacotes
pnpm typecheck    # tsc --noEmit em todos os pacotes
pnpm lint         # eslint na raiz
```

`.github/workflows/ci.yml` roda install + lint + typecheck + build + test
em todo push/PR para `main`.

## Rate limiting (opcional)

`adapter-fastify` protege `/message`/`/audio` contra abuso se você passar
`rateLimiter`:

```ts
import { registerNavEngineRoutes, InMemoryTokenBucketRateLimiter } from '@nav-engine/adapter-fastify';

await registerNavEngineRoutes(app, {
  engine,
  getUserId: (req) => req.user.id,
  rateLimiter: {
    limiter: new InMemoryTokenBucketRateLimiter({ capacity: 20, refillRatePerSecond: 1 / 3 }), // ~20/min
    // keyFor?: (req) => string — default usa getUserId(req)
  },
});
```

Sem `rateLimiter`, não há limite algum (fica a critério do host). A
implementação de referência é em memória (token bucket, LRU) — troque por
Redis em produção multi-instância.

## Versionamento (changesets)

O monorepo usa [changesets](https://github.com/changesets/changesets) para
versionamento semântico:

```bash
pnpm changeset          # descreve o que mudou, gera um arquivo em .changeset/
pnpm version            # aplica changesets pendentes: bump de versão + changelog
pnpm release            # build + publica no npm (exige NPM_TOKEN configurado)
```

Todos os pacotes ainda são `"private": true` — o tooling de versionamento
já funciona (rode `pnpm changeset` a cada mudança relevante), mas a
publicação real no npm está deliberadamente **fora do escopo automatizado**
desta entrega: exige decidir um scope/org no npm (`@nav-engine` pode não
estar disponível) e configurar `NPM_TOKEN`, uma decisão do dono do projeto,
não algo para assumir sozinho.

## Escopo desta entrega vs. próximos passos

**Construído (código real, testado):** `core` completo (registry, shortlist
léxico + `KeywordShortlister`, sessão em memória com TTL/LRU, auditoria com
latência/uso de tokens, máquina de estados do `NavEngine` resiliente a
falha do provider, ação de navegação, **onboarding proativo por IA com
`OnboardingFlowRegistry`**), `llm-anthropic` (tool use forçado + tiering +
prompt caching + `maxRetries` + `extractStructuredAnswer`), adapters
Fastify (`/message`, `/audio`, `/onboarding/start` + rate limiting
opcional) e React (`NavCopilotWidget`, `NavCopilotPanel` painel fixo,
`useNavMode`/`NavModeSelector`, `startOnboarding`/`autoStartOnboarding`),
`stt-groq`/`tts-groq` (voz bidirecional real, Groq + fallback OpenAI nos
dois sentidos), `session-redis` (persistência via qualquer client
compatível com ioredis), `shortlist-embeddings` (shortlist semântico via
embeddings, alternativa ao léxico), CI no GitHub Actions, tooling de
versionamento (changesets), playground de teste manual demonstrando tudo
isso junto (modo App/Chat + onboarding proativo).

**Documentado como próximo passo, não construído ainda:**
- Integração com qualquer produto real (zapscript ou outro) — decisão de
  escopo grande demais para assumir sozinho num app de produção; exige
  decidir quais ações registrar e como migrar sistemas existentes.
- Publicação real no npm — tooling pronto (changesets), falta decisão de
  scope/org + `NPM_TOKEN` do dono do projeto.
- Deploy (fica a critério do host).
- Streaming (SSE) token-a-token da resposta de texto.

## Licença

MIT (provisória — revise antes de qualquer distribuição externa/decisão de
modelo de negócio).
