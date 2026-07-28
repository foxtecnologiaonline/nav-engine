export class DuplicateActionKeyError extends Error {
  constructor(key: string) {
    super(`Ação duplicada: já existe uma ação registrada com key "${key}".`);
    this.name = 'DuplicateActionKeyError';
  }
}
