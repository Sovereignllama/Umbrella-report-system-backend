import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware } from '../middleware';
import { listFilesInFolder, readJsonFileByPath, readFileByPath, getOrCreateFolder } from '../services/sharepointService';
import { getSetting } from './settingsRoutes';
import { calculateHoursBreakdown, isStatHoliday, getWeekStart, getWeekEnd, getClientRules } from '../services/overtimeService';
import { DailyReportRepository, ReportLaborLineRepository } from '../repositories';
import { EmployeeSkillsRepository } from '../repositories/EmployeeSkillsRepository';
import { InactiveEmployeesRepository } from '../repositories/InactiveEmployeesRepository';
import ExcelJS from 'exceljs';

const router = Router();

// Default paths (can be overridden via settings)
const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';
const DEFAULT_PROJECTS_BASE_PATH = 'Projects';

// Route-level timeout for SharePoint-dependent endpoints (60 seconds)
const ROUTE_TIMEOUT_MS = 60000;

/**
 * Helper to wrap an async route handler with a timeout.
 * Returns a 504 Gateway Timeout if the handler takes too long,
 * preventing the frontend from hanging indefinitely.
 */
function withTimeout(
  handler: (req: AuthRequest, res: Response) => Promise<void>,
  timeoutMs: number = ROUTE_TIMEOUT_MS
): (req: AuthRequest, res: Response) => Promise<void> {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out. The server may be warming up — please try again.' });
      }
    }, timeoutMs);

    try {
      await handler(req, res);
    } catch (error) {
      if (!timedOut && !res.headersSent) {
        console.error('Route handler error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * GET /api/config/clients
 * Get list of clients (folder names under Projects/)
 */
router.get('/clients', authMiddleware, withTimeout(async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientsPath = await getSetting('clientsPath') || DEFAULT_PROJECTS_BASE_PATH;
    const folders = await listFilesInFolder(clientsPath);
    
    // Filter to only folders (not files)
    const clients = folders
      .filter(item => item.folder)
      .map(folder => ({
        name: folder.name,
        id: folder.id,
      }));
    
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch clients from SharePoint' });
    }
  }
}));

/**
 * GET /api/config/clients/:clientName/projects
 * Get list of projects for a client (folder names under Projects/{clientName}/)
 */
router.get('/clients/:clientName/projects', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientName } = req.params;
    const clientsPath = await getSetting('clientsPath') || DEFAULT_PROJECTS_BASE_PATH;
    const folderPath = `${clientsPath}/${clientName}`;
    
    const folders = await listFilesInFolder(folderPath);
    
    // Filter to only folders
    const projects = folders
      .filter(item => item.folder)
      .map(folder => ({
        name: folder.name,
        id: folder.id,
      }));
    
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects from SharePoint' });
  }
});

/**
 * GET /api/config/clients/:clientName/projects/:projectName/weeks
 * Get list of week folders for a project
 */
router.get('/clients/:clientName/projects/:projectName/weeks', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientName, projectName } = req.params;
    const clientsPath = await getSetting('clientsPath') || DEFAULT_PROJECTS_BASE_PATH;
    const folderPath = `${clientsPath}/${clientName}/${projectName}`;
    
    const folders = await listFilesInFolder(folderPath);
    
    // Filter to only folders
    const weeks = folders
      .filter(item => item.folder)
      .map(folder => ({
        name: folder.name,
        id: folder.id,
      }));
    
    res.json(weeks);
  } catch (error) {
    console.error('Error fetching weeks:', error);
    res.status(500).json({ error: 'Failed to fetch week folders from SharePoint' });
  }
});

/**
 * POST /api/config/clients/:clientName/projects/:projectName/weeks
 * Create a new week folder if it doesn't exist
 * Body: { weekName: "Feb 2-8" }
 */
