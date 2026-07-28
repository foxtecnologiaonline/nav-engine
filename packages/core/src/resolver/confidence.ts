export const DEFAULT_CONFIDENCE_THRESHOLD = 70;
export const DEFAULT_ESCALATION_MARGIN = 15;

export function isAboveThreshold(confidence: number, threshold: number): boolean {
  return confidence >= threshold;
}
