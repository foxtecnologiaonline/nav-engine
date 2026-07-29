export class DuplicateActionKeyError extends Error {
  constructor(key: string) {
    super(`Ação duplicada: já existe uma ação registrada com key "${key}".`);
    this.name = 'DuplicateActionKeyError';
  }
}

export class DuplicateOnboardingFlowKeyError extends Error {
  constructor(key: string) {
    super(`Fluxo de onboarding duplicado: já existe um flow registrado com key "${key}".`);
    this.name = 'DuplicateOnboardingFlowKeyError';
  }
}
