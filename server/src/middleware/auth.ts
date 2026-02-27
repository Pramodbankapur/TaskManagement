import { NextFunction, Request, Response } from "express";
import type { Role } from "../types/models.js";
import { verifyAuthToken } from "../utils/jwt.js";
import { db } from "../db.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = req.cookies.authToken;
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = verifyAuthToken(token);
    const user = db
      .prepare("SELECT id, name, email, role FROM users WHERE id = ?")
      .get(payload.id) as { id: number; name: string; email: string; role: Role } | undefined;

    if (!user) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
