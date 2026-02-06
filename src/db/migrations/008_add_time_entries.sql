-- Time Entries Table (for sign in/out tracking)
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  employee_name VARCHAR(255) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  project_name VARCHAR(255),
  sign_in_time TIMESTAMP NOT NULL,
  sign_out_time TIMESTAMP,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_time_entries_employee_id ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_employee_name ON time_entries(employee_name);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_sign_in_time ON time_entries(sign_in_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_recorded_by ON time_entries(recorded_by);

CREATE TRIGGER update_time_entries_timestamp BEFORE UPDATE ON time_entries
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
