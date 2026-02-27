import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { signAuthToken } from "../utils/jwt.js";
import type { Role } from "../types/models.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const user = db
    .prepare("SELECT id, name, email, password, role FROM users WHERE email = ?")
    .get(parsed.data.email) as
    | { id: number; name: string; email: string; password: string; role: Role }
    | undefined;

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const isValid = await bcrypt.compare(parsed.data.password, user.password);
  if (!isValid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signAuthToken({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  });

  res.cookie("authToken", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 8 * 60 * 60 * 1000
  });

  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("authToken");
  res.json({ success: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});
