-- Fix app_settings paths that were incorrectly prefixed with _backend/
-- The SHAREPOINT_CONFIG_DRIVE_ID now scopes to the backend library directly,
-- so paths inside that library do not need the _backend/ prefix.

UPDATE app_settings 
SET value = 'Umbrella Report Config/site_employees',
    updated_at = NOW()
WHERE key = 'employeesPath' AND value LIKE '%_backend%';

UPDATE app_settings 
SET value = 'Umbrella Report Config/equipment',
    updated_at = NOW()
WHERE key = 'equipmentPath' AND value LIKE '%_backend%';
