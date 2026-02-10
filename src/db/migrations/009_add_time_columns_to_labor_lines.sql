-- Migration: Add start_time and end_time columns to report_labor_lines
-- This stores the time range for each labor line entry

-- Add start_time column to report_labor_lines
ALTER TABLE report_labor_lines 
ADD COLUMN IF NOT EXISTS start_time TIME;

-- Add end_time column to report_labor_lines
ALTER TABLE report_labor_lines 
ADD COLUMN IF NOT EXISTS end_time TIME;

-- Add index for time-based queries
CREATE INDEX IF NOT EXISTS idx_labor_lines_times 
ON report_labor_lines(start_time, end_time) 
WHERE start_time IS NOT NULL AND end_time IS NOT NULL;
