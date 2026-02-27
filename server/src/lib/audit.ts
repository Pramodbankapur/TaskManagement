import { db } from "../db.js";

export function logAudit(params: {
  entityType: string;
  entityId?: number | null;
  action: string;
  changedBy?: number | null;
  details?: Record<string, unknown>;
}): void {
  db.prepare(
    "INSERT INTO audit_logs (entity_type, entity_id, action, changed_by, details) VALUES (?, ?, ?, ?, ?)"
  ).run(
    params.entityType,
    params.entityId ?? null,
    params.action,
    params.changedBy ?? null,
    params.details ? JSON.stringify(params.details) : null
  );
}
