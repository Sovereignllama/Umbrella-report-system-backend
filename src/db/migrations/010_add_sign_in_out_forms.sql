-- Sign-In/Out Forms Table (for photo uploads of sign-in/out sheets)
CREATE TABLE IF NOT EXISTS sign_in_out_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  uploaded_by VARCHAR(255) NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sharepoint_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sign_in_out_forms_date ON sign_in_out_forms(date);
CREATE INDEX IF NOT EXISTS idx_sign_in_out_forms_uploaded_by ON sign_in_out_forms(uploaded_by);
