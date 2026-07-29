import type { NavEngineHttpResponse } from './types.js';

export interface NavCopilotClientConfig {
  apiBaseUrl: string;
  /** Default: '/nav-engine' — deve bater com o `prefix` usado no adapter do backend. */
  prefix?: string;
  fetchImpl?: typeof fetch;
}

export interface SendMessageInput {
  sessionId: string;
  message: string;
  hostContext?: Record<string, unknown>;
}

export interface SendAudioInput {
  sessionId: string;
  audioBlob: Blob;
  hostContext?: Record<string, unknown>;
}

export interface StartOnboardingInput {
  sessionId: string;
  flowKey: string;
  hostContext?: Record<string, unknown>;
}

async function parseResponse(response: Response): Promise<NavEngineHttpResponse> {
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // ignora corpo não-JSON
    }
    throw new Error(`nav-engine: requisição falhou (${response.status}). ${detail}`);
  }
  return response.json();
}

export class NavCopilotClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: NavCopilotClientConfig) {
    const prefix = config.prefix ?? '/nav-engine';
    this.baseUrl = `${config.apiBaseUrl.replace(/\/$/, '')}${prefix}`;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async sendMessage(input: SendMessageInput): Promise<NavEngineHttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: input.sessionId,
        message: input.message,
        hostContext: input.hostContext,
      }),
    });
    return parseResponse(response);
  }

  async startOnboarding(input: StartOnboardingInput): Promise<NavEngineHttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/onboarding/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: input.sessionId,
        flowKey: input.flowKey,
        hostContext: input.hostContext,
      }),
    });
    return parseResponse(response);
  }

  async sendAudio(input: SendAudioInput): Promise<NavEngineHttpResponse> {
    const form = new FormData();
    form.append('sessionId', input.sessionId);
    if (input.hostContext) form.append('hostContext', JSON.stringify(input.hostContext));
    form.append('audio', input.audioBlob, 'recording.webm');

    const response = await this.fetchImpl(`${this.baseUrl}/audio`, {
      method: 'POST',
      body: form,
    });
    return parseResponse(response);
  }
}
