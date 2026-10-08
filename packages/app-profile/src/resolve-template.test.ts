import { describe, expect, it } from 'vitest';
import { resolveTemplate } from './resolve-template.js';

describe('resolveTemplate', () => {
  it('substitui placeholders presentes', () => {
    expect(resolveTemplate('/app/tasks/{taskId}', { taskId: 'abc' })).toBe('/app/tasks/abc');
  });

  it('substitui múltiplos placeholders', () => {
    expect(resolveTemplate('/{a}/{b}', { a: '1', b: '2' })).toBe('/1/2');
  });

  it('vira string vazia quando o valor está ausente', () => {
    expect(resolveTemplate('/app/{missing}', {})).toBe('/app/');
  });

  it('converte números e booleanos para string', () => {
    expect(resolveTemplate('/{n}/{b}', { n: 42, b: true })).toBe('/42/true');
  });
});
