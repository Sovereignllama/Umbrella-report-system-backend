-- Migration: Add client_name, project_name, week_folder, materials columns to daily_reports
-- and create app_settings table for configurable paths
-- Run this migration against the Render PostgreSQL database

-- Add new columns to daily_reports table
ALTER TABLE daily_reports 
ADD COLUMN IF NOT EXISTS client_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS project_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS week_folder VARCHAR(100),
ADD COLUMN IF NOT EXISTS materials TEXT;

-- Create index for efficient lookups by client/project/date
CREATE INDEX IF NOT EXISTS idx_daily_reports_client_project_date 
ON daily_reports (client_name, project_name, report_date);

-- Add employee_name to report_labor_lines for display purposes
ALTER TABLE report_labor_lines
ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255);

-- Add equipment_name to report_equipment_lines for display purposes
ALTER TABLE report_equipment_lines
ADD COLUMN IF NOT EXISTS equipment_name VARCHAR(255);

-- Create app_settings table for configurable paths
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default settings
INSERT INTO app_settings (key, value, description) VALUES
  ('clientsPath', 'Projects', 'SharePoint folder path for client folders'),
  ('employeesPath', 'Umbrella Report Config/site_employees', 'SharePoint folder path for employee list'),
  ('equipmentPath', 'Umbrella Report Config/equipment', 'SharePoint folder path for equipment list'),
  ('reportsBasePath', 'Projects', 'Base SharePoint folder path for saving reports')
ON CONFLICT (key) DO NOTHING;
