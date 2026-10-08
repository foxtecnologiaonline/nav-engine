---
name: integrate-nav-engine
description: Integra o nav-engine (motor de navegação/controle por voz e texto via IA, com guardrails de segurança) num app/SaaS. Use quando o usuário pedir para "integrar o nav-engine", "adicionar comandos de voz/chat com IA" num app, "chamar o mecanismo de voz", ou citar o repo foxtecnologiaonline/nav-engine querendo instalar em outro produto.
---

# Integrar o nav-engine num app

Você é uma sessão do Claude Code que acabou de ser chamada para integrar o
**nav-engine** (`foxtecnologiaonline/nav-engine`) num app real. Este skill é
autossuficiente — não assuma que há contexto de conversa anterior sobre o
nav-engine.

O nav-engine é um motor de IA (texto + voz) que deixa o usuário comandar um
app por linguagem natural, **sempre dentro de um escopo de ações que o
próprio app declara explicitamente** — nada fora disso é executado, nem
sugerido pela IA. Guardrails centrais (nunca contornar, detalhe completo no
README do nav-engine): default-deny anti-alucinação, `riskLevel` sempre
decidido pelo host (nunca pela LLM), permissão sempre delegada ao
auth/roles que o app-alvo já tem, nenhuma ação "coringa".

## Passo 0 — garantir acesso ao código do nav-engine

Se o repositório `foxtecnologiaonline/nav-engine` ainda não estiver
disponível nesta sessão, use `add_repo` (owner `foxtecnologiaonline`, repo
`nav-engine`) e, após o clone, `register_repo_root` — isso carrega o
`CLAUDE.md`/skills dele automaticamente nos próximos turnos. Depois, leia:
- `README.md` do nav-engine — arquitetura, guardrails, contrato HTTP, a
  seção "Como um host integraria".
- `GUIA-DE-INTEGRACAO.md` — checklist prático.

Se o app-alvo (onde você vai integrar) ainda não é o diretório de
trabalho principal desta sessão, pergunte ao usuário qual repositório é, e
use `add_repo`/clone se necessário.

## Passo 1 — entender o app-alvo antes de decidir qualquer coisa

Explore o app-alvo (não pergunte o que dá pra descobrir sozinho lendo o
código):
- Framework de backend (Fastify? Express? Next.js API routes? outro?) —
  determina se dá pra usar `@nav-engine/adapter-fastify` direto ou se
  precisa implementar `POST /message`/`POST /audio` na mão.
- Framework de frontend (React? Next.js? outro?) — `@nav-engine/adapter-react`
  só serve pra React/Next.js. Se for outro framework, isso precisa virar
  uma pergunta ao usuário (ver Passo 2).
- Sistema de auth existente (como o app já identifica o usuário logado e
  seus papéis/roles) — **nunca** crie um sistema de permissão novo para o
  nav-engine, sempre reaproveite o que já existe.
- Tamanho aproximado do catálogo de ações que a IA deveria poder executar
  (algumas poucas? dezenas? centenas?) — decide shortlister e se vale usar
  modelagem declarativa (Passo 3).

Só pergunte ao usuário o que genuinamente não dá pra inferir do código:
tipicamente "quais ações/telas você quer que a IA controle" (a lista de
intents em si é decisão de produto, não técnica) e "painel fixo, bolha, ou
orbe de voz estilo Siri" se o tipo de produto não deixar óbvio.

## Passo 2 — decidir como consumir o pacote

O nav-engine ainda não está publicado em nenhum registry. Três caminhos
(do guia de integração dele):
- **Copiar as pastas de `packages/`** direto pro app-alvo (ou pro
  `packages/` dele, se também for monorepo pnpm) — mais rápido, bom pra
  começar.
- **Git dependency** no `package.json` do app-alvo apontando pro repo +
  subpath (ver `GUIA-DE-INTEGRACAO.md`, seção 0, pra sintaxe exata por
  gerenciador).
- Se o app-alvo **não for React/Next.js** no frontend, ou não for Node no
  backend, `@nav-engine/adapter-react`/`adapter-fastify` não servem — ainda
  dá pra integrar via o contrato HTTP puro (`POST /message`, `POST
  /audio`, documentado no README), mas isso é esforço bem maior e vale
  confirmar com o usuário antes de assumir.

