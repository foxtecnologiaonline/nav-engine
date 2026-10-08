import { useCallback, useRef, useState } from 'react';
import { useNavCopilot } from '../use-nav-copilot.js';

export type OrbVisualState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface NavCopilotOrbProps {
  apiBaseUrl: string;
  sessionId: string;
  prefix?: string;
  hostContext?: Record<string, unknown>;
  onNavigate?: (path: string) => void;
  /** Posição fixa na tela. Default: canto inferior direito (`bottom: 24, right: 24`). */
  position?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Diâmetro do orbe em pixels. Default 72. */
  size?: number;
}

const ORB_COLOR: Record<OrbVisualState, string> = {
  idle: '#6366f1',
  listening: '#22c55e',
  processing: '#f59e0b',
  speaking: '#3b82f6',
  error: '#ef4444',
};

const KEYFRAMES_ELEMENT_ID = 'nav-copilot-orb-keyframes';

/** Injeta as `@keyframes` uma única vez por documento — pacote não traz CSS externo, mesma convenção de estilo inline do resto do adapter-react. */
function ensureKeyframes(): void {
  if (typeof document === 'undefined' || document.getElementById(KEYFRAMES_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ELEMENT_ID;
  style.textContent = `
    @keyframes nav-copilot-orb-pulse {
      0% { transform: scale(1); opacity: 0.5; }
      100% { transform: scale(1.8); opacity: 0; }
    }
    @keyframes nav-copilot-orb-breathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Orbe flutuante estilo Siri: toque pra falar, visual muda por estado
 * (ouvindo/processando/falando), resposta é falada automaticamente (TTS) e
 * mostrada como legenda abaixo do orbe. Mesmo motor por baixo
 * (`useNavCopilot` → `/audio`) que `NavCopilotWidget`/`NavCopilotPanel` —
 * só a interação é voice-first em vez de chat-first.
 *
 * Sem wake word/escuta contínua: o usuário sempre inicia a captura com um
 * toque — nenhum áudio é enviado sem ação explícita.
 */
export function NavCopilotOrb({
  apiBaseUrl,
  sessionId,
  prefix,
  hostContext,
  onNavigate,
  position,
  size = 72,
}: NavCopilotOrbProps) {
  ensureKeyframes();

  const copilot = useNavCopilot({ apiBaseUrl, sessionId, prefix, hostContext, onNavigate });
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /**
   * Fonte da verdade síncrona para "já estou ouvindo ou tentando ouvir" —
   * `recording` (estado) só reflete isso depois de um render, mas
   * `getUserMedia` pode levar um tempo (prompt de permissão do browser) antes
   * disso. Sem esse lock, um segundo toque durante esse intervalo dispara
   * outro `startListening`, deixando o primeiro stream de microfone aberto
   * pra sempre (nunca parado).
   */
  const listeningRef = useRef(false);

  const visualState: OrbVisualState = recording
    ? 'listening'
    : copilot.status === 'error'
      ? 'error'
      : copilot.isSpeaking
        ? 'speaking'
        : copilot.status === 'thinking'
          ? 'processing'
          : 'idle';

  const lastAssistantMessage = [...copilot.messages].reverse().find((m) => m.role === 'assistant');

  const startListening = useCallback(async () => {
    if (listeningRef.current) return; // já ouvindo ou aguardando permissão — ignora toque duplicado
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    listeningRef.current = true;
    setRecording(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Permissão negada ou nenhum microfone disponível — nunca deixa uma
      // rejeição sem tratamento travar o orbe num estado inconsistente.
      listeningRef.current = false;
      setRecording(false);
      return;
    }

    if (!listeningRef.current) {
      // Usuário tocou de novo (cancelou) enquanto o prompt de permissão
      // estava aberto — libera o stream recém-concedido imediatamente, sem
      // nunca chegar a gravar.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach((track) => track.stop());
      void copilot.sendAudio(blob);
    };
    recorder.start();
    recorderRef.current = recorder;
  }, [copilot]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const handleTap = useCallback(() => {
    if (listeningRef.current) stopListening();
    else void startListening();
  }, [startListening, stopListening]);

  const busy = visualState === 'processing' || visualState === 'speaking';
  const color = ORB_COLOR[visualState];

  return (
    <div
      data-testid="nav-copilot-orb-container"
      data-state={visualState}
      style={{
        position: 'fixed',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        top: position?.top,
        left: position?.left,
        bottom: position?.bottom ?? (position?.top === undefined ? 24 : undefined),
        right: position?.right ?? (position?.left === undefined ? 24 : undefined),
      }}
    >
      {lastAssistantMessage && (
        <div
          data-testid="nav-copilot-orb-caption"
          style={{
            maxWidth: 240,
            padding: '6px 12px',
            borderRadius: 12,
            background: 'rgba(17, 24, 39, 0.85)',
            color: '#fff',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          {lastAssistantMessage.text}
        </div>
      )}

      <button
        type="button"
        data-testid="nav-copilot-orb"
        aria-label={recording ? 'Parar e enviar comando de voz' : 'Falar comando de voz'}
        aria-pressed={recording}
        onClick={handleTap}
        disabled={busy}
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          border: 'none',
          cursor: busy ? 'default' : 'pointer',
          background: `radial-gradient(circle at 35% 30%, ${color}, ${color}cc)`,
          boxShadow: `0 4px 20px ${color}66`,
          animation: visualState === 'idle' ? 'nav-copilot-orb-breathe 3s ease-in-out infinite' : undefined,
        }}
      >
        {visualState !== 'idle' && (
          <span
            data-testid="nav-copilot-orb-ring"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: color,
              animation: 'nav-copilot-orb-pulse 1.4s ease-out infinite',
            }}
          />
        )}
      </button>
    </div>
  );
}
