-- Payroll Schema Enhancement Migration
-- Run this on existing database to add new payroll tables

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payroll_reports_pay_period ON payroll_reports(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_reports_status ON payroll_reports(status);
CREATE INDEX IF NOT EXISTS idx_payroll_report_history_report ON payroll_report_history(payroll_report_id);
CREATE INDEX IF NOT EXISTS idx_employee_pay_summary_period ON employee_pay_summary(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_employee_pay_summary_employee ON employee_pay_summary(employee_id);

-- Trigger for employee_pay_summary updated_at
CREATE TRIGGER trigger_employee_pay_summary_updated_at BEFORE UPDATE ON employee_pay_summary
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