router.post('/clients/:clientName/projects/:projectName/weeks', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientName, projectName } = req.params;
    const { weekName } = req.body;
    
    if (!weekName) {
      res.status(400).json({ error: 'weekName is required' });
      return;
    }
    
    // Get the configured path
    const clientsPath = await getSetting('clientsPath') || DEFAULT_PROJECTS_BASE_PATH;
    
    // Get or create the project folder first
    const projectsFolder = await getOrCreateFolder('root', clientsPath);
    const clientFolder = await getOrCreateFolder(projectsFolder.folderId, clientName);
    const projectFolder = await getOrCreateFolder(clientFolder.folderId, projectName);
    
    // Create the week folder
    const weekFolder = await getOrCreateFolder(projectFolder.folderId, weekName);
    
    res.json({
      message: 'Week folder ready',
      folder: {
        name: weekName,
        id: weekFolder.folderId,
        webUrl: weekFolder.webUrl,
      },
    });
  } catch (error) {
    console.error('Error creating week folder:', error);
    res.status(500).json({ error: 'Failed to create week folder in SharePoint' });
  }
});

/**
 * Helper: Get the current week's folder name (Mon-Sun format)
 * e.g., "Feb 2-8" or "Jan 27-Feb 2"
 */
function getCurrentWeekName(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  
  // Calculate Monday of current week (Sunday = 0, so adjust)
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  
  // Calculate Sunday
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const monMonth = months[monday.getMonth()];
  const sunMonth = months[sunday.getMonth()];
  
  if (monMonth === sunMonth) {
    // Same month: "Feb 2-8"
    return `${monMonth} ${monday.getDate()}-${sunday.getDate()}`;
  } else {
    // Different months: "Jan 27-Feb 2"
    return `${monMonth} ${monday.getDate()}-${sunMonth} ${sunday.getDate()}`;
  }
}

/**
 * GET /api/config/current-week
 * Get the current week folder name
 */
router.get('/current-week', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const weekName = getCurrentWeekName();
    res.json({ weekName });
  } catch (error) {
    console.error('Error getting current week:', error);
    res.status(500).json({ error: 'Failed to calculate current week' });
  }
});

/**
 * GET /api/config/site-employees
 * Get list of employees from SharePoint config folder (GLOBAL - same for all clients)
 * Filters out inactive employees from the list
 * Reads from configurable path (default: Umbrella Report Config/site_employees.xlsx)
 */
router.get('/site-employees', authMiddleware, withTimeout(async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get config folder path - employees are GLOBAL (not client-specific)
    const configFolder = await getSetting('employeesPath') || DEFAULT_CONFIG_BASE_PATH;
    
    // List files in the folder
    const files = await listFilesInFolder(configFolder);
    console.log(`Looking for employee data in: ${configFolder}`);
    console.log(`Files found:`, files.map(f => f.name));
    
    // Get inactive employee names for filtering
    const inactiveNames = await InactiveEmployeesRepository.getInactiveNames();
    
    // Helper function to filter active employees
    const filterActive = (employees: { name: string; id?: string }[]) => {
      return employees.filter(emp => !inactiveNames.includes(emp.name.toLowerCase()));
    };
    
    // Look for site_employees JSON file first
    const jsonFile = files.find(f => f.name.toLowerCase().includes('site_employees') && f.name.endsWith('.json'));
    
    if (jsonFile) {
      // Read and return the JSON content
      const employees = await readJsonFileByPath(`${configFolder}/${jsonFile.name}`);
      res.json(filterActive(employees));
      return;
    }
    
    // Look for site_employees Excel file (.xlsx or .xls)
    const excelFile = files.find(f => f.name.toLowerCase().includes('site_employees') && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')));
    if (excelFile) {
      console.log(`Reading Excel file: ${excelFile.name}`);
      const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      
      // Read column A starting from row 2
      const employees: { name: string; id: string }[] = [];
      let rowIndex = 2; // Start from row 2 (A2)
      
      while (true) {
        const cell = worksheet.getCell(`A${rowIndex}`);
        
        if (!cell.value) {
          break; // Stop when we hit an empty cell
        }
        
        const name = String(cell.value).trim();
        if (name) {
          employees.push({
            name,
            id: String(rowIndex - 1), // ID based on row number
          });
        }
        rowIndex++;
      }
      
      console.log(`Loaded ${employees.length} employees from Excel file: ${excelFile.name}`);
      res.json(filterActive(employees));
      return;
    }
    
    // If no Excel or JSON file, look for site_employees CSV
    const csvFile = files.find(f => f.name.toLowerCase().includes('site_employees') && f.name.endsWith('.csv'));
    if (csvFile) {
      const buffer = await readFileByPath(`${configFolder}/${csvFile.name}`);
      const content = buffer.toString('utf-8');
      
      // Parse CSV - simple parsing (name per line or comma-separated)
      const lines = content.split('\n').filter(line => line.trim());
      
      // Check if it's a simple list or has headers
      const firstLine = lines[0];
      let employees: { name: string; id?: string }[] = [];
      
      if (firstLine.includes(',')) {
        // Has columns - assume first row is headers
        const headers = firstLine.split(',').map(h => h.trim().toLowerCase());
        const nameIndex = headers.findIndex(h => h === 'name' || h === 'employee');
        const idIndex = headers.findIndex(h => h === 'id' || h === 'employee_id');
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values[nameIndex !== -1 ? nameIndex : 0]) {
            employees.push({
              name: values[nameIndex !== -1 ? nameIndex : 0],
              id: idIndex !== -1 ? values[idIndex] : undefined,
            });
          }
        }
      } else {
        // Simple list - one name per line
        employees = lines.map((name, index) => ({ 
          name: name.trim(),
          id: String(index + 1),
        }));
      }
      
      res.json(filterActive(employees));
      return;
    }
    
    // No data file found
    console.log(`No site_employees file found in: ${configFolder}`);
    res.json([]);
  } catch (error) {
    console.error('Error fetching site employees:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch site employees from SharePoint' });
    }
  }
}));

