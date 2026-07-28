export interface ConfirmationCardProps {
  description: string;
  onConfirm: (accepted: boolean) => void;
}

export function ConfirmationCard({ description, onConfirm }: ConfirmationCardProps) {
  return (
    <div
      data-testid="confirmation-card"
      style={{
        border: '1px solid #f59e0b',
        background: '#fffbeb',
        borderRadius: 8,
        padding: 12,
        margin: '8px 0',
      }}
    >
      <p style={{ margin: '0 0 8px 0' }}>{description}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => onConfirm(true)} data-testid="confirm-yes">
          Sim
        </button>
        <button type="button" onClick={() => onConfirm(false)} data-testid="confirm-no">
          Não
        </button>
      </div>
    </div>
  );
}
