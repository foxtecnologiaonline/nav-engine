/**
 * Abstração de text-to-speech — completa "comandos por voz" nos dois sentidos.
 * Sem implementação concreta nesta rodada: apenas a interface, plugável pelo host.
 */
export interface TTSProvider {
  synthesize(text: string): Promise<{ audio: Uint8Array; mimeType: string }>;
}