/**
 * GET /api/config/site-employees-all
 * Get ALL employees including inactive (for admin management page)
 */
router.get('/site-employees-all', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const configFolder = await getSetting('employeesPath') || DEFAULT_CONFIG_BASE_PATH;
    const files = await listFilesInFolder(configFolder);
    
    // Look for site_employees Excel file
    const excelFile = files.find(f => f.name.toLowerCase().includes('site_employees') && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')));
    if (excelFile) {
      const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      
      const employees: { name: string; id: string }[] = [];
      let rowIndex = 2;
      
      while (true) {
        const cell = worksheet.getCell(`A${rowIndex}`);
        if (!cell.value) break;
        
        const name = String(cell.value).trim();
        if (name) {
          employees.push({ name, id: String(rowIndex - 1) });
        }
        rowIndex++;
      }
      
      res.json(employees);
      return;
    }
    
    res.json([]);
  } catch (error) {
    console.error('Error fetching all site employees:', error);
    res.status(500).json({ error: 'Failed to fetch site employees' });
  }
});

/**
 * GET /api/config/equipment
 * Get list of equipment from SharePoint config folder
 * Query params: ?client=RTA (optional, for client-specific config)
 * Reads from configurable path (default: Umbrella Report Config/equipment/)
 * If client is specified, looks in Umbrella Report Config/{client}/equipment
 */
