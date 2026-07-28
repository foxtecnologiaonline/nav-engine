import { useCallback, useRef, useState } from 'react';
import { NavCopilotClient } from './nav-copilot-client.js';
import { playBase64Audio } from './play-base64-audio.js';
import type { ChatMessage, NavCopilotStatus, NavEngineHttpResponse } from './types.js';

export interface UseNavCopilotOptions {
  apiBaseUrl: string;
  prefix?: string;
  sessionId: string;
  hostContext?: Record<string, unknown>;
  /** Chamado automaticamente quando a resposta do motor carrega uma rota de navegação. */
  onNavigate?: (path: string) => void;
  /** Injeção para testes. */
  fetchImpl?: typeof fetch;
}

export interface UseNavCopilotResult {
  messages: ChatMessage[];
  status: NavCopilotStatus;
  pendingConfirmation: { description: string } | null;
  sendMessage: (text: string) => Promise<void>;
  sendAudio: (blob: Blob) => Promise<void>;
  confirm: (accepted: boolean) => Promise<void>;
  error: string | null;
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useNavCopilot(options: UseNavCopilotOptions): UseNavCopilotResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<NavCopilotStatus>('idle');
  const [pendingConfirmation, setPendingConfirmation] = useState<{ description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<NavCopilotClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new NavCopilotClient({
      apiBaseUrl: options.apiBaseUrl,
      prefix: options.prefix,
      fetchImpl: options.fetchImpl,
    });
  }

  const pushMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setMessages((prev) => [...prev, { id: makeId(), role, text, timestamp: Date.now() }]);
  }, []);

  const applyResponse = useCallback(
    (res: NavEngineHttpResponse) => {
      pushMessage('assistant', res.reply);

      if (res.status === 'awaiting_confirmation') {
        setStatus('awaiting_confirmation');
        setPendingConfirmation({ description: res.action?.description ?? res.reply });
      } else {
        setStatus('idle');
        setPendingConfirmation(null);
      }

      if (res.navigateTo) {
        options.onNavigate?.(res.navigateTo);
      }
      if (res.audioBase64 && res.audioMimeType) {
        playBase64Audio(res.audioBase64, res.audioMimeType);
      }
    },
    [options],
  );

  const runRequest = useCallback(
    async (fn: () => Promise<NavEngineHttpResponse>) => {
      setStatus('thinking');
      setError(null);
      try {
        const res = await fn();
        applyResponse(res);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Erro desconhecido.');
      }
    },
    [applyResponse],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      pushMessage('user', text);
      await runRequest(() =>
        clientRef.current!.sendMessage({
          sessionId: options.sessionId,
          message: text,
          hostContext: options.hostContext,
        }),
      );
    },
    [options.sessionId, options.hostContext, pushMessage, runRequest],
  );

  const sendAudio = useCallback(
    async (blob: Blob) => {
      pushMessage('user', '🎤 (mensagem de voz)');
      await runRequest(() =>
        clientRef.current!.sendAudio({
          sessionId: options.sessionId,
          audioBlob: blob,
          hostContext: options.hostContext,
        }),
      );
    },
    [options.sessionId, options.hostContext, pushMessage, runRequest],
  );

  const confirm = useCallback(
    async (accepted: boolean) => {
      await sendMessage(accepted ? 'sim' : 'não');
    },
    [sendMessage],
  );

  return { messages, status, pendingConfirmation, sendMessage, sendAudio, confirm, error };
}
