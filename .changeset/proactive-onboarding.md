---
"@nav-engine/core": minor
"@nav-engine/llm-anthropic": minor
"@nav-engine/adapter-fastify": minor
"@nav-engine/adapter-react": minor
---

Onboarding proativo por IA: `NavEngine.startOnboarding` + `OnboardingFlowRegistry` (core), `extractStructuredAnswer` (llm-anthropic), rota `POST /onboarding/start` (adapter-fastify), `useNavCopilot().startOnboarding` + prop `autoStartOnboarding` em `<NavCopilotPanel />`/`<NavCopilotWidget />` (adapter-react). Também adiciona `<NavCopilotPanel />` (painel de chat fixo) e `useNavMode`/`<NavModeSelector />` (seletor Modo App/Chat) ao adapter-react.
