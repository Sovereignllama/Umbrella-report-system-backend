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
        min: 0, // Don't hold idle connections - prevents stale connections
        idleTimeoutMillis: 300000,
        connectionTimeoutMillis: 10000,
        keepAlive: true, // Enable TCP keep-alive
        keepAliveInitialDelayMillis: 10000, // Start keep-alive after 10s
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'umbrella_reports',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        max: 20,
        min: 0, // Don't hold idle connections - prevents stale connections
        idleTimeoutMillis: 300000,
        connectionTimeoutMillis: 10000,
        keepAlive: true, // Enable TCP keep-alive
        keepAliveInitialDelayMillis: 10000, // Start keep-alive after 10s
        ssl: process.env.DB_HOST?.includes('azure') ? { rejectUnauthorized: false } : false,
      }
);

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client:', err.message);
  console.error('Error details:', {
    name: err.name,
    message: err.message,
    stack: err.stack?.split('\n')[0]
  });
  // Pool will automatically handle reconnection and remove failed clients
});

pool.on('connect', (client) => {
  // Set a statement timeout of 30 seconds to prevent long-running queries from hanging
  client.query('SET statement_timeout = 30000').catch((err: Error) => {
    console.error('Failed to set statement_timeout on connection:', err);
  });
});

// Health check
export async function testConnection(): Promise<void> {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query('SELECT NOW()');
      console.log('✅ Database connected:', result.rows[0]);
      return;
    } catch (error) {
      console.error(`❌ Database connection attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt === maxRetries) throw error;
      // Exponential backoff: 1s, 2s
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

// Periodic health check interval
let healthCheckInterval: NodeJS.Timeout | null = null;
let healthCheckCount = 0;

/**
 * Start periodic health check to keep connections warm and detect stale connections
 * Runs every 2 minutes to prevent idle connections from going stale
 */
export function startPoolHealthCheck(): void {
  if (healthCheckInterval) {
    console.log('⚠️  Pool health check already running');
    return;
  }

  const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

  healthCheckInterval = setInterval(async () => {
    try {
      await pool.query('SELECT 1');
      healthCheckCount++;
      // Only log occasionally to avoid log spam (every 10th check = ~20 minutes)
      if (healthCheckCount % 10 === 0) {
        console.log('✅ Pool health check passed');
      }
    } catch (error) {
      console.warn('⚠️  Pool health check failed:', {
        code: (error as any).code,
        message: (error as any).message
      });
      // Don't crash the server - pool will recover automatically
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  console.log('✅ Pool health check started (interval: 2 minutes)');
}

/**
 * Stop periodic health check (useful for graceful shutdown)
 */
export function stopPoolHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    healthCheckCount = 0;
    console.log('✅ Pool health check stopped');
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
      },
      {
        name: '012_add_time_entries',
        sql: `
          CREATE TABLE IF NOT EXISTS time_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
            employee_name VARCHAR(255) NOT NULL,
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            project_name VARCHAR(255),
            sign_in_time TIMESTAMP NOT NULL,
            sign_out_time TIMESTAMP,
            notes TEXT,
            recorded_by UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_time_entries_employee_id ON time_entries(employee_id);
          CREATE INDEX IF NOT EXISTS idx_time_entries_employee_name ON time_entries(employee_name);
          CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
          CREATE INDEX IF NOT EXISTS idx_time_entries_sign_in_time ON time_entries(sign_in_time);
          CREATE INDEX IF NOT EXISTS idx_time_entries_recorded_by ON time_entries(recorded_by);
        `
      },
      {
        name: '013_add_time_columns_to_labor_lines',
        sql: `
          ALTER TABLE report_labor_lines ADD COLUMN IF NOT EXISTS start_time TIME;
          ALTER TABLE report_labor_lines ADD COLUMN IF NOT EXISTS end_time TIME;
          CREATE INDEX IF NOT EXISTS idx_labor_lines_times 
          ON report_labor_lines(start_time, end_time) 
          WHERE start_time IS NOT NULL AND end_time IS NOT NULL;
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
  // Keep Date objects as-is; Express will serialize them to ISO 8601 strings in JSON responses
  if (obj instanceof Date) return obj;
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

// Helper to check if an error is connection-related
function isConnectionError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorCode = error.code?.toLowerCase() || '';
  
  return (
    errorCode === 'econnreset' ||
    errorCode === 'etimedout' ||
    errorCode === 'epipe' ||
    errorCode === 'enotfound' ||
    errorCode === 'econnrefused' ||
    errorMessage.includes('connection terminated') ||
    errorMessage.includes('connection error') ||
    errorMessage.includes('client has encountered a connection error') ||
    errorMessage.includes('connection closed') ||
    errorMessage.includes('socket hang up') ||
    errorMessage.includes('network error')
  );
}

const MAX_ERROR_MESSAGE_LENGTH = 100;

// Query wrapper
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  try {
    const result = await pool.query(text, params);
    return {
      rows: result.rows.map(toCamelCase) as T[],
      rowCount: result.rowCount || 0,
    };
  } catch (error) {
    // Retry once if it's a connection-related error
    if (isConnectionError(error)) {
      const errorMessage = (error as any).message || '';
      const truncatedMessage = errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
        ? errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH) + '...'
        : errorMessage;
      
      console.warn('⚠️  Connection error detected, retrying query once...', {
        code: (error as any).code,
        message: truncatedMessage
      });
      
      try {
        const result = await pool.query(text, params);
        return {
          rows: result.rows.map(toCamelCase) as T[],
          rowCount: result.rowCount || 0,
        };
      } catch (retryError) {
        console.error('❌ Query retry failed:', retryError);
        throw retryError;
      }
    }
    
    throw error;
  }
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
