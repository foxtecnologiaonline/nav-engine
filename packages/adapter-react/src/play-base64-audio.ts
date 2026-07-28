/** Toca um áudio de resposta (TTS) vindo em base64. No-op fora do browser. */
export function playBase64Audio(base64: string, mimeType: string): void {
  if (typeof Audio === 'undefined') return;
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  void audio.play().catch(() => {
    // reprodução automática pode ser bloqueada pelo browser — falha silenciosa é aceitável aqui.
  });
}
