# nav-engine — orientação para o Claude Code

Este repositório é o **motor de navegação/controle por voz e texto via IA**
descrito no `README.md`: um mecanismo de infraestrutura reutilizável para
instalar em qualquer app/SaaS, com um registry de ações explícito,
default-deny anti-alucinação, e dois modos de interação no frontend — chat
(texto) e voz (orbe estilo Siri).

**Se você (Claude) chegou aqui para integrar o nav-engine em outro app**:
rode o skill `/integrate-nav-engine` — ele contém o playbook completo e
autossuficiente. Não é preciso ler mais nada antes disso; o skill te manda
ler o que for preciso na hora certa.

Se o skill não estiver disponível nesta sessão (ex.: este repo foi só
consultado, não anexado via `add_repo`+`register_repo_root`), leia nesta
ordem:
1. `README.md` — arquitetura, guardrails, contrato HTTP, "Como um host
   integraria".
2. `GUIA-DE-INTEGRACAO.md` — checklist prático passo a passo.
3. `packages/app-profile/` — se preferir modelar ações como dados em vez
   de código (`AppProfile` + `loadAppProfile`).

## Os 3 invariantes que nunca mudam numa integração

Qualquer que seja o app-alvo, **nunca**:

1. Registre uma ação "coringa" (executar query livre, rodar script
   arbitrário, "faz o que o usuário pedir"). Cada ação é específica, com
   escopo fechado — isso é o que torna o motor seguro por design.
2. Deixe a IA decidir `riskLevel` ou liberar uma ação `blocked`. Isso é
   sempre dado pelo host, nunca inferido da conversa.
3. Escreva uma checagem de permissão nova só para o nav-engine — sempre
   reaproveite o auth/roles que o app-alvo já tem.

Esses 3 pontos valem tanto modelando ações via código
(`createActionRegistry`) quanto via `@nav-engine/app-profile`.

## Estrutura do repositório (rápido)

```
packages/core/            núcleo agnóstico — NavEngine, ActionRegistry, guardrails
packages/app-profile/     modelagem declarativa de ações/onboarding por app
packages/llm-anthropic/   LLMProvider de referência (Anthropic)
packages/adapter-fastify/ rotas HTTP de referência (POST /message, /audio, /onboarding/start)
packages/adapter-react/   componentes de frontend: NavCopilotPanel, NavCopilotWidget, NavCopilotOrb
packages/stt-groq/        voz: entrada (transcrição)
packages/tts-groq/        voz: saída (síntese)
packages/session-redis/   sessão persistente pra produção
apps/playground/          app mínimo pra testar tudo manualmente
```

Este `CLAUDE.md` é sobre o próprio nav-engine. Se você está trabalhando
*no app-alvo* (não aqui), este arquivo é só contexto de apoio — as
mudanças de verdade acontecem no repo do app-alvo, não aqui.
