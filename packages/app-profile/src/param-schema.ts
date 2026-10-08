import { z, type ZodTypeAny } from 'zod';

/**
 * DSL mínima e serializável (JSON) para descrever um parâmetro de ação ou
 * resposta de onboarding, sem o host precisar escrever zod diretamente.
 * Compilada para zod via `compileField`/`compileParamsSchema` — a validação
 * real do core continua sendo zod, isso é só a camada de modelagem por app.
 */
export type ParamFieldSchema =
  | { type: 'string'; description?: string; optional?: boolean; minLength?: number }
  | { type: 'number'; description?: string; optional?: boolean; min?: number; max?: number }
  | { type: 'boolean'; description?: string; optional?: boolean }
  | { type: 'enum'; values: string[]; description?: string; optional?: boolean };

export type ParamsProfile = Record<string, ParamFieldSchema>;

export function compileField(field: ParamFieldSchema): ZodTypeAny {
  let schema: ZodTypeAny;

  switch (field.type) {
    case 'string': {
      let s = z.string();
      if (field.minLength !== undefined) s = s.min(field.minLength);
      schema = s;
      break;
    }
    case 'number': {
      let s = z.number();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      schema = s;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'enum':
      schema = z.enum(field.values as [string, ...string[]]);
      break;
  }

  if (field.description) schema = schema.describe(field.description);
  return field.optional ? schema.optional() : schema;
}

export function compileParamsSchema(profile: ParamsProfile): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, field] of Object.entries(profile)) {
    shape[key] = compileField(field);
  }
  return z.object(shape);
}
