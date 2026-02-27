import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendEmail } from "../lib/mailer.js";
import { sendSms, sendWhatsApp } from "../lib/messenger.js";
import { logAudit } from "../lib/audit.js";
import type { TaskStatus } from "../types/models.js";

const proofUpload = multer({
  storage: multer.diskStorage({
    destination: "uploads/proofs",
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`)
  })
});

const createTaskSchema = z.object({
  complaintId: z.coerce.number().int().positive(),
  assignedToId: z.coerce.number().int().positive(),
  deadline: z.string(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]).optional()
});

const updateStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"])
});

const taskUpdateSchema = z.object({
  remarks: z.string().min(3)
});

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.post("/from-complaint", requireRole(["OWNER", "MANAGER"]), async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { complaintId, assignedToId, deadline, status, priority } = parsed.data;
  const complaint = db
    .prepare(
      `SELECT c.id, cl.organization_name, cl.contact_name, cl.name
       FROM complaints c
       JOIN clients cl ON cl.id = c.client_id
       WHERE c.id = ?`
    )
    .get(complaintId) as
    | { id: number; organization_name?: string; contact_name?: string; name: string }
    | undefined;
  if (!complaint) {
    res.status(404).json({ error: "Complaint not found" });
    return;
  }

  const existingTask = db.prepare("SELECT id FROM tasks WHERE complaint_id = ?").get(complaintId);
  if (existingTask) {
    res.status(400).json({ error: "Task already exists for complaint" });
    return;
  }

  const assignee = db
    .prepare("SELECT id, email, phone, role FROM users WHERE id = ?")
    .get(assignedToId) as { id: number; email: string; phone?: string; role: string } | undefined;
  if (!assignee || assignee.role !== "EMPLOYEE") {
    res.status(400).json({ error: "Assigned user must be employee" });
    return;
  }

  const insert = db
    .prepare(
      "INSERT INTO tasks (complaint_id, assigned_to, assigned_by, status, deadline) VALUES (?, ?, ?, ?, ?)"
    )
    .run(complaintId, assignedToId, req.user!.id, (status || "OPEN") as TaskStatus, new Date(deadline).toISOString());

  const taskId = Number(insert.lastInsertRowid);

  db.prepare("UPDATE complaints SET status = ? WHERE id = ?").run((status || "OPEN") as TaskStatus, complaintId);
  if (priority) {
    db.prepare("UPDATE complaints SET priority = ? WHERE id = ?").run(priority, complaintId);
  }

  const clientDisplayName = complaint.organization_name
    ? `${complaint.organization_name} (${complaint.contact_name || "Contact"})`
    : complaint.name;

  db.prepare("INSERT INTO notifications (user_id, task_id, message) VALUES (?, ?, ?)").run(
    assignedToId,
    taskId,
    `${clientDisplayName}: task assigned to you`
  );

  await sendEmail("Task assigned", assignee.email, `${clientDisplayName}: task assigned. Deadline: ${deadline}`);
  if (assignee.phone) {
    await sendSms(assignee.phone, `${clientDisplayName}: task assigned. Deadline: ${deadline}`);
    await sendWhatsApp(assignee.phone, `${clientDisplayName}: task assigned to you.`);
  }

  logAudit({
    entityType: "task",
    entityId: taskId,
    action: "task_assigned",
    changedBy: req.user!.id,
    details: { complaintId, assignedToId, priority: priority || "MEDIUM", deadline, status: status || "OPEN" }
  });

  res.status(201).json({ taskId });
});

tasksRouter.get("/", requireRole(["OWNER", "MANAGER"]), (_req, res) => {
  const tasks = db
    .prepare(
      `SELECT t.id, t.status, t.deadline, t.created_at, t.closed_at,
              c.id AS complaint_id, c.description AS complaint_description, c.priority,
              COALESCE(cl.organization_name, cl.name) AS organization_name,
              COALESCE(cl.contact_name, cl.name) AS contact_name,
              u.name AS assigned_to_name,
              ub.name AS assigned_by_name
       FROM tasks t
       JOIN complaints c ON c.id = t.complaint_id
       JOIN clients cl ON cl.id = c.client_id
       JOIN users u ON u.id = t.assigned_to
       JOIN users ub ON ub.id = t.assigned_by
       ORDER BY t.created_at DESC`
    )
    .all();

  res.json(tasks);
});

tasksRouter.get("/my", requireRole(["EMPLOYEE"]), (req, res) => {
  const tasks = db
    .prepare(
      `SELECT t.id, t.status, t.deadline, t.created_at, t.closed_at,
              c.id AS complaint_id, c.description AS complaint_description, c.priority,
              COALESCE(cl.organization_name, cl.name) AS organization_name,
              COALESCE(cl.contact_name, cl.name) AS contact_name
       FROM tasks t
       JOIN complaints c ON c.id = t.complaint_id
       JOIN clients cl ON cl.id = c.client_id
       WHERE t.assigned_to = ?
       ORDER BY t.created_at DESC`
    )
    .all(req.user!.id);

  res.json(tasks);
});

tasksRouter.post("/:taskId/unassign", requireRole(["OWNER", "MANAGER"]), (req, res) => {
  const taskId = Number(req.params.taskId);
  const task = db
    .prepare("SELECT id, complaint_id, assigned_to, assigned_by, status, deadline FROM tasks WHERE id = ?")
    .get(taskId) as
    | { id: number; complaint_id: number; assigned_to: number; assigned_by: number; status: string; deadline: string }
    | undefined;

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM task_updates WHERE task_id = ?").run(taskId);
    db.prepare("UPDATE notifications SET read = 1 WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    db.prepare("UPDATE complaints SET status = 'OPEN' WHERE id = ?").run(task.complaint_id);
  });

  transaction();

  logAudit({
    entityType: "task",
    entityId: taskId,
    action: "task_unassigned",
    changedBy: req.user!.id,
    details: {
      complaintId: task.complaint_id,
      previousAssignedTo: task.assigned_to,
      previousStatus: task.status,
      previousDeadline: task.deadline
    }
  });

  res.json({ success: true });
});

tasksRouter.patch("/:taskId/status", async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const taskId = Number(req.params.taskId);
  const task = db
    .prepare("SELECT id, assigned_to, assigned_by, complaint_id FROM tasks WHERE id = ?")
    .get(taskId) as { id: number; assigned_to: number; assigned_by: number; complaint_id: number } | undefined;

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const canManage = req.user!.role === "OWNER" || req.user!.role === "MANAGER";
  const isAssigned = req.user!.role === "EMPLOYEE" && req.user!.id === task.assigned_to;
  if (!canManage && !isAssigned) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  db.prepare("UPDATE tasks SET status = ?, closed_at = ? WHERE id = ?").run(
    parsed.data.status,
    parsed.data.status === "CLOSED" ? new Date().toISOString() : null,
    taskId
  );

  db.prepare("UPDATE complaints SET status = ? WHERE id = ?").run(parsed.data.status, task.complaint_id);

  logAudit({
    entityType: "task",
    entityId: taskId,
    action: "task_status_changed",
    changedBy: req.user!.id,
    details: { status: parsed.data.status }
  });

  if (parsed.data.status === "CLOSED") {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND task_id = ?").run(task.assigned_to, taskId);

    const assignedBy = db
      .prepare("SELECT email, phone FROM users WHERE id = ?")
      .get(task.assigned_by) as { email: string; phone?: string } | undefined;

    if (assignedBy) {
      await sendEmail("Task closed", assignedBy.email, `Task #${taskId} was closed by ${req.user!.name}`);
      if (assignedBy.phone) {
        await sendSms(assignedBy.phone, `Task #${taskId} closed by ${req.user!.name}`);
      }
    }
  }

  res.json({ success: true });
});

tasksRouter.post("/:taskId/updates", proofUpload.single("proof"), (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const taskId = Number(req.params.taskId);
  const task = db
    .prepare("SELECT id, assigned_to FROM tasks WHERE id = ?")
    .get(taskId) as { id: number; assigned_to: number } | undefined;

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const canManage = req.user!.role === "OWNER" || req.user!.role === "MANAGER";
  const isAssigned = req.user!.role === "EMPLOYEE" && req.user!.id === task.assigned_to;
  if (!canManage && !isAssigned) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const insert = db
    .prepare("INSERT INTO task_updates (task_id, remarks, proof_path, updated_by) VALUES (?, ?, ?, ?)")
    .run(taskId, parsed.data.remarks, req.file ? path.join("/uploads/proofs", req.file.filename) : null, req.user!.id);

  logAudit({
    entityType: "task_update",
    entityId: Number(insert.lastInsertRowid),
    action: "task_update_added",
    changedBy: req.user!.id,
    details: { taskId, remarks: parsed.data.remarks }
  });

  res.status(201).json({ id: Number(insert.lastInsertRowid) });
});
