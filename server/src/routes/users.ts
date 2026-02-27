import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole(["OWNER", "MANAGER"]));

usersRouter.get("/employees", (_req, res) => {
  const employees = db
    .prepare("SELECT id, name, email FROM users WHERE role = 'EMPLOYEE' ORDER BY name ASC")
    .all();
  res.json(employees);
});
