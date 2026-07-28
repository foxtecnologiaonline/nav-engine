import Groq from 'groq-sdk';
import OpenAI from 'openai';
import type { TTSProvider } from '@nav-engine/core';

export type TTSAudioFormat = 'mp3' | 'wav' | 'flac';

export interface GroqTTSProviderConfig {
  /** Injeção para testes; se omitido, cria um client com `groqApiKey` ou `GROQ_API_KEY` do ambiente. */
  groqClient?: Groq;
  groqApiKey?: string;
  /** Default: 'playai-tts'. */
  groqModel?: string;
  /** Default: 'Fritz-PlayAI'. Ver vozes disponíveis na doc do Groq TTS. */
  groqVoice?: string;
  /**
   * Fallback se o Groq falhar. Injeção para testes; se omitido e
   * `openaiApiKey` for fornecido, cria um client OpenAI. Sem client nem
   * apiKey, não há fallback — falha do Groq propaga o erro original.
   */
  openaiClient?: OpenAI;
  openaiApiKey?: string;
  /** Default: 'tts-1'. */
  openaiModel?: string;
  /** Default: 'alloy'. */
  openaiVoice?: string;
  /** Formato de áudio pedido a ambos os providers. Default: 'mp3' (suportado pelos dois). */
  responseFormat?: TTSAudioFormat;
}

const MIME_BY_FORMAT: Record<TTSAudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Provider de referência para `TTSProvider`: Groq `playai-tts` como
 * primário, com fallback automático para OpenAI TTS se a chamada ao Groq
 * falhar — o mesmo padrão de resiliência primário+fallback já usado em
 * `@nav-engine/stt-groq`.
 */
export class GroqTTSProvider implements TTSProvider {
  private readonly groqClient: Groq;
  private readonly groqModel: string;
  private readonly groqVoice: string;
  private readonly openaiClient?: OpenAI;
  private readonly openaiModel: string;
  private readonly openaiVoice: string;
  private readonly responseFormat: TTSAudioFormat;

  constructor(config: GroqTTSProviderConfig = {}) {
    this.groqClient = config.groqClient ?? new Groq({ apiKey: config.groqApiKey });
    this.groqModel = config.groqModel ?? 'playai-tts';
    this.groqVoice = config.groqVoice ?? 'Fritz-PlayAI';
    this.openaiClient =
      config.openaiClient ?? (config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : undefined);
    this.openaiModel = config.openaiModel ?? 'tts-1';
    this.openaiVoice = config.openaiVoice ?? 'alloy';
    this.responseFormat = config.responseFormat ?? 'mp3';
  }

  async synthesize(text: string): Promise<{ audio: Uint8Array; mimeType: string }> {
    try {
      return await this.synthesizeWithGroq(text);
    } catch (groqErr) {
      if (!this.openaiClient) throw groqErr;

      try {
        return await this.synthesizeWithOpenAI(text, this.openaiClient);
      } catch (openaiErr) {
        throw new Error(
          `GroqTTSProvider: Groq e OpenAI falharam. Groq: ${errorMessage(groqErr)}. OpenAI: ${errorMessage(openaiErr)}`,
        );
      }
    }
  }

  private async synthesizeWithGroq(text: string): Promise<{ audio: Uint8Array; mimeType: string }> {
    const response = await this.groqClient.audio.speech.create({
      input: text,
      model: this.groqModel,
      voice: this.groqVoice,
      response_format: this.responseFormat,
    });
    return { audio: new Uint8Array(await response.arrayBuffer()), mimeType: MIME_BY_FORMAT[this.responseFormat] };
  }

  private async synthesizeWithOpenAI(
    text: string,
    client: OpenAI,
  ): Promise<{ audio: Uint8Array; mimeType: string }> {
    const response = await client.audio.speech.create({
      input: text,
      model: this.openaiModel,
      voice: this.openaiVoice,
      response_format: this.responseFormat,
    });
    return { audio: new Uint8Array(await response.arrayBuffer()), mimeType: MIME_BY_FORMAT[this.responseFormat] };
  }
}
