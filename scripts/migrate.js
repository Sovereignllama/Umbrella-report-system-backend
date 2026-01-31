#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'postgres', // Connect to default postgres db first
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL...');
    
    // Create database if it doesn't exist
    console.log('Creating database if it does not exist...');
    await client.query(`CREATE DATABASE ${process.env.DB_NAME};`);
    console.log(`✓ Database '${process.env.DB_NAME}' created or already exists`);
    
    client.release();
    
    // Connect to the new database
    const dbPool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    
    const dbClient = await dbPool.connect();
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../src/db/migrations/001_init_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    console.log('Running migration...');
    await dbClient.query(migrationSQL);
    console.log('✓ Migration completed successfully');
    
    dbClient.release();
    dbPool.end();
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('✓ Database already exists, continuing with schema creation...');
      
      const dbPool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });
      
      const dbClient = await dbPool.connect();
      const migrationPath = path.join(__dirname, '../src/db/migrations/001_init_schema.sql');
      const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      
      await dbClient.query(migrationSQL);
      console.log('✓ Schema created successfully');
      
      dbClient.release();
      dbPool.end();
    } else {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

migrate();
