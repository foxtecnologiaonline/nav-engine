/** Substitui `{chave}` por `String(values[chave])`. Chave ausente/undefined vira string vazia. */
export function resolveTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}
