import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { complaintsRouter } from "./routes/complaints.js";
import { tasksRouter } from "./routes/tasks.js";
import { notificationsRouter } from "./routes/notifications.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { usersRouter } from "./routes/users.js";
import { auditRouter } from "./routes/audit.js";
import { systemRouter } from "./routes/system.js";
import { errorHandler } from "./middleware/error.js";

export const app = express();

function parseAllowedOrigins(value: string | undefined): string[] {
  const raw = (value || "http://localhost:5173")
    .replace(/[\r\n]/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = [...new Set(raw)];
  return unique.filter((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

const allowedOrigins = parseAllowedOrigins(process.env.CLIENT_URL);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "task-complaint-server" });
});

app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/users", usersRouter);
app.use("/api/audit", auditRouter);
app.use("/api/system", systemRouter);

app.use(errorHandler);
