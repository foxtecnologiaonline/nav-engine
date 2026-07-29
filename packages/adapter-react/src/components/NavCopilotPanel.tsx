import { useEffect, useRef } from 'react';
import { useNavCopilot } from '../use-nav-copilot.js';
import { ChatPanelBody } from './ChatPanelBody.js';

export interface NavCopilotPanelProps {
  apiBaseUrl: string;
  sessionId: string;
  prefix?: string;
  hostContext?: Record<string, unknown>;
  onNavigate?: (path: string) => void;
  title?: string;
  /** Largura da sidebar em pixels. Default 360. */
  width?: number;
  /** Se definido, dispara esse flow de onboarding assim que o painel monta e não há mensagens ainda — a IA "fala primeiro". */
  autoStartOnboarding?: string;
}

/**
 * Painel de chat fixo, sempre visível, ocupando a lateral direita da tela
 * (uso típico: site/web em split-screen — interface gráfica à esquerda,
 * chat sempre aberto à direita). Alternativa a `NavCopilotWidget` (bolha
 * flutuante que abre/fecha) — mesma lógica por baixo (`useNavCopilot`), só
 * a moldura muda.
 */
export function NavCopilotPanel({
  apiBaseUrl,
  sessionId,
  prefix,
  hostContext,
  onNavigate,
  title = 'Assistente',
  width = 360,
  autoStartOnboarding,
}: NavCopilotPanelProps) {
  const copilot = useNavCopilot({ apiBaseUrl, sessionId, prefix, hostContext, onNavigate });

  const startedRef = useRef(false);
  useEffect(() => {
    if (!autoStartOnboarding || startedRef.current || copilot.messages.length > 0) return;
    startedRef.current = true;
    void copilot.startOnboarding(autoStartOnboarding);
  }, [autoStartOnboarding]);

  return (
    <div
      data-testid="nav-copilot-fixed-panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #d1d5db',
        background: '#fff',
        boxShadow: '-2px 0 8px rgba(0,0,0,0.06)',
      }}
    >
      <ChatPanelBody copilot={copilot} title={title} />
    </div>
  );
}
