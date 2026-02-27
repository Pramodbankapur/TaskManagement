import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const auditRouter = Router();

auditRouter.use(requireAuth, requireRole(["OWNER", "MANAGER"]));

auditRouter.get("/", (_req, res) => {
  const logs = db
    .prepare(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.details, a.created_at, u.name AS changed_by_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.changed_by
       ORDER BY a.created_at DESC
       LIMIT 200`
    )
    .all();

  res.json(logs);
});
