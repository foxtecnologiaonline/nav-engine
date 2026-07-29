# Guia de integração — usando o nav-engine em um app novo

Este guia é para quando você decidir instalar o nav-engine em outro
produto (não o playground de testes). É um checklist prático — o "porquê"
de cada peça está no `README.md`.

---

## 0. Como consumir o pacote hoje (ele ainda não está no npm)

O tooling de versionamento (changesets) já está configurado, mas a
publicação real exige uma decisão sua (scope/org + token). Até lá, três
caminhos possíveis, do mais rápido ao mais "de verdade":

| Caminho | Quando usar | Como |
|---|---|---|
| **Copiar a pasta do pacote** | Só quer testar rápido, 1 app | Copie `packages/core` (+ os que precisar) para dentro do novo repo, ou para um `packages/` do monorepo do novo app, se ele também for um monorepo pnpm. |
| **Git dependency direto no `package.json`** | Já sabe que vai usar em produção, sem publicar ainda | `"@nav-engine/core": "github:foxtecnologiaonline/nav-engine#main"` — funciona bem se o app novo também referenciar o pacote pelo caminho do subdiretório via `pnpm` (`workspace:` não funciona entre repos diferentes; use `"@nav-engine/core": "https://github.com/foxtecnologiaonline/nav-engine.git#main&path:packages/core"` com um gerenciador que suporte, ou publique no passo abaixo). |
| **GitHub Packages** (recomendado se for usar em 3+ apps) | Quer `pnpm add @nav-engine/core` de verdade, sem depender de comprar um scope no npm público | GitHub Packages publica pacotes com scope `@foxtecnologiaonline/*` autenticado por um token do próprio GitHub — não exige decidir/comprar nada no npm público. Quando quiser, eu configuro isso (é rápido, o changesets já está pronto pra isso). |

**Recomendação**: comece copiando a pasta ou usando git dependency para o
primeiro app. Só invista em publicação (GitHub Packages) quando for usar
em 3 ou mais produtos — é aí que a duplicação de código começa a doer.

---

## 1. Escolher os pacotes que o app novo precisa

- **Sempre**: `@nav-engine/core`
- **Backend Fastify**: `@nav-engine/adapter-fastify` + `@nav-engine/llm-anthropic`
- **Backend que NÃO é Fastify** (Express, Next.js API routes, etc.): não
  dá pra usar `adapter-fastify` — implemente as duas rotas HTTP na mão
  (`POST /message`, `POST /audio`) chamando `engine.handleMessage`/
  `engine.handleAudio` diretamente. O contrato de request/response está
  documentado no README ("Contrato HTTP") — copie o formato, não precisa
  reinventar.
- **Frontend React/Next.js**: `@nav-engine/adapter-react`
- **Opcionais, conforme necessidade**:
  - `@nav-engine/stt-groq` / `@nav-engine/tts-groq` — só se quiser voz de verdade
  - `@nav-engine/session-redis` — só quando for pra produção multi-instância
  - `@nav-engine/shortlist-embeddings` — só se o catálogo de ações crescer
    muito (dezenas+) e o `KeywordShortlister` léxico (default, grátis)
    começar a errar a mão

---

## 2. O trabalho de verdade: modelar as ações do app novo

Isso é 80% do esforço de integração — o motor já está pronto, o que falta
é **você decidir o que a IA pode fazer nesse app específico**.

1. Liste o que o usuário deveria conseguir pedir por chat/voz: navegar
   para telas, criar/editar registros, consultar status, mudar
   configurações.
2. Para cada item, registre uma `Action`:
   - `key`: única, hierárquica (`modulo.acao`)
   - `description`: em linguagem natural — é o que a IA lê pra decidir
     quando usar. Escreva como explicaria pra uma pessoa, não como nome de
     função.
   - `paramsSchema`: zod — só os campos que a ação realmente precisa
   - `riskLevel`: `safe` (executa direto), `confirm` (side-effect
     destrutivo/irreversível/financeiro), `blocked` (nunca disponível a
     menos que você libere explicitamente numa chamada específica)
   - `checkPermission`: **reaproveite o sistema de auth/roles que o app já
     tem** — nunca escreva uma checagem nova só para o nav-engine
   - `handler`: chame a lógica de negócio já existente do app (service,
     repository, o que for) — o motor nunca deve ganhar lógica de negócio
     própria
3. Ações de navegação: use `defineNavigationAction` para cada rota
   importante do app (telas de configuração, dashboards, etc.).
