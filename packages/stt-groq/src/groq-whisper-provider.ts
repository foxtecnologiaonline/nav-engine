import Groq, { toFile as toGroqFile } from 'groq-sdk';
import OpenAI, { toFile as toOpenAIFile } from 'openai';
import type { TranscriptionProvider } from '@nav-engine/core';

export interface GroqWhisperProviderConfig {
  /** Injeção para testes; se omitido, cria um client com `groqApiKey` ou `GROQ_API_KEY` do ambiente. */
  groqClient?: Groq;
  groqApiKey?: string;
  /** Default: 'whisper-large-v3-turbo'. */
  groqModel?: string;
  /**
   * Fallback se o Groq falhar. Injeção para testes; se omitido e
   * `openaiApiKey` for fornecido, cria um client OpenAI. Sem client nem
   * apiKey, não há fallback — falha do Groq propaga o erro original.
   */
  openaiClient?: OpenAI;
  openaiApiKey?: string;
  /** Default: 'whisper-1'. */
  openaiModel?: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/webm': 'audio.webm',
  'audio/ogg': 'audio.ogg',
  'audio/wav': 'audio.wav',
  'audio/x-wav': 'audio.wav',
  'audio/mpeg': 'audio.mp3',
  'audio/mp3': 'audio.mp3',
  'audio/mp4': 'audio.mp4',
  'audio/m4a': 'audio.m4a',
  'audio/x-m4a': 'audio.m4a',
  'audio/flac': 'audio.flac',
};

function filenameForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? 'audio.webm';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Provider de referência para `TranscriptionProvider`: Groq Whisper como
 * primário (mais rápido/barato) com fallback automático para OpenAI Whisper
 * se a chamada ao Groq falhar — o mesmo padrão já validado em produção no
 * pipeline de transcrição do zapscript.
 */
export class GroqWhisperProvider implements TranscriptionProvider {
  private readonly groqClient: Groq;
  private readonly groqModel: string;
  private readonly openaiClient?: OpenAI;
  private readonly openaiModel: string;

  constructor(config: GroqWhisperProviderConfig = {}) {
    this.groqClient = config.groqClient ?? new Groq({ apiKey: config.groqApiKey });
    this.groqModel = config.groqModel ?? 'whisper-large-v3-turbo';
    this.openaiClient =
      config.openaiClient ?? (config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : undefined);
    this.openaiModel = config.openaiModel ?? 'whisper-1';
  }

  async transcribe(input: { audio: Buffer | Uint8Array; mimeType: string }): Promise<{ text: string }> {
    try {
      return await this.transcribeWithGroq(input);
    } catch (groqErr) {
      if (!this.openaiClient) throw groqErr;

      try {
        return await this.transcribeWithOpenAI(input, this.openaiClient);
      } catch (openaiErr) {
        throw new Error(
          `GroqWhisperProvider: Groq e OpenAI falharam. Groq: ${errorMessage(groqErr)}. OpenAI: ${errorMessage(openaiErr)}`,
        );
      }
    }
  }

  private async transcribeWithGroq(input: { audio: Buffer | Uint8Array; mimeType: string }): Promise<{ text: string }> {
    const file = await toGroqFile(input.audio, filenameForMime(input.mimeType), { type: input.mimeType });
    const result = await this.groqClient.audio.transcriptions.create({ file, model: this.groqModel });
    return { text: result.text };
  }

  private async transcribeWithOpenAI(
    input: { audio: Buffer | Uint8Array; mimeType: string },
    client: OpenAI,
  ): Promise<{ text: string }> {
    const file = await toOpenAIFile(input.audio, filenameForMime(input.mimeType), { type: input.mimeType });
    const result = await client.audio.transcriptions.create({ file, model: this.openaiModel });
    return { text: result.text };
  }
}
