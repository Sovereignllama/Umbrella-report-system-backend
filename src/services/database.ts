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
