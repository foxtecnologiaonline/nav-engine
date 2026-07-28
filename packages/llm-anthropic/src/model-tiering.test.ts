import { describe, expect, it, vi } from 'vitest';
import { resolveWithTiering, type TieringConfig } from './model-tiering.js';

const baseConfig: TieringConfig = {
  fastModel: 'fast-model',
  preciseModel: 'precise-model',
  confidenceThreshold: 70,
  escalationMargin: 15,
  escalateOnLowConfidence: true,
};

describe('resolveWithTiering', () => {
  it('confiança alta faz só 1 chamada (fastModel)', async () => {
    const resolveWithModel = vi.fn().mockResolvedValue({
      decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 95 },
      raw: {},
    });

    const result = await resolveWithTiering(baseConfig, resolveWithModel);

    expect(resolveWithModel).toHaveBeenCalledTimes(1);
    expect(resolveWithModel).toHaveBeenCalledWith('fast-model');
    expect(result.modelTier).toBe('fast');
  });

  it('confiança na margem escala para o preciseModel', async () => {
    const resolveWithModel = vi
      .fn()
      .mockResolvedValueOnce({
        decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 78 },
        raw: { model: 'fast' },
      })
      .mockResolvedValueOnce({
        decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 92 },
        raw: { model: 'precise' },
      });

    const result = await resolveWithTiering(baseConfig, resolveWithModel);

    expect(resolveWithModel).toHaveBeenCalledTimes(2);
    expect(resolveWithModel).toHaveBeenNthCalledWith(1, 'fast-model');
    expect(resolveWithModel).toHaveBeenNthCalledWith(2, 'precise-model');
    expect(result.modelTier).toBe('precise');
    expect(result.decision).toEqual({ kind: 'action', actionKey: 'a', params: {}, confidence: 92 });
  });

  it('clarify com 2+ ações ambíguas escala para o preciseModel', async () => {
    const resolveWithModel = vi
      .fn()
      .mockResolvedValueOnce({
        decision: { kind: 'clarify', question: 'qual?', ambiguousActionKeys: ['a', 'b'] },
        raw: {},
      })
      .mockResolvedValueOnce({
        decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 90 },
        raw: {},
      });

    const result = await resolveWithTiering(baseConfig, resolveWithModel);
    expect(resolveWithModel).toHaveBeenCalledTimes(2);
    expect(result.modelTier).toBe('precise');
  });

  it('escalateOnLowConfidence:false nunca faz a segunda chamada mesmo em confiança marginal', async () => {
    const resolveWithModel = vi.fn().mockResolvedValue({
      decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 78 },
      raw: {},
    });

    const result = await resolveWithTiering(
      { ...baseConfig, escalateOnLowConfidence: false },
      resolveWithModel,
    );

    expect(resolveWithModel).toHaveBeenCalledTimes(1);
    expect(result.modelTier).toBe('fast');
  });

  it('confiança abaixo do threshold não escala (já vai virar clarify no engine de qualquer forma)', async () => {
    const resolveWithModel = vi.fn().mockResolvedValue({
      decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 40 },
      raw: {},
    });

    const result = await resolveWithTiering(baseConfig, resolveWithModel);
    expect(resolveWithModel).toHaveBeenCalledTimes(1);
    expect(result.modelTier).toBe('fast');
  });

  it('out_of_scope e chat nunca escalam', async () => {
    const resolveWithModel = vi
      .fn()
      .mockResolvedValue({ decision: { kind: 'chat', message: 'oi' }, raw: {} });
    const result = await resolveWithTiering(baseConfig, resolveWithModel);
    expect(resolveWithModel).toHaveBeenCalledTimes(1);
    expect(result.modelTier).toBe('fast');
  });

  it('soma o uso de tokens das duas chamadas quando há escalada', async () => {
    const resolveWithModel = vi
      .fn()
      .mockResolvedValueOnce({
        decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 78 },
        raw: {},
        usage: { inputTokens: 100, outputTokens: 20 },
      })
      .mockResolvedValueOnce({
        decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 92 },
        raw: {},
        usage: { inputTokens: 150, outputTokens: 30 },
      });

    const result = await resolveWithTiering(baseConfig, resolveWithModel);
    expect(result.usage).toEqual({ inputTokens: 250, outputTokens: 50 });
  });

  it('sem escalada, o uso de tokens é só da chamada fast', async () => {
    const resolveWithModel = vi.fn().mockResolvedValue({
      decision: { kind: 'action', actionKey: 'a', params: {}, confidence: 95 },
      raw: {},
      usage: { inputTokens: 80, outputTokens: 10 },
    });

    const result = await resolveWithTiering(baseConfig, resolveWithModel);
    expect(result.usage).toEqual({ inputTokens: 80, outputTokens: 10 });
  });
});
