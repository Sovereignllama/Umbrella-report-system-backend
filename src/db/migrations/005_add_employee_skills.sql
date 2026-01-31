-- Migration: Add employee allowed skills table
-- This allows admins to configure which skills each employee can select

-- Create table for employee allowed skills
CREATE TABLE IF NOT EXISTS employee_allowed_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_name VARCHAR(255) NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    UNIQUE(employee_name, skill_name, client_name)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON employee_allowed_skills(employee_name);
CREATE INDEX IF NOT EXISTS idx_employee_skills_client ON employee_allowed_skills(client_name);

-- Add comment
COMMENT ON TABLE employee_allowed_skills IS 'Stores which skills are allowed for each employee per client';
