-- Migration: Make foreign keys nullable for SharePoint-based reports
-- This allows creating reports without database records for projects/employees/equipment
-- when using SharePoint folder structure and Excel files directly

-- Make project_id nullable
ALTER TABLE daily_reports 
ALTER COLUMN project_id DROP NOT NULL;

-- Make employee_id nullable in labor lines (using employee_name from Excel instead)
ALTER TABLE report_labor_lines
ALTER COLUMN employee_id DROP NOT NULL;

-- Make equipment_id nullable in equipment lines (using equipment_name from Excel instead)
ALTER TABLE report_equipment_lines
ALTER COLUMN equipment_id DROP NOT NULL;

-- Drop the foreign key constraints that prevent null values
-- We'll keep referential integrity when UUIDs are provided
ALTER TABLE daily_reports
DROP CONSTRAINT IF EXISTS daily_reports_project_id_fkey;

ALTER TABLE report_labor_lines
DROP CONSTRAINT IF EXISTS report_labor_lines_employee_id_fkey;

ALTER TABLE report_equipment_lines
DROP CONSTRAINT IF EXISTS report_equipment_lines_equipment_id_fkey;

-- Re-add foreign key constraints but allow nulls
ALTER TABLE daily_reports
ADD CONSTRAINT daily_reports_project_id_fkey 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE report_labor_lines
ADD CONSTRAINT report_labor_lines_employee_id_fkey 
FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE report_equipment_lines
ADD CONSTRAINT report_equipment_lines_equipment_id_fkey 
FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE;

-- Drop the existing unique constraint that includes project_id
ALTER TABLE daily_reports 
DROP CONSTRAINT IF EXISTS daily_reports_project_id_report_date_status_key;

-- Create a new unique constraint for SharePoint-based reports
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_report_by_client_project_date
ON daily_reports (client_name, project_name, report_date, status)
WHERE client_name IS NOT NULL AND project_name IS NOT NULL;

-- Keep the old constraint for database-project-based reports
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_report_by_project_date
ON daily_reports (project_id, report_date, status)
WHERE project_id IS NOT NULL;
