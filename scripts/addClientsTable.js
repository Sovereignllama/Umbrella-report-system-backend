const { Pool } = require('pg');

const pool = new Pool({
  host: 'umbrella-reports-db.postgres.database.azure.com',
  port: 5432,
  database: 'umbrella_reports',
  user: 'ericz',
  password: 'E1z2a76zb!@',
  ssl: { rejectUnauthorized: false }
});

async function updateSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create clients table
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        sharepoint_folder_id VARCHAR(500),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Created clients table');
    
    // Add client_id to projects table
    await client.query(`
      ALTER TABLE projects 
      ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id)
    `);
    console.log('✅ Added client_id to projects');
    
    // Add client_id to charge_out_rates for client-specific rates
    await client.query(`
      ALTER TABLE charge_out_rates 
      ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id)
    `);
    console.log('✅ Added client_id to charge_out_rates');
    
    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rates_client_id ON charge_out_rates(client_id)
    `);
    console.log('✅ Created indexes');
    
    await client.query('COMMIT');
    console.log('✅ Schema updated successfully!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

updateSchema();
