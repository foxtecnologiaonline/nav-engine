import { useState } from 'react';
import { NavCopilotWidget } from '@nav-engine/adapter-react';

const API_BASE_URL = 'http://localhost:4000';

/**
 * App mínimo só para testar o motor manualmente: um "roteador" de brinquedo
 * (troca de rota via useState, sem react-router) e o widget de chat plugado
 * via `onNavigate`. Sem esse app o `NavCopilotWidget` não teria nada de
 * verdade para navegar.
 */
export function App() {
  const [route, setRoute] = useState('/tasks');

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>nav-engine playground</h1>
      <p>
        Rota atual (simulada): <code data-testid="current-route">{route}</code>
      </p>
      <p style={{ maxWidth: 480, opacity: 0.75 }}>
        Digite comandos no chat no canto inferior direito. Exemplos: "cria uma
        tarefa: comprar pão", "lista minhas tarefas", "apaga todas as minhas
        tarefas", "abre as configurações".
      </p>

      <NavCopilotWidget
        apiBaseUrl={API_BASE_URL}
        sessionId="playground-session"
        hostContext={{ role: 'admin' }}
        onNavigate={(path) => setRoute(path)}
      />
    </div>
  );
}
