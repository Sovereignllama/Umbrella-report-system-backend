-- Migration: Add inactive_employees table
-- Tracks which employees are inactive and should not appear in dropdowns

CREATE TABLE IF NOT EXISTS inactive_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_inactive_employees_name 
ON inactive_employees(LOWER(employee_name));
