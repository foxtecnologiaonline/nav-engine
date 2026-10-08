export interface PlayAudioCallbacks {
  /** Chamado antes de iniciar a reprodução (otimista — não espera o buffering). */
  onStart?: () => void;
  /** Chamado quando a reprodução termina, ou falha (ex.: autoplay bloqueado pelo browser) — nunca deixa o chamador travado num estado "falando" sem fim. */
  onEnded?: () => void;
}

/** Toca um áudio de resposta (TTS) vindo em base64. No-op fora do browser. */
export function playBase64Audio(
  base64: string,
  mimeType: string,
  callbacks?: PlayAudioCallbacks,
): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  if (callbacks?.onEnded) audio.addEventListener('ended', callbacks.onEnded);

  callbacks?.onStart?.();
  // `play()` devolve uma Promise nos browsers reais; alguns ambientes (ex.: jsdom em
  // testes) devolvem `undefined` sem lançar — por isso o `typeof` antes do `.catch`.
  const playResult = audio.play();
  if (playResult && typeof playResult.catch === 'function') {
    void playResult.catch(() => {
      // reprodução automática pode ser bloqueada pelo browser — falha silenciosa é
      // aceitável aqui, mas ainda assim avisa o chamador para não travar o estado "falando".
      callbacks?.onEnded?.();
    });
  }

  return audio;
}
