import type { Role } from "./models.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: Role;
        email: string;
        name: string;
      };
    }
  }
}

export {};