## Passo 3 — modelar as ações (o trabalho real, não pule)

Duas formas — escolha pelo tamanho do catálogo e de quem vai manter isso:

- **Declarativa, `@nav-engine/app-profile`** (`loadAppProfile` +
  `AppProfile`): menos boilerplate, ações de navegação saem 100%
  declarativas (sem handler nenhum). Prefira esta por padrão.
- **Código direto, `createActionRegistry`**: mais controle fino por ação
  (`checkPermission` custom complexo, etc.). Use quando `app-profile` não
  for expressivo o suficiente pra uma ação específica — nada impede
  misturar as duas no mesmo registry.

Para cada ação: `key` hierárquica (`modulo.acao`), `description` em
linguagem natural (é o que a IA lê — escreva como explicaria pra uma
pessoa), `paramsSchema`/`params` só com os campos que a ação realmente
precisa, `riskLevel` (`safe`/`confirm`/`blocked` — irreversível ou
financeiro é sempre `confirm`), `handler` chamando o serviço de negócio
que o app-alvo **já tem** (nunca lógica de negócio nova dentro do motor).

## Passo 4 — instanciar o motor e expor as rotas

```ts
import { NavEngine, ConsoleAuditSink, InMemorySessionStore, FakeLLMProvider } from '@nav-engine/core';

const engine = new NavEngine({
  registry, onboardingRegistry, // do Passo 3
  llmProvider: new FakeLLMProvider(), // trocar por AnthropicLLMProvider só depois de validar a lógica das ações
  sessionStore: new InMemorySessionStore(), // trocar por RedisSessionStore antes de produção
  auditSink: new ConsoleAuditSink(), // trocar por log/BD real antes de produção
});
```

Com Fastify: `registerNavEngineRoutes(app, { engine, getUserId, resolveHostContext })`
de `@nav-engine/adapter-fastify` — `getUserId` deriva do auth já existente
do app, **nunca** do body da request. Sem Fastify: implemente `POST
/message`/`POST /audio` chamando `engine.handleMessage`/`engine.handleAudio`
diretamente — contrato no README do nav-engine, seção "Contrato HTTP".

## Passo 5 — montar o componente de frontend

Pergunte ao usuário (se não ficou óbvio no Passo 1) qual layout cabe no
produto:
- `<NavCopilotPanel />` — painel fixo, chat dominante (típico: site/web).
- `<NavCopilotWidget />` — bolha flutuante secundária (típico: app com UI
  gráfica tradicional em primeiro plano).
- `<NavCopilotOrb />` — orbe voice-first estilo Siri, sem texto em
  destaque (típico: quando voz é o próprio produto, não um complemento).
- `useNavMode()` + `<NavModeSelector />` — se o produto deve deixar o
  usuário escolher "Modo App ou Modo Chat" na entrada.

## Passo 6 — validar antes de gastar token

1. Rode localmente com `FakeLLMProvider` + `InMemorySessionStore` —
   valida permissão/execução/navegação sem custo de API.
2. Só depois troque para `AnthropicLLMProvider` (`ANTHROPIC_API_KEY`) e
   valide linguagem natural de verdade.
3. Se o app-alvo tiver um jeito de rodar a UI num browser real (dev
   server), use-o para confirmar visualmente antes de reportar a
   integração como concluída — não baseie "funciona" só em testes
   automatizados quando há UI nova envolvida.

## Checklist final antes de considerar a integração pronta

- [ ] Toda ação irreversível/financeira está `riskLevel: 'confirm'`
- [ ] `checkPermission`/`actionHandlers[...].checkPermission` cobre
      multi-tenant/roles usando o auth que o app-alvo já tinha
- [ ] Nenhuma ação "coringa" registrada
- [ ] `getUserId` deriva do auth do próprio app, nunca do body
- [ ] Testado com `FakeLLMProvider` antes de usar `AnthropicLLMProvider`
- [ ] Se for pra produção: `RedisSessionStore`, `AuditSink` real (não
      `ConsoleAuditSink`), rate limiter ligado — ver checklist completo em
      `GUIA-DE-INTEGRACAO.md` seção 8

Ao final, resuma pro usuário: quais ações foram modeladas, qual componente
de frontend foi escolhido e por quê, e o que ficou como próximo passo
(normalmente: trocar `FakeLLMProvider` por uma chave real e testar com
linguagem natural).
