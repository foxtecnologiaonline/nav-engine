/** Nomes de tool da Anthropic precisam casar com ^[a-zA-Z0-9_-]{1,128}$. */
export function sanitizeToolName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface ToolNameMap {
  toTool(actionKey: string): string;
  fromTool(toolName: string): string | undefined;
}

/**
 * Constrói o mapa de ida/volta actionKey <-> nome de tool sanitizado para
 * UMA chamada (o shortlist muda a cada turno, então não persiste estado
 * entre chamadas). Lança erro cedo se duas keys diferentes colidirem após
 * sanitização — melhor falhar alto do que confundir duas ações em runtime.
 */
export function buildToolNameMap(actionKeys: string[]): ToolNameMap {
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();

  for (const key of actionKeys) {
    const sanitized = sanitizeToolName(key);
    const existingKey = backward.get(sanitized);
    if (existingKey && existingKey !== key) {
      throw new Error(
        `nav-engine/llm-anthropic: colisão de nome de tool entre "${existingKey}" e "${key}" ` +
          `(ambos sanitizam para "${sanitized}"). Renomeie uma das actions para evitar ambiguidade.`,
      );
    }
    forward.set(key, sanitized);
    backward.set(sanitized, key);
  }

  return {
    toTool(actionKey) {
      const sanitized = forward.get(actionKey);
      if (!sanitized) {
        throw new Error(`nav-engine/llm-anthropic: actionKey desconhecida "${actionKey}".`);
      }
      return sanitized;
    },
    fromTool(toolName) {
      return backward.get(toolName);
    },
  };
}
