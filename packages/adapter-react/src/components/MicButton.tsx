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
  /**
   * Fonte da verdade síncrona para "já gravando ou aguardando permissão" —
   * `recording` (estado) só reflete isso depois de um render, mas
   * `getUserMedia` pode levar um tempo (prompt de permissão do browser)
   * antes disso. Sem esse lock, um segundo clique nesse intervalo dispara
   * outro `start`, deixando o primeiro stream de microfone aberto pra
   * sempre (nunca parado).
   */
  const recordingRef = useRef(false);

  const start = useCallback(async () => {
    if (recordingRef.current) return; // já gravando ou aguardando permissão — ignora clique duplicado
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    recordingRef.current = true;
    setRecording(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Permissão negada ou nenhum microfone disponível — nunca deixa uma
      // rejeição sem tratamento travar o botão num estado inconsistente.
      recordingRef.current = false;
      setRecording(false);
      return;
    }

    if (!recordingRef.current) {
      // Usuário clicou de novo (cancelou) enquanto o prompt de permissão
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
      onRecorded(blob);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start();
    recorderRef.current = recorder;
  }, [onRecorded]);

  const stop = useCallback(() => {
    recordingRef.current = false;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const toggle = useCallback(() => {
    if (recordingRef.current) stop();
    else void start();
  }, [start, stop]);

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
