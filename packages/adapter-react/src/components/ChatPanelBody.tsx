import { useState } from 'react';
import type { UseNavCopilotResult } from '../use-nav-copilot.js';
import { ChatBubble } from './ChatBubble.js';
import { ConfirmationCard } from './ConfirmationCard.js';
import { MicButton } from './MicButton.js';

export interface ChatPanelBodyProps {
  copilot: UseNavCopilotResult;
  title: string;
  /** Se fornecido, mostra um botão de fechar no cabeçalho (usado pela bolha flutuante). Painel fixo não passa isso. */
  onClose?: () => void;
}

/**
 * Conteúdo compartilhado entre `NavCopilotWidget` (bolha flutuante) e
 * `NavCopilotPanel` (painel fixo) — cabeçalho, mensagens, confirmação,
 * campo de texto e microfone. Só a "moldura" (posicionamento, abrir/fechar)
 * difere entre os dois.
 */
export function ChatPanelBody({ copilot, title, onClose }: ChatPanelBodyProps) {
  const [draft, setDraft] = useState('');
  const { messages, status, pendingConfirmation, sendMessage, sendAudio, confirm, onboardingProgress, error } = copilot;

  const handleSend = () => {
    const text = draft.trim();
    if (!text || status === 'thinking') return;
    setDraft('');
    void sendMessage(text);
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, borderBottom: '1px solid #e5e7eb' }}>
        <strong>{title}</strong>
        {onboardingProgress && !onboardingProgress.completed && (
          <span data-testid="nav-copilot-onboarding-progress" style={{ fontSize: 12, opacity: 0.6 }}>
            Passo {onboardingProgress.stepIndex + 1} de {onboardingProgress.totalSteps}
          </span>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar" data-testid="nav-copilot-close">
            ✕
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }} data-testid="nav-copilot-messages">
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}

        {status === 'thinking' && <p style={{ opacity: 0.6 }}>Pensando…</p>}

        {status === 'awaiting_confirmation' && pendingConfirmation && (
          <ConfirmationCard description={pendingConfirmation.description} onConfirm={confirm} />
        )}

        {error && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            {error}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid #e5e7eb' }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSend();
          }}
          placeholder="Digite um comando…"
          style={{ flex: 1 }}
          data-testid="nav-copilot-input"
        />
        <MicButton onRecorded={(blob) => void sendAudio(blob)} disabled={status === 'thinking'} />
        <button type="button" onClick={handleSend} disabled={status === 'thinking'} data-testid="nav-copilot-send">
          Enviar
        </button>
      </div>
    </>
  );
}
