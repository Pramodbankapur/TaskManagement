import { Pool, QueryResult } from "pg";
import { newDb } from "pg-mem";
import bcrypt from "bcryptjs";

// PostgreSQL connection pool
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return pool;
}

function createMemoryPool(): Pool {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const adapters = mem.adapters.createPg();
  const MemPool = adapters.Pool;
  console.warn("[db] Using pg-mem in-memory database. Configure DATABASE_URL for persistent data.");
  return new MemPool();
}

type PreparedStatement = {
  run: (...params: unknown[]) => Promise<{ lastInsertRowid: number; changes: number }>;
  get: (...params: unknown[]) => Promise<any>;
  all: (...params: unknown[]) => Promise<any[]>;
};

export const db = {
  query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    return getPool().query(sql, params);
  },
  
  queryOne: async (sql: string, params?: unknown[]): Promise<any> => {
    const result = await getPool().query(sql, params);
    return result.rows[0];
  },
  
  queryAll: async (sql: string, params?: unknown[]): Promise<any[]> => {
    const result = await getPool().query(sql, params);
    return result.rows;
  },

  prepare: (sql: string): PreparedStatement => {
    // Convert SQLite-style ? placeholders to PostgreSQL $n placeholders
    let pgSql = sql;
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    const isInsert = /^\s*insert\s+/i.test(pgSql);
    const hasReturning = /\breturning\b/i.test(pgSql);

    return {
      run: async (...params: unknown[]) => {
        const sqlForRun = isInsert && !hasReturning ? `${pgSql} RETURNING id` : pgSql;
        const result = await getPool().query(sqlForRun, params);
        return {
          lastInsertRowid: Number(result.rows[0]?.id || 0),
          changes: result.rowCount || 0
        };
      },
      get: async (...params: unknown[]) => {
        const result = await getPool().query(pgSql, params);
        return result.rows[0];
      },
      all: async (...params: unknown[]) => {
        const result = await getPool().query(pgSql, params);
        return result.rows;
      }
    };
  },

  async exec(sql: string) {
    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await getPool().query(statement);
      }
    }
  },

  transaction: <T extends (...args: any[]) => any>(fn: T): T => {
    const wrapped = (async (...args: any[]) => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const result = await Promise.resolve(fn(...args));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }) as T;
    return wrapped;
  }
};

export async function initDb(): Promise<void> {
  if (pool) return;

  const databaseUrl = process.env.DATABASE_URL;
  const dbMode = (process.env.DB_MODE || "").toLowerCase();
  const localhostDb = Boolean(databaseUrl && /localhost|127\.0\.0\.1|::1/i.test(databaseUrl));
  const forceMemory = dbMode === "memory";
  const allowLocalPostgres = process.env.USE_LOCAL_POSTGRES === "1";
  const shouldUseMemoryPg = forceMemory || !databaseUrl || (localhostDb && !allowLocalPostgres);

  if (shouldUseMemoryPg) {
    pool = createMemoryPool();
  } else {
    pool = new Pool({
      connectionString: databaseUrl
    });

    pool.on("error", (err) => {
      console.error("[db] Unexpected error on idle client", err);
    });
  }

  // Test connection
  let client = await getPool().connect();
  try {
    await client.query("SELECT NOW()");
    console.log(shouldUseMemoryPg ? "[db] pg-mem connection successful" : "[db] PostgreSQL connection successful");
  } catch (error: any) {
    if (!shouldUseMemoryPg && (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND")) {
      console.warn("[db] PostgreSQL unavailable, falling back to pg-mem.");
      try {
        client.release();
      } catch {
        // ignore
      }
      await pool?.end().catch(() => {});
      pool = createMemoryPool();
      client = await getPool().connect();
      await client.query("SELECT NOW()");
      console.log("[db] pg-mem connection successful");
    } else {
      console.error("[db] Failed to connect to PostgreSQL:", error);
      throw error;
    }
  } finally {
    client.release();
  }

  // Create tables
  await createTables();
}

async function createTables(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'EMPLOYEE')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      organization_name TEXT,
      contact_name TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')) DEFAULT 'OPEN',
      attachment_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      complaint_id INTEGER NOT NULL UNIQUE,
      assigned_to INTEGER NOT NULL,
      assigned_by INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')) DEFAULT 'OPEN',
      deadline TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id),
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS task_updates (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      remarks TEXT NOT NULL,
      proof_path TEXT,
      updated_by INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id INTEGER,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      changed_by INTEGER,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (changed_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
  `;

  // Execute each statement separately as PostgreSQL doesn't support multiple statements in one query
  const statements = sql.split(";").filter(s => s.trim());
  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await getPool().query(statement);
      } catch (error: any) {
        // Ignore "already exists" errors for idempotency
        if (!error.message.includes("already exists")) {
          console.error("[db] Error creating table:", error);
        }
      }
    }
  }

  console.log("[db] Database schema initialized");
}

export async function seedDemoUsers(): Promise<void> {
  const users = [
    { name: "Owner Admin", email: "owner@demo.com", phone: "+15550000001", role: "OWNER", password: "Owner@123" },
    { name: "Manager One", email: "manager@demo.com", phone: "+15550000002", role: "MANAGER", password: "Manager@123" },
    { name: "Employee One", email: "employee1@demo.com", phone: "+15550000003", role: "EMPLOYEE", password: "Employee@123" },
    { name: "Employee Two", email: "employee2@demo.com", phone: "+15550000004", role: "EMPLOYEE", password: "Employee@123" }
  ] as const;

  for (const user of users) {
    const exists = await db.queryOne("SELECT id FROM users WHERE email = $1", [user.email]);
    if (exists) continue;
    
    const hashed = await bcrypt.hash(user.password, 10);
    await db.query(
      "INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5)",
      [user.name, user.email, user.phone, hashed, user.role]
    );
  }

  console.log("[db] Demo users seeded");
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[db] PostgreSQL connection closed");
  }
}
