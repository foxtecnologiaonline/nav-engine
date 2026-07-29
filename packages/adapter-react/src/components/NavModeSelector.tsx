import type { NavMode } from '../use-nav-mode.js';

export interface NavModeSelectorProps {
  onSelect: (mode: NavMode) => void;
  title?: string;
  description?: string;
  appLabel?: string;
  chatLabel?: string;
}

/**
 * Prompt de 2 opções para o padrão "Modo App ou Modo Chat". Não decide
 * nada sozinho — só chama `onSelect`; o host decide o que cada modo
 * renderiza (ver `useNavMode`).
 */
export function NavModeSelector({
  onSelect,
  title = 'Como você quer usar o app?',
  description,
  appLabel = 'Modo App',
  chatLabel = 'Modo Chat',
}: NavModeSelectorProps) {
  return (
    <div
      data-testid="nav-mode-selector"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 24,
        maxWidth: 360,
        textAlign: 'center',
      }}
    >
      <strong>{title}</strong>
      {description && <p style={{ opacity: 0.75, margin: 0 }}>{description}</p>}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button type="button" data-testid="nav-mode-select-app" onClick={() => onSelect('app')}>
          {appLabel}
        </button>
        <button type="button" data-testid="nav-mode-select-chat" onClick={() => onSelect('chat')}>
          {chatLabel}
        </button>
      </div>
    </div>
  );
}
