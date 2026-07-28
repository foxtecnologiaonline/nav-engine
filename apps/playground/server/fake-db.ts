export interface Task {
  id: string;
  title: string;
}

/** "Banco" em memória só para o playground — nunca use isso em produção. */
export class FakeTaskDb {
  private tasks: Task[] = [];

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
}
