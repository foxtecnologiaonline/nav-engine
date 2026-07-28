import { useCallback, useRef, useState } from 'react';

export interface MicButtonProps {
  onRecorded: (blob: Blob) => void;
  disabled?: boolean;
}

/**
 * Primeiro clique inicia a gravação (getUserMedia + MediaRecorder), segundo
 * clique para e entrega o blob via `onRecorded`. Cobertura de teste
 * deliberadamente leve aqui — MediaRecorder/getUserMedia são APIs de
 * browser difíceis de simular fielmente em jsdom.
 */
export function MicButton({ onRecorded, disabled }: MicButtonProps) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      onRecorded(blob);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }, [onRecorded]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const toggle = useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      data-testid="mic-button"
      aria-pressed={recording}
      title={recording ? 'Parar gravação' : 'Gravar mensagem de voz'}
    >
      {recording ? '⏹️' : '🎙️'}
    </button>
  );
}
