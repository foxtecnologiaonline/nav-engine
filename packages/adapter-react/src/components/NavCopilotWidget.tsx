import { useState } from 'react';
import { useNavCopilot } from '../use-nav-copilot.js';
import { ChatBubble } from './ChatBubble.js';
import { ConfirmationCard } from './ConfirmationCard.js';
import { MicButton } from './MicButton.js';

export interface NavCopilotWidgetProps {
  apiBaseUrl: string;
  sessionId: string;
  prefix?: string;
  hostContext?: Record<string, unknown>;
  onNavigate?: (path: string) => void;
  title?: string;
}

export function NavCopilotWidget({
  apiBaseUrl,
  sessionId,
  prefix,
  hostContext,
  onNavigate,
  title = 'Assistente',
}: NavCopilotWidgetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, status, pendingConfirmation, sendMessage, sendAudio, confirm, error } = useNavCopilot({
    apiBaseUrl,
    sessionId,
    prefix,
    hostContext,
    onNavigate,
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || status === 'thinking') return;
    setDraft('');
    void sendMessage(text);
  };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, borderBottom: '1px solid #e5e7eb' }}>
        <strong>{title}</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" data-testid="nav-copilot-close">
          ✕
        </button>
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
    </div>
  );
}
