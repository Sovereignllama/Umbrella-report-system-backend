import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Create connection pool
// Supports both DATABASE_URL (Render) and individual vars (Azure/local)
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'umbrella_reports',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: process.env.DB_HOST?.includes('azure') ? { rejectUnauthorized: false } : false,
      }
);

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

// Health check
export async function testConnection(): Promise<void> {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0]);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

// Run pending migrations
export async function runMigrations(): Promise<void> {
  try {
    // Create migrations tracking table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Define migrations in order
    const migrations = [
      {
        name: '005_add_employee_skills',
        sql: `
          CREATE TABLE IF NOT EXISTS employee_allowed_skills (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_name VARCHAR(255) NOT NULL,
            skill_name VARCHAR(255) NOT NULL,
            client_name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(255),
            UNIQUE(employee_name, skill_name, client_name)
          );
          CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON employee_allowed_skills(employee_name);
          CREATE INDEX IF NOT EXISTS idx_employee_skills_client ON employee_allowed_skills(client_name);
        `
      },
      {
        name: '007_add_inactive_employees',
        sql: `
          CREATE TABLE IF NOT EXISTS inactive_employees (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_name VARCHAR(255) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id)
          );
          CREATE INDEX IF NOT EXISTS idx_inactive_employees_name 
          ON inactive_employees(LOWER(employee_name));
        `
      },
      {
        name: '008_add_delays_column',
        sql: `
          ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS delays TEXT;
        `
      },
      {
        name: '009_add_tomorrows_activities_column',
        sql: `
          ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS tomorrows_activities TEXT;
        `
      },
      {
        name: '010_add_skill_name_to_labor_lines',
        sql: `
          ALTER TABLE report_labor_lines ADD COLUMN IF NOT EXISTS skill_name VARCHAR(255);
        `
      },
      {
        name: '011_add_equipment_name_to_equipment_lines',
        sql: `
          ALTER TABLE report_equipment_lines ADD COLUMN IF NOT EXISTS equipment_name VARCHAR(255);
        `
      }
    ];

    for (const migration of migrations) {
      // Check if migration already applied
      const existing = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
        [migration.name]
      );

      if (existing.rows.length === 0) {
        console.log(`🔄 Running migration: ${migration.name}`);
        await pool.query(migration.sql);
        await pool.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
          [migration.name]
        );
        console.log(`✅ Migration ${migration.name} applied successfully`);
      } else {
        console.log(`⏭️  Migration ${migration.name} already applied`);
      }
    }

    console.log('✅ All migrations complete');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Get client from pool
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

// Convert snake_case to camelCase and handle Date objects
function toCamelCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  // For Date objects, return just the date part (YYYY-MM-DD) to avoid timezone issues
  if (obj instanceof Date) {
    // Format as YYYY-MM-DD to preserve the original date
    const year = obj.getFullYear();
    const month = String(obj.getMonth() + 1).padStart(2, '0');
    const day = String(obj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (typeof obj !== 'object') return obj;

  const result: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = toCamelCase(obj[key]);
    }
  }
  return result;
}

// Query wrapper
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await pool.query(text, params);
  return {
    rows: result.rows.map(toCamelCase) as T[],
    rowCount: result.rowCount || 0,
  };
}

// Transaction wrapper
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  
  // Create a wrapped client that transforms results
  const wrappedClient = {
    query: async (text: string, params?: any[]) => {
      const result = await client.query(text, params);
      return {
        ...result,
        rows: result.rows.map(toCamelCase),
      };
    },
    release: () => client.release(),
  } as any;
  
  try {
    await client.query('BEGIN');
    const result = await callback(wrappedClient);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Close pool
export async function closePool(): Promise<void> {
  await pool.end();
  console.log('Database pool closed');
}

export default pool;
