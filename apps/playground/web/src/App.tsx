import { useState } from 'react';
import { NavCopilotPanel, NavCopilotWidget, NavModeSelector, useNavMode } from '@nav-engine/adapter-react';

const API_BASE_URL = 'http://localhost:4000';
const ONBOARDING_FLOW_KEY = 'business-setup';

/**
 * App mínimo só para testar o motor manualmente, demonstrando os 3
 * padrões de layout documentados no GUIA-DE-INTEGRACAO.md:
 *
 * - "Modo Chat" (equivalente a "site"): painel de chat fixo, sempre
 *   visível, dominante — a IA já "fala primeiro" com o onboarding.
 * - "Modo App": interface gráfica tradicional em primeiro plano, chat como
 *   bolha flutuante secundária — mesmo onboarding, mesmo autoStartOnboarding.
 * - Sem esse app nenhum dos dois teria uma rota de verdade para navegar.
 */
export function App() {
  const [route, setRoute] = useState('/tasks');
  const { mode, setMode, hasChosen } = useNavMode();

  if (!hasChosen) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
        <h1>nav-engine playground</h1>
        <NavModeSelector onSelect={setMode} />
      </div>
    );
  }

  const graphicalContent = (
    <div style={{ fontFamily: 'sans-serif', padding: 24, marginRight: mode === 'chat' ? 360 : 0 }}>
      <h1>nav-engine playground</h1>
      <p>
        Modo atual: <code>{mode}</code>{' '}
        <button type="button" onClick={() => setMode(mode === 'app' ? 'chat' : 'app')}>
          trocar modo
        </button>
      </p>
      <p>
        Rota atual (simulada): <code data-testid="current-route">{route}</code>
      </p>
      <p style={{ maxWidth: 480, opacity: 0.75 }}>
        Ao carregar, a IA já pergunta o nome do seu negócio (onboarding
        proativo — "{ONBOARDING_FLOW_KEY}"). Depois disso, digite comandos
        livres: "cria uma tarefa: comprar pão", "lista minhas tarefas", "apaga
        todas as minhas tarefas", "abre as configurações".
      </p>
    </div>
  );

  return (
    <>
      {graphicalContent}
      {mode === 'chat' ? (
        <NavCopilotPanel
          apiBaseUrl={API_BASE_URL}
          sessionId="playground-session"
          hostContext={{ role: 'admin' }}
          onNavigate={setRoute}
          autoStartOnboarding={ONBOARDING_FLOW_KEY}
        />
      ) : (
        <NavCopilotWidget
          apiBaseUrl={API_BASE_URL}
          sessionId="playground-session"
          hostContext={{ role: 'admin' }}
          onNavigate={setRoute}
          autoStartOnboarding={ONBOARDING_FLOW_KEY}
        />
      )}
    </>
  );
}
