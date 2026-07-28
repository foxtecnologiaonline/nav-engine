import type { LLMDecision, TokenUsage } from '@nav-engine/core';

export interface TieringConfig {
  fastModel: string;
  preciseModel: string;
  confidenceThreshold: number;
  escalationMargin: number;
  escalateOnLowConfidence: boolean;
}

export interface ModelResolveOutcome {
  decision: LLMDecision;
  raw: unknown;
  usage?: TokenUsage;
}

export interface TieredResolveOutcome extends ModelResolveOutcome {
  modelTier: 'fast' | 'precise';
}

function sumUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (!a && !b) return undefined;
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  };
}

/**
 * Guardrail #7: a escalação de modelo nunca reduz rigor — ela só decide
 * QUAL modelo responde; o resultado do modelo rápido passa exatamente pelas
 * mesmas checagens de confiança/threshold no `NavEngine` de qualquer forma.
 * Escala para o modelo preciso quando: (a) o rápido pediu esclarecimento por
 * ambiguidade entre 2+ ações, ou (b) a confiança ficou na margem acima do
 * threshold (zona onde um segundo parecer barato compensa o custo).
 */
export async function resolveWithTiering(
  config: TieringConfig,
  resolveWithModel: (model: string) => Promise<ModelResolveOutcome>,
): Promise<TieredResolveOutcome> {
  const fastResult = await resolveWithModel(config.fastModel);

  if (!config.escalateOnLowConfidence) {
    return { ...fastResult, modelTier: 'fast' };
  }

  const needsEscalation = shouldEscalate(fastResult.decision, config);
  if (!needsEscalation) {
    return { ...fastResult, modelTier: 'fast' };
  }

  const preciseResult = await resolveWithModel(config.preciseModel);
  return {
    ...preciseResult,
    modelTier: 'precise',
    // Custo real da escalada é a soma das duas chamadas, não só da última.
    usage: sumUsage(fastResult.usage, preciseResult.usage),
  };
}

function shouldEscalate(decision: LLMDecision, config: TieringConfig): boolean {
  if (decision.kind === 'clarify') {
    return (decision.ambiguousActionKeys?.length ?? 0) > 1;
  }
  if (decision.kind === 'action') {
    const { confidence } = decision;
    return (
      confidence >= config.confidenceThreshold &&
      confidence < config.confidenceThreshold + config.escalationMargin
    );
  }
  return false;
}