4. **Regra de ouro**: nunca registre uma ação "coringa" (tipo "executa uma
   query", "roda um script") — cada ação tem que ser específica, com
   escopo fechado. É isso que faz o motor ser seguro por design.

---

## 3. Decidir o layout do chat (painel fixo, bolha, ou os dois por modo)

- **Produto é um site/web**, chat convive lado a lado com a UI: use
  `<NavCopilotPanel />` (painel fixo do lado direito) direto, sem seletor.
- **Produto é um app**, onde a interface gráfica tradicional é o padrão:
  pergunte "Modo App ou Modo Chat?" na entrada com `useNavMode()` +
  `<NavModeSelector />` — "Modo Chat" renderiza `<NavCopilotPanel />`
  (chat dominante), "Modo App" renderiza sua UI normal + `<NavCopilotWidget />`
  (bolha flutuante secundária). Veja `apps/playground/web/src/App.tsx` para
  o exemplo completo dos dois modos.

## 4. (Opcional) Onboarding proativo — a IA "fala primeiro"

Se o app tem um fluxo de configuração inicial (nome do negócio, horário de
atendimento, preferências), considere modelá-lo como um `OnboardingFlow`
em vez de só esperar o usuário pedir. Diferente de uma `Action`, aqui **a
IA inicia a conversa**: `engine.startOnboarding(ctx, flowKey)` empurra a
pergunta do 1º passo sem nenhum turno de usuário associado.

- Cada `OnboardingStep.question` é **fixa** (string ou função das respostas
  já dadas) — nunca decidida pela LLM, só a extração da resposta é.
- Marque `optional: true` num passo só se fizer sentido pular; marque
  `allowCancel: false` no flow se o usuário nunca puder abortar aquela
  configuração específica — ambos são decisão sua, nunca da LLM.
- `onComplete` é onde entra a lógica de negócio real (salvar no seu banco,
  etc.) — mesmo princípio da seção 2: o motor nunca ganha lógica de negócio
  própria.
- Use a prop `autoStartOnboarding="minha-flow-key"` em `<NavCopilotPanel />`/
  `<NavCopilotWidget />` para disparar automaticamente ao montar (só quando
  a sessão ainda não tem mensagens — não repete em usuários recorrentes).
- Requer que o `LLMProvider` escolhido implemente `extractStructuredAnswer`
  (`AnthropicLLMProvider` já implementa; `FakeLLMProvider`, para testes,
  também). Veja a seção "Onboarding proativo por IA" no `README.md` para o
  exemplo completo e os guardrails de segurança envolvidos.

---

## 5. Escolher os providers por ambiente

| Ambiente | LLM | Sessão | Voz |
|---|---|---|---|
| **Dev local** | `FakeLLMProvider` (core) — zero custo, zero API key, testa a lógica das ações sem gastar token | `InMemorySessionStore` | não precisa |
| **Staging/produção** | `AnthropicLLMProvider` (`ANTHROPIC_API_KEY`) | `RedisSessionStore` (client Redis que o app já tiver) | `GroqWhisperProvider`/`GroqTTSProvider` (`GROQ_API_KEY`, `OPENAI_API_KEY` opcional como fallback) se quiser voz |

Rate limiting: **ligue sempre em produção** — `InMemoryTokenBucketRateLimiter`
basta para uma instância; se o app rodar múltiplas instâncias, prefira uma
implementação distribuída (Redis) antes de ir ao ar.

---

## 6. Variáveis de ambiente a configurar no app novo

```bash
ANTHROPIC_API_KEY=       # obrigatório em produção (LLM real)
GROQ_API_KEY=            # opcional — voz de entrada/saída real
OPENAI_API_KEY=          # opcional — fallback de voz se o Groq falhar
```

---

## 7. Ordem sugerida de implementação

1. Instalar os pacotes escolhidos (seção 1)
2. Criar um arquivo dedicado registrando as ações (ex.: `src/nav-engine/actions.ts`)
3. (Opcional) Criar um `OnboardingFlowRegistry` se houver um fluxo de configuração inicial (seção 4)
4. Instanciar o `NavEngine` uma vez, num módulo compartilhado (não recrie a cada request)
5. Expor as rotas HTTP (`registerNavEngineRoutes` ou handlers manuais)
6. Montar `<NavCopilotPanel />`/`<NavCopilotWidget />` (+ `useNavMode`/`NavModeSelector` se for app) no layout principal do frontend (seção 3)
7. **Testar localmente com `FakeLLMProvider` antes de gastar tokens** — cobre a lógica das ações (permissão, execução, navegação) sem depender da IA
8. Trocar para `AnthropicLLMProvider` com uma chave de teste, validar de verdade com linguagem natural (incluindo o onboarding, se houver)
9. Antes de produção: `RedisSessionStore` + rate limiting + `AuditSink` de verdade (ver checklist abaixo)

---

## 8. Checklist de segurança antes de ir para produção

- [ ] Toda ação sensível/irreversível está com `riskLevel: 'confirm'`?
- [ ] `checkPermission` cobre multi-tenant/roles corretamente em 100% das ações?
- [ ] `getUserId` deriva do auth do próprio app — nunca confia em nada vindo do body?
- [ ] `AuditSink` real persistindo em banco/log (não `ConsoleAuditSink`)?
- [ ] Rate limiter ligado?
- [ ] Nenhuma ação "coringa"/genérica registrada (ver regra de ouro na seção 2)?
- [ ] `SessionStore` persistente se o app rodar mais de uma instância?
- [ ] Se usa onboarding: `optional`/`allowCancel` de cada passo/flow refletem a política real do negócio (nunca deixadas "abertas por padrão" sem revisar)?

---

## 9. Quando fizer sentido publicar de verdade

Se o nav-engine passar a ser usado em 3+ produtos seus, vale investir em
publicação real via GitHub Packages (mais rápido que decidir um scope no
npm público, e usa autenticação que você já tem). O tooling de
versionamento (`pnpm changeset` / `pnpm version` / `pnpm release`) já está
pronto para isso — só falta configurar o registry e o token quando
decidir.
