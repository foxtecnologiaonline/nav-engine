export interface Task {
  id: string;
  title: string;
}

export interface BusinessSettings {
  name: string;
  openingHours: string;
  acceptsOnlinePayment?: boolean;
}

/** "Banco" em memória só para o playground — nunca use isso em produção. */
export class FakeTaskDb {
  private tasks: Task[] = [];
  private businessSettings: BusinessSettings | null = null;

  create(title: string): Task {
    const task: Task = { id: crypto.randomUUID(), title };
    this.tasks.push(task);
    return task;
  }

  list(): Task[] {
    return this.tasks;
  }

  deleteAll(): number {
    const count = this.tasks.length;
    this.tasks = [];
    return count;
  }

  saveBusinessSettings(settings: BusinessSettings): void {
    this.businessSettings = settings;
  }

  getBusinessSettings(): BusinessSettings | null {
    return this.businessSettings;
  }
}
