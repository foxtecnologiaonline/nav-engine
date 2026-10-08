import { describe, expect, it } from 'vitest';
import { compileField, compileParamsSchema } from './param-schema.js';

describe('compileField', () => {
  it('compila string com minLength', () => {
    const schema = compileField({ type: 'string', minLength: 3 });
    expect(schema.safeParse('ok').success).toBe(false);
    expect(schema.safeParse('okay').success).toBe(true);
  });

  it('compila number com min/max', () => {
    const schema = compileField({ type: 'number', min: 1, max: 5 });
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(6).success).toBe(false);
    expect(schema.safeParse(3).success).toBe(true);
  });

  it('compila boolean', () => {
    const schema = compileField({ type: 'boolean' });
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse('true').success).toBe(false);
  });

  it('compila enum', () => {
    const schema = compileField({ type: 'enum', values: ['a', 'b'] });
    expect(schema.safeParse('a').success).toBe(true);
    expect(schema.safeParse('c').success).toBe(false);
  });

  it('respeita optional', () => {
    const schema = compileField({ type: 'string', optional: true });
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('lança erro claro para enum sem valores, em vez de um erro críptico do zod', () => {
    expect(() => compileField({ type: 'enum', values: [] })).toThrow(/pelo menos um valor/);
  });
});

describe('compileParamsSchema', () => {
  it('compila um objeto inteiro a partir do profile', () => {
    const schema = compileParamsSchema({
      taskId: { type: 'string' },
      priority: { type: 'enum', values: ['low', 'high'], optional: true },
    });
    expect(schema.safeParse({ taskId: 'abc' }).success).toBe(true);
    expect(schema.safeParse({ taskId: 'abc', priority: 'high' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });
});
