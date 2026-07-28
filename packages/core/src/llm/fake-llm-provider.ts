import type {
  LLMConfirmationRequest,
  LLMConfirmationResponse,
  LLMDecision,
  LLMProvider,
  LLMResolveRequest,
  LLMResolveResponse,
} from '../types/llm.js';

/**
 * Provider de teste/desenvolvimento: devolve decisões pré-programadas em
 * sequência (fila), sem chamar nenhuma API. Usado nos testes do `core` e
 * disponível para qualquer host prototipar sem custo de LLM real.
 */
export class FakeLLMProvider implements LLMProvider {
  private resolveQueue: LLMResolveResponse[] = [];
  private confirmationQueue: LLMConfirmationResponse[] = [];
  public readonly resolveCalls: LLMResolveRequest[] = [];
  public readonly confirmationCalls: LLMConfirmationRequest[] = [];

  queueResolve(decision: LLMDecision, modelTier: 'fast' | 'precise' = 'fast'): this {
    this.resolveQueue.push({ decision, modelTier });
    return this;
  }

  queueConfirmation(decision: LLMConfirmationResponse['decision']): this {
    this.confirmationQueue.push({ decision });
    return this;
  }

  async resolveIntent(request: LLMResolveRequest): Promise<LLMResolveResponse> {
    this.resolveCalls.push(request);
    const next = this.resolveQueue.shift();
    if (!next) {
      return { decision: { kind: 'out_of_scope', message: 'Fila de respostas vazia (fake).' } };
    }
    return next;
  }

  async resolveConfirmation(request: LLMConfirmationRequest): Promise<LLMConfirmationResponse> {
    this.confirmationCalls.push(request);
    const next = this.confirmationQueue.shift();
    return next ?? { decision: 'unclear' };
  }
}
