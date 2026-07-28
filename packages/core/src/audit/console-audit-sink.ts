import type { AuditEntry, AuditSink } from '../types/audit.js';

/** Implementação de referência: escreve cada entrada de auditoria no console. */
export class ConsoleAuditSink implements AuditSink {
  async record(entry: AuditEntry): Promise<void> {
    console.log('[nav-engine:audit]', JSON.stringify(entry));
  }
}
