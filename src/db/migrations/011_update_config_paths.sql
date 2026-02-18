-- Migration: Update SharePoint config paths to use _backend/Umbrella Report Config
-- Config files have been moved to a hidden _backend directory for security

UPDATE app_settings 
SET value = '_backend/Umbrella Report Config/site_employees',
    updated_at = NOW()
WHERE key = 'employeesPath' 
  AND value = 'Umbrella Report Config/site_employees';

UPDATE app_settings 
SET value = '_backend/Umbrella Report Config/equipment',
    updated_at = NOW()
WHERE key = 'equipmentPath' 
  AND value = 'Umbrella Report Config/equipment';
