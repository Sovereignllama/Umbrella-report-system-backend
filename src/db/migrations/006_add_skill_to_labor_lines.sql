-- Migration: Add skill_name column to report_labor_lines
-- This stores the skill/position assigned to each crew member on the report

-- Add skill_name column to report_labor_lines
ALTER TABLE report_labor_lines 
ADD COLUMN IF NOT EXISTS skill_name VARCHAR(255);

-- Add index for reporting queries
CREATE INDEX IF NOT EXISTS idx_labor_lines_skill 
ON report_labor_lines(skill_name) 
WHERE skill_name IS NOT NULL;
