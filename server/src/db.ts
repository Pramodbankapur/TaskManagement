import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const dbPath = process.env.DATABASE_PATH || "./data/app.db";

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'EMPLOYEE')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      organization_name TEXT,
      contact_name TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')) DEFAULT 'OPEN',
      attachment_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL UNIQUE,
      assigned_to INTEGER NOT NULL,
      assigned_by INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')) DEFAULT 'OPEN',
      deadline TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id),
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS task_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      remarks TEXT NOT NULL,
      proof_path TEXT,
      updated_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_id INTEGER,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      changed_by INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (changed_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const hasPhoneColumn = userColumns.some((column) => column.name === "phone");
  if (!hasPhoneColumn) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  }

  const clientColumns = db.prepare("PRAGMA table_info(clients)").all() as Array<{ name: string }>;
  if (!clientColumns.some((column) => column.name === "organization_name")) {
    db.exec("ALTER TABLE clients ADD COLUMN organization_name TEXT");
  }
  if (!clientColumns.some((column) => column.name === "contact_name")) {
    db.exec("ALTER TABLE clients ADD COLUMN contact_name TEXT");
  }

  const notificationColumns = db.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
  if (!notificationColumns.some((column) => column.name === "task_id")) {
    db.exec("ALTER TABLE notifications ADD COLUMN task_id INTEGER");
  }
}

export async function seedDemoUsers(): Promise<void> {
  const users = [
    { name: "Owner Admin", email: "owner@demo.com", phone: "+15550000001", role: "OWNER", password: "Owner@123" },
    { name: "Manager One", email: "manager@demo.com", phone: "+15550000002", role: "MANAGER", password: "Manager@123" },
    { name: "Employee One", email: "employee1@demo.com", phone: "+15550000003", role: "EMPLOYEE", password: "Employee@123" },
    { name: "Employee Two", email: "employee2@demo.com", phone: "+15550000004", role: "EMPLOYEE", password: "Employee@123" }
  ] as const;

  for (const user of users) {
    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(user.email);
    if (exists) continue;
    const hashed = await bcrypt.hash(user.password, 10);
    db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)").run(
      user.name,
      user.email,
      user.phone,
      hashed,
      user.role
    );
  }
}