router.get('/equipment', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { client } = req.query;
    
    // Get config folder path (all config files are in same folder)
    let configFolder = await getSetting('equipmentPath') || DEFAULT_CONFIG_BASE_PATH;
    
    // If client is specified, use client-specific subfolder
    if (client) {
      configFolder = `${DEFAULT_CONFIG_BASE_PATH}/${client}`;
    }
    
    const files = await listFilesInFolder(configFolder);
    console.log(`Looking for equipment data in: ${configFolder}`);
    
    // Look for equipment JSON file
    const jsonFile = files.find(f => f.name.toLowerCase().includes('equipment') && f.name.endsWith('.json'));
    if (jsonFile) {
      const equipment = await readJsonFileByPath(`${configFolder}/${jsonFile.name}`);
      res.json(equipment);
      return;
    }
    
    // Look for equipment Excel file (including equipment_rates.xlsx)
    const excelFile = files.find(f => 
      (f.name.toLowerCase().includes('equipment') || f.name.toLowerCase().includes('equipment_rates')) && 
      (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
    );
    if (excelFile) {
      console.log(`Reading equipment Excel file: ${excelFile.name}`);
      const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      
      // Read column A starting from row 2 (skip header)
      const equipment: { name: string; id: string }[] = [];
      let rowIndex = 2;
      
      while (true) {
        const cell = worksheet.getCell(`A${rowIndex}`);
        
        if (!cell.value) {
          break;
        }
        
        const name = String(cell.value).trim();
        if (name) {
          equipment.push({
            name,
            id: String(rowIndex - 1),
          });
        }
        rowIndex++;
      }
      
      console.log(`Loaded ${equipment.length} equipment items from Excel file: ${excelFile.name}`);
      res.json(equipment);
      return;
    }
    
    // Look for equipment CSV file
    const csvFile = files.find(f => f.name.toLowerCase().includes('equipment') && f.name.endsWith('.csv'));
    if (csvFile) {
      const buffer = await readFileByPath(`${configFolder}/${csvFile.name}`);
      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const equipment = lines.map((name, index) => ({
        name: name.trim(),
        id: String(index + 1),
      }));
      
      res.json(equipment);
      return;
    }
    
    console.log(`No equipment file found in: ${configFolder}`);
    res.json([]);
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Failed to fetch equipment from SharePoint' });
  }
});

/**
 * GET /api/config/list/:folderName
 * Generic endpoint to list config data from any config subfolder
 */
router.get('/list/:folderName', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderName } = req.params;
    const folderPath = `${DEFAULT_CONFIG_BASE_PATH}/${folderName}`;
    
    const files = await listFilesInFolder(folderPath);
    
    // Try JSON first
    const jsonFile = files.find(f => f.name.endsWith('.json'));
    if (jsonFile) {
      const data = await readJsonFileByPath(`${folderPath}/${jsonFile.name}`);
      res.json(data);
      return;
    }
    
    // Try CSV
    const csvFile = files.find(f => f.name.endsWith('.csv'));
    if (csvFile) {
      const buffer = await readFileByPath(`${folderPath}/${csvFile.name}`);
      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Simple list parsing
      const items = lines.map((line, index) => {
        if (line.includes(',')) {
          const parts = line.split(',').map(p => p.trim());
          return { name: parts[0], id: parts[1] || String(index + 1) };
        }
        return { name: line.trim(), id: String(index + 1) };
      });
      
      res.json(items);
      return;
    }
    
    // Return list of files in folder (as fallback)
    res.json(files.map(f => ({ name: f.name, id: f.id })));
  } catch (error) {
    console.error(`Error fetching config from ${req.params.folderName}:`, error);
    res.status(500).json({ error: 'Failed to fetch config data from SharePoint' });
  }
});

/**
 * GET /api/config/equipment-rates
 * Get list of equipment with rates from client's equipment_rates.xlsx
 * Query params: ?client=RTA (required for client-specific equipment)
 */
