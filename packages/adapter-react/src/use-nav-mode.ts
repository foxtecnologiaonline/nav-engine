import { useCallback, useEffect, useState } from 'react';

export type NavMode = 'app' | 'chat';

export interface UseNavModeOptions {
  /** Chave do localStorage onde a escolha é persistida. Default: 'nav-engine:mode'. */
  storageKey?: string;
  /** Se fornecido, pula a pergunta e já usa esse modo (útil pra "site", que sempre é modo chat/painel fixo). */
  defaultMode?: NavMode;
}

export interface UseNavModeResult {
  /** `null` enquanto o usuário ainda não escolheu (e não há `defaultMode`). */
  mode: NavMode | null;
  setMode: (mode: NavMode) => void;
  /** `true` assim que houver um modo definido (escolhido ou default) — controla se deve mostrar o `NavModeSelector`. */
  hasChosen: boolean;
}

function readStoredMode(storageKey: string): NavMode | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey);
  return raw === 'app' || raw === 'chat' ? raw : null;
}

/**
 * Hook para o padrão "Modo App ou Modo Chat" (uso típico: apps, onde o
 * usuário escolhe entre a interface gráfica tradicional com o chat como
 * assistente secundário, ou uma experiência conduzida pelo chat). Persiste
 * a escolha em `localStorage`. A composição (o que cada modo renderiza) é
 * responsabilidade do host — este hook só guarda a decisão.
 */
export function useNavMode(options: UseNavModeOptions = {}): UseNavModeResult {
  const storageKey = options.storageKey ?? 'nav-engine:mode';
  const [mode, setModeState] = useState<NavMode | null>(() => options.defaultMode ?? readStoredMode(storageKey));

  useEffect(() => {
    if (options.defaultMode) return;
    const stored = readStoredMode(storageKey);
    if (stored) setModeState(stored);
  }, [storageKey]);

  const setMode = useCallback(
    (next: NavMode) => {
      setModeState(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next);
      }
    },
    [storageKey],
  );

  return { mode, setMode, hasChosen: mode !== null };
}
