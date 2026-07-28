import { describe, expect, it, vi } from 'vitest';
import { GroqWhisperProvider } from './groq-whisper-provider.js';

function makeFakeGroqClient(impl: () => Promise<{ text: string }>) {
  return { audio: { transcriptions: { create: vi.fn(impl) } } } as any;
}

function makeFakeOpenAIClient(impl: () => Promise<{ text: string }>) {
  return { audio: { transcriptions: { create: vi.fn(impl) } } } as any;
}

const audioInput = { audio: Buffer.from('fake-audio-bytes'), mimeType: 'audio/webm' };

describe('GroqWhisperProvider', () => {
  it('transcreve com sucesso via Groq', async () => {
    const groqClient = makeFakeGroqClient(async () => ({ text: 'oi, isso é um teste' }));
    const provider = new GroqWhisperProvider({ groqClient });

    const result = await provider.transcribe(audioInput);

    expect(result.text).toBe('oi, isso é um teste');
    expect(groqClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    const callArgs = groqClient.audio.transcriptions.create.mock.calls[0][0];
    expect(callArgs.model).toBe('whisper-large-v3-turbo');
  });

  it('usa o groqModel customizado quando fornecido', async () => {
    const groqClient = makeFakeGroqClient(async () => ({ text: 'x' }));
    const provider = new GroqWhisperProvider({ groqClient, groqModel: 'whisper-large-v3' });
    await provider.transcribe(audioInput);
    expect(groqClient.audio.transcriptions.create.mock.calls[0][0].model).toBe('whisper-large-v3');
  });

  it('faz fallback para OpenAI se o Groq falhar e openaiClient estiver configurado', async () => {
    const groqClient = makeFakeGroqClient(async () => {
      throw new Error('groq indisponível');
    });
    const openaiClient = makeFakeOpenAIClient(async () => ({ text: 'transcrito via fallback' }));
    const provider = new GroqWhisperProvider({ groqClient, openaiClient });

    const result = await provider.transcribe(audioInput);

    expect(result.text).toBe('transcrito via fallback');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    expect(openaiClient.audio.transcriptions.create.mock.calls[0][0].model).toBe('whisper-1');
  });

  it('propaga o erro original do Groq se não houver fallback configurado', async () => {
    const groqClient = makeFakeGroqClient(async () => {
      throw new Error('groq indisponível e sem fallback');
    });
    const provider = new GroqWhisperProvider({ groqClient });

    await expect(provider.transcribe(audioInput)).rejects.toThrow(/groq indisponível e sem fallback/);
  });

  it('lança erro combinado se Groq e OpenAI falharem', async () => {
    const groqClient = makeFakeGroqClient(async () => {
      throw new Error('falha do groq');
    });
    const openaiClient = makeFakeOpenAIClient(async () => {
      throw new Error('falha do openai');
    });
    const provider = new GroqWhisperProvider({ groqClient, openaiClient });

    await expect(provider.transcribe(audioInput)).rejects.toThrow(/falha do groq.*falha do openai/s);
  });

  it('repassa o mimeType correto ao construir o arquivo para cada client', async () => {
    const groqClient = makeFakeGroqClient(async () => ({ text: 'ok' }));
    const provider = new GroqWhisperProvider({ groqClient });

    await provider.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/mpeg' });

    const file = groqClient.audio.transcriptions.create.mock.calls[0][0].file;
    expect(file.name).toBe('audio.mp3');
    expect(file.type).toBe('audio/mpeg');
  });
});
