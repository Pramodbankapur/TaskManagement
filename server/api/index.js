import { app } from "../dist/app.js";
import { initDb, seedDemoUsers } from "../dist/db.js";

let bootstrapped = false;

async function ensureBootstrap() {
  if (bootstrapped) return;
  initDb();
  await seedDemoUsers();
  bootstrapped = true;
}

export default async function handler(req, res) {
  await ensureBootstrap();
  return app(req, res);
}
