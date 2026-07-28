# nav-engine

Motor de navegação por IA (texto + voz) para instalar em qualquer app/SaaS.
O usuário conversa com o app como se fosse um chat de IA — a IA conduz o
usuário pelas decisões e configurações do produto, e o usuário pode pedir
para o app fazer ou navegar para algo, **sempre dentro de um escopo de ações
que o app host define explicitamente**. Nada fora desse escopo é executado,
nem sugerido.

Este repositório contém só o **núcleo do motor**: a lógica central, dois
adapters de referência (Fastify no backend, React no frontend) e um
provider de referência para a API da Anthropic. Ele não está integrado a
nenhum produto real ainda — a integração com um app específico é o próximo
passo, feito pelo host que instalar este pacote.

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

## Otimizações ("turbinado")

- **Shortlist em 2 estágios**: `ActionShortlister` (implementação de
  referência léxica, sem API externa) reduz um catálogo de centenas de
  ações para as ~12 mais relevantes ao turno atual antes da chamada ao LLM.
  Pluggable — troque por embeddings sem tocar no `NavEngine`.
- **Roteamento adaptativo de modelo**: tenta resolver primeiro com um
  modelo rápido/barato; só escala para um modelo mais preciso quando o
  resultado é ambíguo ou a confiança fica numa margem marginal.
- **Prompt caching** (`cache_control: ephemeral`) no bloco de sistema —
  turnos subsequentes da mesma sessão reaproveitam cache.
- **Voz bidirecional**: `TranscriptionProvider` (entrada) e `TTSProvider`
  (saída) são interfaces plugáveis — o motor pode devolver áudio da
  resposta, não só aceitar áudio como entrada.

## Pacotes

| Pacote | O que é |
|---|---|
| `@nav-engine/core` | Tipos, `ActionRegistry`, `KeywordShortlister`, `NavEngine` (máquina de estados), `InMemorySessionStore`, `ConsoleAuditSink`, `FakeLLMProvider`, `defineNavigationAction`. |
| `@nav-engine/llm-anthropic` | `AnthropicLLMProvider` — tool use forçado, roteamento fast/precise, prompt caching. |
| `@nav-engine/adapter-fastify` | `registerNavEngineRoutes(app, config)` — expõe `POST /message` e `POST /audio`. |
| `@nav-engine/adapter-react` | `useNavCopilot()` + `<NavCopilotWidget />` (chat flutuante, texto + voz). |

## Quickstart (rodar o playground)

```bash
pnpm install

# Terminal 1 — servidor (funciona sem chave de API, usando uma heurística
# léxica de demonstração; defina ANTHROPIC_API_KEY para usar Claude de verdade)
pnpm --filter playground dev:server

# Terminal 2 — frontend
pnpm --filter playground dev:web
```

Abra `http://localhost:5173` e digite no chat: "cria uma tarefa: comprar
pão", "lista minhas tarefas", "apaga todas as minhas tarefas" (pede
confirmação), "abre as configurações" (navega).

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
```

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
import { NavEngine, InMemorySessionStore, ConsoleAuditSink } from '@nav-engine/core';
import { AnthropicLLMProvider } from '@nav-engine/llm-anthropic';

const engine = new NavEngine({
  registry,
  llmProvider: new AnthropicLLMProvider(),
  sessionStore: new InMemorySessionStore(), // troque por Redis em produção
  auditSink: new ConsoleAuditSink(),        // troque pelo seu log/BD
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

## Testes

```bash
pnpm install
pnpm test        # vitest em todos os pacotes
pnpm typecheck    # tsc --noEmit em todos os pacotes
```

## Escopo desta entrega vs. próximos passos

**Construído (código real, testado):** `core` completo (registry, shortlist,
sessão, auditoria, máquina de estados do `NavEngine`, ação de navegação),
`llm-anthropic` (tool use forçado + tiering + prompt caching), adapters
Fastify e React, playground de teste manual.

**Documentado como próximo passo, não construído ainda:**
- Implementações reais de `TranscriptionProvider`/`TTSProvider` (Whisper,
  Groq, TTS real) — só as interfaces existem.
- `SessionStore` persistente (Redis ou equivalente).
- `ActionShortlister` com embeddings/busca vetorial.
- Integração com qualquer produto real (zapscript ou outro).
- Publicação como pacote npm / versionamento semântico.
- Deploy, CI/CD completo, rate limiting (fica a critério do host).
- Streaming (SSE) token-a-token da resposta de texto.

## Licença

MIT (provisória — revise antes de qualquer distribuição externa/decisão de
modelo de negócio).
