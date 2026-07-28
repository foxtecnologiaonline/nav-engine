import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './cosine-similarity.js';

describe('cosineSimilarity', () => {
  it('vetores idênticos têm similaridade 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('vetores ortogonais têm similaridade 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('vetores opostos têm similaridade -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('vetor nulo (norma 0) devolve 0 em vez de NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});
