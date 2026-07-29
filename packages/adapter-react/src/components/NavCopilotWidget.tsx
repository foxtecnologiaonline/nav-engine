import { useEffect, useRef, useState } from 'react';
import { useNavCopilot } from '../use-nav-copilot.js';
import { ChatPanelBody } from './ChatPanelBody.js';

export interface NavCopilotWidgetProps {
  apiBaseUrl: string;
  sessionId: string;
  prefix?: string;
  hostContext?: Record<string, unknown>;
  onNavigate?: (path: string) => void;
  title?: string;
  /** Se definido, dispara esse flow de onboarding assim que o widget monta e não há mensagens ainda — abre o painel automaticamente (senão a IA "falaria primeiro" atrás da bolha fechada). */
  autoStartOnboarding?: string;
}

/** Bolha flutuante: botão no canto inferior direito que abre/fecha um painel de chat por cima da tela. */
export function NavCopilotWidget({
  apiBaseUrl,
  sessionId,
  prefix,
  hostContext,
  onNavigate,
  title = 'Assistente',
  autoStartOnboarding,
}: NavCopilotWidgetProps) {
  const [open, setOpen] = useState(false);
  const copilot = useNavCopilot({ apiBaseUrl, sessionId, prefix, hostContext, onNavigate });

  const startedRef = useRef(false);
  useEffect(() => {
    if (!autoStartOnboarding || startedRef.current || copilot.messages.length > 0) return;
    startedRef.current = true;
    setOpen(true);
    void copilot.startOnboarding(autoStartOnboarding);
  }, [autoStartOnboarding]);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="nav-copilot-toggle"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          borderRadius: '50%',
          width: 56,
          height: 56,
          fontSize: 24,
        }}
        aria-label={`Abrir ${title}`}
      >
        💬
      </button>
    );
  }

  return (
    <div
      data-testid="nav-copilot-panel"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 340,
        maxHeight: 480,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #d1d5db',
        borderRadius: 12,
        background: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}
    >
      <ChatPanelBody copilot={copilot} title={title} onClose={() => setOpen(false)} />
    </div>
  );
}
