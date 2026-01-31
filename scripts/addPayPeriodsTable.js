/**
 * Migration script to add pay_periods table
 * Run with: node scripts/addPayPeriodsTable.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Starting pay_periods migration...\n');

    // 1. Create pay_periods table
    console.log('1. Creating pay_periods table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS pay_periods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        year INTEGER NOT NULL,
        period_number INTEGER NOT NULL CHECK (period_number >= 1 AND period_number <= 26),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        report_generated BOOLEAN DEFAULT FALSE,
        report_generated_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(year, period_number)
      )
    `);
    console.log('   ✅ Created pay_periods table');

    // 2. Create indexes
    console.log('2. Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pay_periods_year ON pay_periods(year)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pay_periods_dates ON pay_periods(start_date, end_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pay_periods_year_period ON pay_periods(year, period_number)
    `);
    console.log('   ✅ Created indexes');

    // 3. Create trigger for updated_at
    console.log('3. Creating updated_at trigger...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_pay_periods_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_pay_periods_updated_at ON pay_periods
    `);
    await client.query(`
      CREATE TRIGGER trigger_pay_periods_updated_at
        BEFORE UPDATE ON pay_periods
        FOR EACH ROW
        EXECUTE FUNCTION update_pay_periods_updated_at()
    `);
    console.log('   ✅ Created updated_at trigger');

    console.log('\n✅ Pay periods schema migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
