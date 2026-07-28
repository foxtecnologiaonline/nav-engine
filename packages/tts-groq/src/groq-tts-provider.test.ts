import { describe, expect, it, vi } from 'vitest';
import { GroqTTSProvider } from './groq-tts-provider.js';

function fakeAudioResponse(bytes: number[]) {
  return { arrayBuffer: async () => new Uint8Array(bytes).buffer };
}

function makeFakeGroqClient(impl: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>) {
  return { audio: { speech: { create: vi.fn(impl) } } } as any;
}

function makeFakeOpenAIClient(impl: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>) {
  return { audio: { speech: { create: vi.fn(impl) } } } as any;
}

describe('GroqTTSProvider', () => {
  it('sintetiza com sucesso via Groq e devolve mimeType correto para mp3 (default)', async () => {
    const groqClient = makeFakeGroqClient(async () => fakeAudioResponse([1, 2, 3]));
    const provider = new GroqTTSProvider({ groqClient });

    const result = await provider.synthesize('olá, tudo bem?');

    expect(Array.from(result.audio)).toEqual([1, 2, 3]);
    expect(result.mimeType).toBe('audio/mpeg');
    const callArgs = groqClient.audio.speech.create.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      input: 'olá, tudo bem?',
      model: 'playai-tts',
      voice: 'Fritz-PlayAI',
      response_format: 'mp3',
    });
  });

  it('usa groqModel/groqVoice/responseFormat customizados', async () => {
    const groqClient = makeFakeGroqClient(async () => fakeAudioResponse([9]));
    const provider = new GroqTTSProvider({
      groqClient,
      groqModel: 'playai-tts-arabic',
      groqVoice: 'Amira-PlayAI',
      responseFormat: 'wav',
    });

    const result = await provider.synthesize('مرحبا');
    expect(result.mimeType).toBe('audio/wav');
    expect(groqClient.audio.speech.create.mock.calls[0][0]).toMatchObject({
      model: 'playai-tts-arabic',
      voice: 'Amira-PlayAI',
      response_format: 'wav',
    });
  });

  it('faz fallback para OpenAI se o Groq falhar e openaiClient estiver configurado', async () => {
    const groqClient = makeFakeGroqClient(async () => {
      throw new Error('groq tts indisponível');
    });
    const openaiClient = makeFakeOpenAIClient(async () => fakeAudioResponse([4, 5, 6]));
    const provider = new GroqTTSProvider({ groqClient, openaiClient });

    const result = await provider.synthesize('teste de fallback');

    expect(Array.from(result.audio)).toEqual([4, 5, 6]);
    expect(openaiClient.audio.speech.create).toHaveBeenCalledTimes(1);
    expect(openaiClient.audio.speech.create.mock.calls[0][0]).toMatchObject({
      model: 'tts-1',
      voice: 'alloy',
    });
  });

  it('propaga o erro original do Groq se não houver fallback configurado', async () => {
    const groqClient = makeFakeGroqClient(async () => {
      throw new Error('groq tts indisponível e sem fallback');
    });
    const provider = new GroqTTSProvider({ groqClient });

    await expect(provider.synthesize('x')).rejects.toThrow(/groq tts indisponível e sem fallback/);
  });

  it('lança erro combinado se Groq e OpenAI falharem', async () => {
    const groqClient = makeFakeGroqClient(async () => {
      throw new Error('falha do groq tts');
    });
    const openaiClient = makeFakeOpenAIClient(async () => {
      throw new Error('falha do openai tts');
    });
    const provider = new GroqTTSProvider({ groqClient, openaiClient });

    await expect(provider.synthesize('x')).rejects.toThrow(/falha do groq tts.*falha do openai tts/s);
  });
});
