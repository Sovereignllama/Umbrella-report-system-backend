import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireAdmin } from '../middleware';
import { query } from '../services/database';

const router = Router();

// Default SharePoint paths
const DEFAULT_SETTINGS = {
  clientsPath: 'Projects',
  employeesPath: 'Umbrella Report Config/site_employees',
  equipmentPath: 'Umbrella Report Config/equipment',
  reportsBasePath: 'Projects',
};

interface AppSettings {
  id: string;
  key: string;
  value: string;
  description: string;
  updatedAt: Date;
  updatedBy?: string;
}

/**
 * GET /api/settings
 * Get all app settings (admin only)
 */
router.get('/', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query<AppSettings>(
      'SELECT * FROM app_settings ORDER BY key'
    );
    
    // Merge with defaults for any missing settings
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS };
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    // Return defaults if table doesn't exist yet
    res.json(DEFAULT_SETTINGS);
  }
});

/**
 * GET /api/settings/:key
 * Get a specific setting by key
 */
router.get('/:key', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    
    const result = await query<AppSettings>(
      'SELECT * FROM app_settings WHERE key = $1',
      [key]
    );
    
    if (result.rows.length > 0) {
      res.json({ key, value: result.rows[0].value });
    } else {
      // Return default if exists
      const defaultValue = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
      if (defaultValue) {
        res.json({ key, value: defaultValue });
      } else {
        res.status(404).json({ error: 'Setting not found' });
      }
    }
  } catch (error) {
    console.error('Error fetching setting:', error);
    const defaultValue = DEFAULT_SETTINGS[req.params.key as keyof typeof DEFAULT_SETTINGS];
    if (defaultValue) {
      res.json({ key: req.params.key, value: defaultValue });
    } else {
      res.status(500).json({ error: 'Failed to fetch setting' });
    }
  }
});

/**
 * PUT /api/settings/:key
 * Update a specific setting (admin only)
 */
router.put('/:key', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    
    if (!value) {
      res.status(400).json({ error: 'Value is required' });
      return;
    }
    
    // Upsert the setting
    await query(
      `INSERT INTO app_settings (key, value, description, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET 
         value = $2, 
         description = COALESCE($3, app_settings.description),
         updated_by = $4,
         updated_at = NOW()`,
      [key, value, description || null, req.user?.id || null]
    );
    
    res.json({ key, value, message: 'Setting updated successfully' });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

/**
 * PUT /api/settings
 * Update multiple settings at once (admin only)
 */
router.put('/', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const settings = req.body;
    
    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Settings object is required' });
      return;
    }
    
    // Update each setting
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'string') {
        await query(
          `INSERT INTO app_settings (key, value, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET 
             value = $2,
             updated_by = $3,
             updated_at = NOW()`,
          [key, value, req.user?.id || null]
        );
      }
    }
    
    res.json({ message: 'Settings updated successfully', settings });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * Helper function to get a setting value (for use by other routes)
 */
export async function getSetting(key: string): Promise<string> {
  try {
    const result = await query<AppSettings>(
      'SELECT value FROM app_settings WHERE key = $1',
      [key]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].value;
    }
    
    // Return default
    return DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS] || '';
  } catch (error) {
    // Return default on error
    return DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS] || '';
  }
}

export default router;
