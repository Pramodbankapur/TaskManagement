import { app } from "./app.js";
import { initDb, seedDemoUsers } from "./db.js";

const port = Number(process.env.PORT || 4000);

async function start() {
  initDb();
  await seedDemoUsers();
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
