import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db } from "../db.js";

export const complaintsRouter = Router();

complaintsRouter.use(requireAuth, requireRole(["OWNER", "MANAGER"]));

complaintsRouter.get("/", (_req, res) => {
  const complaints = db
    .prepare(
      `SELECT c.id, c.description, c.priority, c.status, c.created_at,
              c.attachment_path,
              COALESCE(cl.organization_name, cl.name) AS organization_name,
              COALESCE(cl.contact_name, cl.name) AS contact_name,
              cl.email AS client_email,
              cl.phone AS client_phone, t.id AS task_id
       FROM complaints c
       JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN tasks t ON t.complaint_id = c.id
       ORDER BY c.created_at DESC`
    )
    .all();

  res.json(complaints);
});

complaintsRouter.get("/:key", (req, res) => {
  const rawKey = String(req.params.key || "").trim().toUpperCase();
  const numericId = rawKey.startsWith("CMP-") ? Number(rawKey.replace("CMP-", "").replace(/^0+/, "") || "0") : Number(rawKey);

  if (!Number.isFinite(numericId) || numericId <= 0) {
    res.status(400).json({ error: "Invalid complaint key" });
    return;
  }

  const complaint = db
    .prepare(
      `SELECT c.id, c.description, c.priority, c.status, c.created_at, c.attachment_path,
              COALESCE(cl.organization_name, cl.name) AS organization_name,
              COALESCE(cl.contact_name, cl.name) AS contact_name,
              cl.email AS client_email, cl.phone AS client_phone
       FROM complaints c
       JOIN clients cl ON cl.id = c.client_id
       WHERE c.id = ?`
    )
    .get(numericId) as
    | {
        id: number;
        description: string;
        priority: string;
        status: string;
        created_at: string;
        attachment_path: string | null;
        organization_name: string;
        contact_name: string;
        client_email: string;
        client_phone: string;
      }
    | undefined;

  if (!complaint) {
    res.status(404).json({ error: "Complaint not found" });
    return;
  }

  const task = db
    .prepare(
      `SELECT t.id, t.status, t.deadline, t.created_at, t.closed_at,
              u1.name AS assigned_to_name, u2.name AS assigned_by_name
       FROM tasks t
       JOIN users u1 ON u1.id = t.assigned_to
       JOIN users u2 ON u2.id = t.assigned_by
       WHERE t.complaint_id = ?`
    )
    .get(numericId);

  const taskUpdates = task
    ? db
        .prepare(
          `SELECT tu.id, tu.remarks, tu.proof_path, tu.created_at, u.name AS updated_by_name
           FROM task_updates tu
           JOIN users u ON u.id = tu.updated_by
           WHERE tu.task_id = ?
           ORDER BY tu.created_at DESC`
        )
        .all((task as { id: number }).id)
    : [];

  const audit = db
    .prepare(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.details, a.created_at, u.name AS changed_by_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.changed_by
       WHERE (a.entity_type = 'complaint' AND a.entity_id = ?)
          OR (a.entity_type = 'task' AND a.details LIKE ?)
       ORDER BY a.created_at DESC`
    )
    .all(numericId, `%"complaintId":${numericId}%`);

  res.json({
    complaintKey: `CMP-${String(complaint.id).padStart(6, "0")}`,
    complaint,
    task: task || null,
    taskUpdates,
    audit
  });
});
