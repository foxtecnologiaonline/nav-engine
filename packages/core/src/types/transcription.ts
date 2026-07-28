/** Abstração de speech-to-text — o motor nunca fala com nenhuma API de STT diretamente. */
export interface TranscriptionProvider {
  transcribe(input: { audio: Buffer | Uint8Array; mimeType: string }): Promise<{
    text: string;
    language?: string;
  }>;
}
