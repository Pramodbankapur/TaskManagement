import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getMailerDebug } from "../lib/mailer.js";

export const systemRouter = Router();

systemRouter.use(requireAuth, requireRole(["OWNER"]));

systemRouter.get("/mail-status", (_req, res) => {
  res.json(getMailerDebug());
});