router.get('/equipment-rates', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { client } = req.query;
    
    if (!client) {
      res.status(400).json({ error: 'client parameter is required' });
      return;
    }
    
    const configFolder = `${DEFAULT_CONFIG_BASE_PATH}/${client}`;
    const files = await listFilesInFolder(configFolder);
    console.log(`Looking for equipment_rates in: ${configFolder}`);
    
    // Look for equipment_rates Excel file
    const excelFile = files.find(f => 
      f.name.toLowerCase().includes('equipment') && 
      f.name.toLowerCase().includes('rate') &&
      (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
    );
    
    if (!excelFile) {
      console.log(`No equipment_rates file found in: ${configFolder}`);
      res.json({ data: [] });
      return;
    }
    
    console.log(`Reading equipment rates file: ${excelFile.name}`);
    const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    
    // Read equipment from column A starting from row 2 (row 1 is header)
    // Same structure as skills: Name, Regular Rate, OT Rate, DT Rate
    const equipmentRates: { id: string; name: string; regularRate: number; otRate: number; dtRate: number }[] = [];
    let rowIndex = 2;
    
    while (true) {
      const nameCell = worksheet.getCell(`A${rowIndex}`);
      
      if (!nameCell.value) {
        break; // Stop when we hit an empty cell
      }
      
      const name = String(nameCell.value).trim();
      if (name) {
        // Parse rates from columns B, C, D
        const regularCell = worksheet.getCell(`B${rowIndex}`);
        const otCell = worksheet.getCell(`C${rowIndex}`);
        const dtCell = worksheet.getCell(`D${rowIndex}`);
        
        // Parse currency values (remove $ and convert to number)
        const parseRate = (cell: ExcelJS.Cell): number => {
          if (!cell || !cell.value) return 0;
          const value = String(cell.value).replace(/[$,]/g, '');
          return parseFloat(value) || 0;
        };
        
        equipmentRates.push({
          id: String(rowIndex - 1),
          name,
          regularRate: parseRate(regularCell),
          otRate: parseRate(otCell),
          dtRate: parseRate(dtCell),
        });
      }
      rowIndex++;
    }
    
    console.log(`Loaded ${equipmentRates.length} equipment rates from: ${excelFile.name}`);
    res.json({ data: equipmentRates });
  } catch (error) {
    console.error('Error fetching equipment rates:', error);
    res.status(500).json({ error: 'Failed to fetch equipment rates from SharePoint' });
  }
});

/**
 * GET /api/config/skills
 * Get list of skills/positions from client's skills_rates.xlsx
 * Query params: ?client=RTA (required for client-specific skills)
 */
router.get('/skills', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { client } = req.query;
    
    if (!client) {
      res.status(400).json({ error: 'client parameter is required' });
      return;
    }
    
    const configFolder = `${DEFAULT_CONFIG_BASE_PATH}/${client}`;
    const files = await listFilesInFolder(configFolder);
    console.log(`Looking for skills_rates in: ${configFolder}`);
    
    // Look for skills_rates Excel file
    const excelFile = files.find(f => 
      f.name.toLowerCase().includes('skills') && 
      (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
    );
    
    if (!excelFile) {
      console.log(`No skills_rates file found in: ${configFolder}`);
      res.json({ data: [] });
      return;
    }
    
    console.log(`Reading skills file: ${excelFile.name}`);
    const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    
    // Read skills from column A starting from row 2 (row 1 is header)
    const skills: { id: string; name: string; regularRate: number; otRate: number; dtRate: number; nightDiff: number }[] = [];
    let rowIndex = 2;
    
    while (true) {
      const nameCell = worksheet.getCell(`A${rowIndex}`);
      
      if (!nameCell.value) {
        break; // Stop when we hit an empty cell
      }
      
      const name = String(nameCell.value).trim();
      if (name) {
        // Parse rates from columns B, C, D, E
        const regularCell = worksheet.getCell(`B${rowIndex}`);
        const otCell = worksheet.getCell(`C${rowIndex}`);
        const dtCell = worksheet.getCell(`D${rowIndex}`);
        const nightCell = worksheet.getCell(`E${rowIndex}`);
        
        // Parse currency values (remove $ and convert to number)
        const parseRate = (cell: ExcelJS.Cell): number => {
          if (!cell || !cell.value) return 0;
          const value = String(cell.value).replace(/[$,]/g, '');
          return parseFloat(value) || 0;
        };
        
        skills.push({
          id: String(rowIndex - 1),
          name,
          regularRate: parseRate(regularCell),
          otRate: parseRate(otCell),
          dtRate: parseRate(dtCell),
          nightDiff: parseRate(nightCell),
        });
      }
      rowIndex++;
    }
    
    console.log(`Loaded ${skills.length} skills from: ${excelFile.name}`);
    res.json({ data: skills });
  } catch (error) {
    console.error('Error fetching skills:', error);
    res.status(500).json({ error: 'Failed to fetch skills from SharePoint' });
  }
});

