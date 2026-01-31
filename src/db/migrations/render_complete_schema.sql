-- Umbrella Report System - Complete Database Schema
-- PostgreSQL (Render)
-- Run this in Render's PostgreSQL shell or via psql

-- ============================================
-- CORE TABLES
-- ============================================

-- Clients Table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  sharepoint_folder_id VARCHAR(500),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  client_id UUID REFERENCES clients(id),
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
  skill_level VARCHAR(50) NOT NULL,
  client_id UUID REFERENCES clients(id),
  regular_rate DECIMAL(10, 2) NOT NULL,
  ot_rate DECIMAL(10, 2) NOT NULL,
  dt_rate DECIMAL(10, 2) NOT NULL,
  effective_date DATE DEFAULT CURRENT_DATE,
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(skill_level, client_id)
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

-- ============================================
-- DAILY REPORTS TABLES
-- ============================================

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

-- ============================================
-- PAYROLL TABLES
-- ============================================

-- Pay Periods Table
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
);

-- Payroll Reports Table - stores generated report metadata
CREATE TABLE IF NOT EXISTS payroll_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  sharepoint_url VARCHAR(500),
  sharepoint_folder_id VARCHAR(255),
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes INTEGER,
  total_employees INTEGER DEFAULT 0,
  total_hours DECIMAL(10, 2) DEFAULT 0,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generation_type VARCHAR(20) DEFAULT 'auto' CHECK (generation_type IN ('auto', 'manual', 'regenerated')),
  status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'uploaded')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pay_period_id, created_at)
);

-- Payroll Report History - tracks regenerations and changes
CREATE TABLE IF NOT EXISTS payroll_report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_report_id UUID NOT NULL REFERENCES payroll_reports(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL CHECK (action IN ('generated', 'regenerated', 'uploaded', 'downloaded', 'deleted', 'error')),
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  old_sharepoint_url VARCHAR(500),
  new_sharepoint_url VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Employee Pay Summary - aggregated hours per employee per pay period
CREATE TABLE IF NOT EXISTS employee_pay_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  total_regular_hours DECIMAL(10, 2) DEFAULT 0,
  total_ot_hours DECIMAL(10, 2) DEFAULT 0,
  total_dt_hours DECIMAL(10, 2) DEFAULT 0,
  total_hours DECIMAL(10, 2) DEFAULT 0,
  days_worked INTEGER DEFAULT 0,
  projects_worked INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pay_period_id, employee_id)
);

-- ============================================
-- SYSTEM TABLES
-- ============================================

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

-- Project SharePoint Mapping Table
CREATE TABLE IF NOT EXISTS project_sharepoint_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  folder_id VARCHAR(255) NOT NULL,
  web_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_rates_client_id ON charge_out_rates(client_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_project_id ON daily_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_supervisor_id ON daily_reports(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON daily_reports(status);
CREATE INDEX IF NOT EXISTS idx_report_labor_lines_report_id ON report_labor_lines(report_id);
CREATE INDEX IF NOT EXISTS idx_report_labor_lines_employee_id ON report_labor_lines(employee_id);
CREATE INDEX IF NOT EXISTS idx_report_equipment_lines_report_id ON report_equipment_lines(report_id);
CREATE INDEX IF NOT EXISTS idx_report_attachments_report_id ON report_attachments(report_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_employees_qb_id ON employees(qb_id);
CREATE INDEX IF NOT EXISTS idx_pay_periods_year ON pay_periods(year);
CREATE INDEX IF NOT EXISTS idx_pay_periods_dates ON pay_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_pay_periods_year_period ON pay_periods(year, period_number);
CREATE INDEX IF NOT EXISTS idx_payroll_reports_pay_period ON payroll_reports(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_reports_status ON payroll_reports(status);
CREATE INDEX IF NOT EXISTS idx_payroll_report_history_report ON payroll_report_history(payroll_report_id);
CREATE INDEX IF NOT EXISTS idx_employee_pay_summary_period ON employee_pay_summary(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_employee_pay_summary_employee ON employee_pay_summary(employee_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables
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

CREATE TRIGGER trigger_pay_periods_updated_at BEFORE UPDATE ON pay_periods
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_employee_pay_summary_updated_at BEFORE UPDATE ON employee_pay_summary
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================
-- DONE
-- ============================================
