import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../db.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", (req, res) => {
  const includeRead = req.query.includeRead === "1";
  const notifications = db
    .prepare(
      `SELECT id, message, read, created_at
       FROM notifications
       WHERE user_id = ? ${includeRead ? "" : "AND read = 0"}
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(req.user!.id);

  res.json(notifications.map((n: any) => ({ ...n, read: Boolean(n.read) })));
});

notificationsRouter.patch("/:id/read", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM notifications WHERE id = ? AND user_id = ?").get(id, req.user!.id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
  res.json({ success: true });
});
