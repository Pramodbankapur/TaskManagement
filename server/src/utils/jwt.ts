import jwt from "jsonwebtoken";
import type { Role } from "../types/models.js";

const JWT_SECRET = process.env.JWT_SECRET || "change_me_in_production";

function resolveExpiresIn(): jwt.SignOptions["expiresIn"] {
  const raw = String(process.env.JWT_EXPIRES_IN || "8h").trim().replace(/^['"]|['"]$/g, "");
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  if (/^\d+\s*(ms|s|m|h|d|w|y)$/i.test(raw)) {
    return raw.replace(/\s+/g, "") as jwt.SignOptions["expiresIn"];
  }
  if (raw === "8h") return raw;
  console.warn(`[auth] Invalid JWT_EXPIRES_IN "${raw}", falling back to 8h`);
  return "8h";
}

const JWT_EXPIRES_IN = resolveExpiresIn();

export interface AuthTokenPayload {
  id: number;
  role: Role;
  email: string;
  name: string;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}