/**
 * GET /api/config/employee-skills/:employeeName
 * Get allowed skills for an employee (for supervisors filling out forms)
 * Query params: ?client=RTA (required)
 * Returns: all skills if no skills configured, or just the allowed skills
 */
router.get('/employee-skills/:employeeName', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName } = req.params;
    const { client } = req.query;
    
    if (!client) {
      res.status(400).json({ error: 'client parameter is required' });
      return;
    }
    
    const allowedSkills = await EmployeeSkillsRepository.getSkillsForEmployee(
      employeeName,
      client as string
    );
    
    // If no skills configured, return empty (frontend will show all skills)
    // If skills configured, return only those
    res.json({ data: allowedSkills });
  } catch (error) {
    console.error('Error fetching employee allowed skills:', error);
    res.status(500).json({ error: 'Failed to fetch employee skills' });
  }
});

/**
 * POST /api/config/calculate-hours
 * Calculate RG/OT/DT breakdown based on total hours and context
 * Loads client-specific OT rules from SharePoint Excel
 * Body: { totalHours, date, employeeName, clientName }
 */
router.post('/calculate-hours', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { totalHours, date, employeeName, clientName } = req.body;
    
    if (totalHours === undefined || !date) {
      res.status(400).json({ error: 'totalHours and date are required' });
      return;
    }
    
    // Load client-specific OT rules from SharePoint Excel
    const rules = await getClientRules(clientName, async (path: string) => {
      try {
        return await readFileByPath(path);
      } catch {
        return null;
      }
    });
    
    const reportDate = new Date(date);
    const isStatDay = isStatHoliday(reportDate, rules);
    
    // Get employee's weekly regular hours (for weekend calculations)
    let weeklyRegularHours = 0;
    
    if (employeeName) {
      // Get the week boundaries (Monday to Sunday)
      const weekStart = getWeekStart(reportDate);
      const weekEnd = getWeekEnd(reportDate);
      
      console.log(`Looking up weekly hours for ${employeeName} from ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);
      
      // Query reports for this week (up to but not including current date)
      const dayBefore = new Date(reportDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      
      const reports = await DailyReportRepository.findByDateRange(
        weekStart,
        dayBefore
      );
      
      // Sum regular hours for this employee from all reports this week
      for (const report of reports) {
        const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
        for (const line of laborLines) {
          if (line.employeeName?.toLowerCase() === employeeName.toLowerCase()) {
            weeklyRegularHours += line.regularHours || 0;
          }
        }
      }
      
      console.log(`Employee ${employeeName} has ${weeklyRegularHours} regular hours this week so far`);
    }
    
    // Calculate the breakdown using client-specific rules
    const breakdown = calculateHoursBreakdown({
      totalHours: parseFloat(totalHours),
      date: reportDate,
      employeeWeeklyRegularHours: weeklyRegularHours,
      isStatHoliday: isStatDay
    }, rules);
    
    res.json({
      ...breakdown,
      isStatHoliday: isStatDay,
      isWeekend: reportDate.getDay() === 0 || reportDate.getDay() === 6,
      weeklyRegularHoursSoFar: weeklyRegularHours,
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][reportDate.getDay()],
      rulesSource: clientName ? `${clientName}/ot_rules.xlsx` : 'default'
    });
  } catch (error) {
    console.error('Error calculating hours:', error);
    res.status(500).json({ error: 'Failed to calculate hours breakdown' });
  }
});

/**
 * GET /api/config/stat-holidays/:year
 * Get list of stat holidays for a year
 */
router.get('/stat-holidays/:year', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const year = parseInt(req.params.year);
    const { getStatHolidayDates } = await import('../services/overtimeService');
    
    const holidays = getStatHolidayDates(year);
    const holidayList: { name: string; date: string }[] = [];
    
    for (const [name, date] of holidays) {
      holidayList.push({
        name,
        date: date.toISOString().split('T')[0]
      });
    }
    
    res.json(holidayList);
  } catch (error) {
    console.error('Error fetching stat holidays:', error);
    res.status(500).json({ error: 'Failed to fetch stat holidays' });
  }
});

export default router;
