import type {
  LLMConfirmationRequest,
  LLMConfirmationResponse,
  LLMDecision,
  LLMProvider,
  LLMResolveRequest,
  LLMResolveResponse,
} from '../types/llm.js';

type QueuedResolve = { type: 'response'; value: LLMResolveResponse } | { type: 'error'; error: unknown };
type QueuedConfirmation =
  | { type: 'response'; value: LLMConfirmationResponse }
  | { type: 'error'; error: unknown };

/**
 * Provider de teste/desenvolvimento: devolve decisões pré-programadas em
 * sequência (fila), sem chamar nenhuma API. Usado nos testes do `core` e
 * disponível para qualquer host prototipar sem custo de LLM real.
 */
export class FakeLLMProvider implements LLMProvider {
  private resolveQueue: QueuedResolve[] = [];
  private confirmationQueue: QueuedConfirmation[] = [];
  public readonly resolveCalls: LLMResolveRequest[] = [];
  public readonly confirmationCalls: LLMConfirmationRequest[] = [];

  queueResolve(decision: LLMDecision, modelTier: 'fast' | 'precise' = 'fast'): this {
    this.resolveQueue.push({ type: 'response', value: { decision, modelTier } });
    return this;
  }

  /** Faz a próxima chamada a `resolveIntent` rejeitar — simula falha de rede/API do provider. */
  queueResolveError(error: unknown = new Error('falha simulada do provider')): this {
    this.resolveQueue.push({ type: 'error', error });
    return this;
  }

  queueConfirmation(decision: LLMConfirmationResponse['decision']): this {
    this.confirmationQueue.push({ type: 'response', value: { decision } });
    return this;
  }

  /** Faz a próxima chamada a `resolveConfirmation` rejeitar — simula falha de rede/API do provider. */
  queueConfirmationError(error: unknown = new Error('falha simulada do provider')): this {
    this.confirmationQueue.push({ type: 'error', error });
    return this;
  }

  async resolveIntent(request: LLMResolveRequest): Promise<LLMResolveResponse> {
    this.resolveCalls.push(request);
    const next = this.resolveQueue.shift();
    if (!next) {
      return { decision: { kind: 'out_of_scope', message: 'Fila de respostas vazia (fake).' } };
    }
    if (next.type === 'error') throw next.error;
    return next.value;
  }

  async resolveConfirmation(request: LLMConfirmationRequest): Promise<LLMConfirmationResponse> {
    this.confirmationCalls.push(request);
    const next = this.confirmationQueue.shift();
    if (!next) return { decision: 'unclear' };
    if (next.type === 'error') throw next.error;
    return next.value;
  }
}
