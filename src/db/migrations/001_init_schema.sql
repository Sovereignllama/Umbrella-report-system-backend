-- Umbrella Report System Database Schema
-- PostgreSQL

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true,
  sharepoint_folder_id VARCHAR(255) NOT NULL,
  sharepoint_web_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees Table (imported from QuickBooks)
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  qb_id VARCHAR(255) UNIQUE,
  skill_level VARCHAR(50) NOT NULL DEFAULT 'Regular',
  active BOOLEAN DEFAULT true,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Equipment Table
CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Charge Out Rates Table
CREATE TABLE IF NOT EXISTS charge_out_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_level VARCHAR(50) NOT NULL UNIQUE,
  regular_rate DECIMAL(10, 2) NOT NULL,
  ot_rate DECIMAL(10, 2) NOT NULL,
  dt_rate DECIMAL(10, 2) NOT NULL,
  effective_date DATE DEFAULT CURRENT_DATE,
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users Table (Supervisors, Bosses, Admins)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'supervisor', 'boss')),
  active BOOLEAN DEFAULT true,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily Reports Table
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'submitted' CHECK (status IN ('submitted', 'archived')),
  excel_supervisor_url VARCHAR(500),
  excel_boss_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  overridden_from UUID REFERENCES daily_reports(id) ON DELETE SET NULL,
  UNIQUE(project_id, report_date, status)
);

-- Report Labor Lines Table
CREATE TABLE IF NOT EXISTS report_labor_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  regular_hours DECIMAL(5, 2) DEFAULT 0,
  ot_hours DECIMAL(5, 2) DEFAULT 0,
  dt_hours DECIMAL(5, 2) DEFAULT 0,
  work_description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Report Equipment Lines Table
CREATE TABLE IF NOT EXISTS report_equipment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  hours_used DECIMAL(5, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Report Materials Table
CREATE TABLE IF NOT EXISTS report_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  free_text_notes TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Report Attachments Table
CREATE TABLE IF NOT EXISTS report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  sharepoint_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  uploaded_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Template Versions Table
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  version VARCHAR(20) NOT NULL,
  sharepoint_url VARCHAR(500) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, version)
);

-- Project SharePoint Mapping Table (permanent mapping)
CREATE TABLE IF NOT EXISTS project_sharepoint_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  folder_id VARCHAR(255) NOT NULL,
  web_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Indexes for performance
CREATE INDEX idx_daily_reports_project_id ON daily_reports(project_id);
CREATE INDEX idx_daily_reports_supervisor_id ON daily_reports(supervisor_id);
CREATE INDEX idx_daily_reports_date ON daily_reports(report_date);
CREATE INDEX idx_daily_reports_status ON daily_reports(status);
CREATE INDEX idx_report_labor_lines_report_id ON report_labor_lines(report_id);
CREATE INDEX idx_report_labor_lines_employee_id ON report_labor_lines(employee_id);
CREATE INDEX idx_report_equipment_lines_report_id ON report_equipment_lines(report_id);
CREATE INDEX idx_report_attachments_report_id ON report_attachments(report_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_employees_qb_id ON employees(qb_id);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_timestamp BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_employees_timestamp BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_daily_reports_timestamp BEFORE UPDATE ON daily_reports
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_charge_out_rates_timestamp BEFORE UPDATE ON charge_out_rates
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_project_sharepoint_mapping_timestamp BEFORE UPDATE ON project_sharepoint_mapping
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
