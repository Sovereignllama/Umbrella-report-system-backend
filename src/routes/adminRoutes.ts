import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireAdmin } from '../middleware';
import {
  UserRepository,
  EmployeeRepository,
  ProjectRepository,
  ChargeOutRateRepository,
  EquipmentRepository,
  ClientRepository,
  PayPeriodRepository,
} from '../repositories';
import { EmployeeSkillsRepository } from '../repositories/EmployeeSkillsRepository';
import { InactiveEmployeesRepository } from '../repositories/InactiveEmployeesRepository';
import { createProjectFolderStructure, getOrCreateFolder } from '../services/sharepointService';
import { generateAndUploadPayrollReport } from '../services/payrollSharePointService';
import ExcelJS from 'exceljs';
import { parseDate } from '../utils/dateParser';

const router = Router();

// ============================================
// CLIENT MANAGEMENT
// ============================================

/**
 * GET /api/admin/clients
 * List all clients
 */
router.get('/clients', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clients = await ClientRepository.findAll();
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

/**
 * POST /api/admin/clients
 * Create a new client with SharePoint folder
 */
router.post('/clients', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Client name is required' });
      return;
    }

    // Check if client already exists
    const existing = await ClientRepository.findByName(name);
    if (existing) {
      res.status(409).json({ error: 'Client already exists' });
      return;
    }

    // Create folder in SharePoint under Documents/Projects/[ClientName]
    const projectsFolder = await getOrCreateFolder(':root:', 'Projects');
    const clientFolder = await getOrCreateFolder(projectsFolder.folderId, name);

    // Create client in database
    const client = await ClientRepository.create({
      name,
      sharePointFolderId: clientFolder.folderId,
    });

    res.status(201).json(client);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

/**
 * PUT /api/admin/clients/:id
 * Update a client
 */
router.put('/clients/:id', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, active } = req.body;

    const client = await ClientRepository.update(id, { name, active });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.json(client);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

/**
 * GET /api/admin/clients/:clientId/projects
 * Get projects for a specific client
 */
router.get('/clients/:clientId/projects', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;
    const projects = await ProjectRepository.findByClientId(clientId);
    res.json(projects);
  } catch (error) {
    console.error('Error fetching client projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await UserRepository.findAll();
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/admin/users/:userId/assign-role
 * Assign role to user
 */
router.post(
  '/users/:userId/assign-role',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { userId } = req.params;
      const { role } = req.body;

      if (!['admin', 'supervisor', 'boss'].includes(role)) {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }

      const updated = await UserRepository.assignRole(userId, role, req.user.id);
      if (!updated) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({
        message: `User role updated to ${role}`,
        user: updated,
      });
    } catch (error) {
      console.error('Error assigning role:', error);
      res.status(500).json({ error: 'Failed to assign role' });
    }
  }
);

/**
 * POST /api/admin/users/:userId/deactivate
 * Deactivate user
 */
router.post(
  '/users/:userId/deactivate',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const success = await UserRepository.deactivate(userId);

      if (!success) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ message: 'User deactivated' });
    } catch (error) {
      console.error('Error deactivating user:', error);
      res.status(500).json({ error: 'Failed to deactivate user' });
    }
  }
);

/**
 * POST /api/admin/users/:userId/activate
 * Activate user
 */
router.post(
  '/users/:userId/activate',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const success = await UserRepository.activate(userId);

      if (!success) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ message: 'User activated' });
    } catch (error) {
      console.error('Error activating user:', error);
      res.status(500).json({ error: 'Failed to activate user' });
    }
  }
);

// ============================================
// PROJECTS
// ============================================

/**
 * POST /api/admin/projects
 * Create new project
 */
router.post(
  '/projects',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Project name is required' });
        return;
      }

      // Create SharePoint folder structure
      const { projectFolderId, projectWebUrl } = await createProjectFolderStructure(
        name
      );

      // Create project in database
      const project = await ProjectRepository.create({
        name,
        sharepoint_folder_id: projectFolderId,
        sharepoint_web_url: projectWebUrl,
      });

      res.status(201).json({
        message: 'Project created',
        project,
      });
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

/**
 * GET /api/admin/projects
 * List all projects
 */
router.get('/projects', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projects = await ProjectRepository.findAll(false);
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ============================================
// EMPLOYEES
// ============================================

/**
 * POST /api/admin/employees/import
 * Bulk import employees (e.g., from QuickBooks)
 */
router.post(
  '/employees/import',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { employees } = req.body;

      if (!Array.isArray(employees) || employees.length === 0) {
        res.status(400).json({ error: 'employees array is required' });
        return;
      }

      // Check for existing QBIDs
      const imported = [];
      for (const emp of employees) {
        const existing = emp.qb_id
          ? await EmployeeRepository.findByQbId(emp.qb_id)
          : null;

        if (!existing) {
          const created = await EmployeeRepository.create({
            name: emp.name,
            qb_id: emp.qb_id,
            skill_level: emp.skill_level || 'Regular',
          });
          imported.push(created);
        }
      }

      res.json({
        message: `${imported.length} employees imported`,
        employees: imported,
      });
    } catch (error) {
      console.error('Error importing employees:', error);
      res.status(500).json({ error: 'Failed to import employees' });
    }
  }
);

/**
 * GET /api/admin/employees
 * List all employees
 */
router.get('/employees', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const employees = await EmployeeRepository.findAll(false);
    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// ============================================
// RATES
// ============================================

/**
 * POST /api/admin/rates
 * Create charge-out rate
 */
router.post(
  '/rates',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { skill_level, regular_rate, ot_rate, dt_rate } = req.body;

      if (!skill_level || !regular_rate || !ot_rate || !dt_rate) {
        res.status(400).json({ error: 'All rate fields are required' });
        return;
      }

      const rate = await ChargeOutRateRepository.create({
        skill_level,
        regular_rate,
        ot_rate,
        dt_rate,
      });

      res.status(201).json({
        message: 'Rate created',
        rate,
      });
    } catch (error) {
      console.error('Error creating rate:', error);
      res.status(500).json({ error: 'Failed to create rate' });
    }
  }
);

/**
 * GET /api/admin/rates
 * List all rates
 */
router.get('/rates', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rates = await ChargeOutRateRepository.findAll();
    res.json(rates);
  } catch (error) {
    console.error('Error fetching rates:', error);
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// ============================================
// EQUIPMENT
// ============================================

/**
 * POST /api/admin/equipment
 * Create equipment
 */
router.post(
  '/equipment',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Equipment name is required' });
        return;
      }

      const equipment = await EquipmentRepository.create(name);

      res.status(201).json({
        message: 'Equipment created',
        equipment,
      });
    } catch (error) {
      console.error('Error creating equipment:', error);
      res.status(500).json({ error: 'Failed to create equipment' });
    }
  }
);

/**
 * GET /api/admin/equipment
 * List all equipment
 */
router.get('/equipment', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const equipment = await EquipmentRepository.findAll(false);
    res.json(equipment);
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ error: 'Failed to fetch equipment' });
  }
});

// ============================================
// PAY PERIOD MANAGEMENT
// ============================================

/**
 * GET /api/admin/pay-periods/:year
 * Get all pay periods for a year
 */
router.get('/pay-periods/:year', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const year = parseInt(req.params.year);
    if (isNaN(year)) {
      res.status(400).json({ error: 'Invalid year' });
      return;
    }
    const periods = await PayPeriodRepository.findByYear(year);
    res.json(periods);
  } catch (error) {
    console.error('Error fetching pay periods:', error);
    res.status(500).json({ error: 'Failed to fetch pay periods' });
  }
});

/**
 * POST /api/admin/pay-periods/import
 * Import pay periods from Excel file (base64 encoded)
 * Expected Excel columns: Year, Period Number, Start Date, End Date
 */
router.post('/pay-periods/import', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fileBase64 } = req.body;

    if (!fileBase64) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    // Parse Excel file
    const buffer = Buffer.from(fileBase64, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      res.status(400).json({ error: 'No worksheet found in file' });
      return;
    }

    const periods: Array<{
      year: number;
      periodNumber: number;
      startDate: Date;
      endDate: Date;
    }> = [];

    // Skip header rows, process data rows
    // Support two layouts:
    // Layout 1 (original): Row 1 = header, Col A = Year, Col B = Period, Col C = Start Date, Col D = End Date
    // Layout 2 (payroll_calender.xlsx): Row 2 has year in title, data rows 5-30, Col B = Period, Col C = Start Date, Col D = End Date
    
    // Detect layout by checking if row 2 has a title with a year
    let titleYear: number | null = null;
    const titleRow = sheet.getRow(2);
    for (let col = 1; col <= 5; col++) {
      const cellVal = titleRow.getCell(col).value;
      if (cellVal) {
        const match = String(cellVal).match(/(\d{4})/);
        if (match) {
          titleYear = parseInt(match[1]);
          break;
        }
      }
    }

    const isPayrollCalendarLayout = titleYear !== null;

    sheet.eachRow((row, rowNumber) => {
      if (isPayrollCalendarLayout) {
        // Layout 2: skip rows before data (rows 1-4), data starts at row 5
        if (rowNumber < 5) return;

        const periodVal = row.getCell(2).value; // Column B
        const startDateVal = row.getCell(3).value; // Column C
        const endDateVal = row.getCell(4).value; // Column D

        if (!periodVal || !startDateVal || !endDateVal) return;

        const periodNumber = typeof periodVal === 'number'
          ? periodVal
          : parseInt(String(periodVal));

        const startDate = parseDate(startDateVal);
        const endDate = parseDate(endDateVal);
        
        if (!startDate || !endDate) {
          console.log(`Row ${rowNumber}: Could not parse dates. start=${JSON.stringify(startDateVal)}, end=${JSON.stringify(endDateVal)}`);
          return;
        }

        const year = titleYear || endDate.getFullYear();

        if (!isNaN(year) && !isNaN(periodNumber)) {
          periods.push({ year, periodNumber, startDate, endDate });
        }
      } else {
        // Layout 1: skip header row, Col A = Year, Col B = Period, Col C = Start, Col D = End
        if (rowNumber === 1) return;

        const yearVal = row.getCell(1).value;
        const periodVal = row.getCell(2).value;
        const startDateVal = row.getCell(3).value;
        const endDateVal = row.getCell(4).value;

        const year = typeof yearVal === 'number' 
          ? yearVal 
          : parseInt(String(yearVal));
      
        const periodNumber = typeof periodVal === 'number'
          ? periodVal
          : parseInt(String(periodVal));

        // Parse dates (could be Date objects or strings)
        const startDate = startDateVal instanceof Date 
          ? startDateVal 
          : new Date(String(startDateVal));
      
        const endDate = endDateVal instanceof Date
          ? endDateVal
          : new Date(String(endDateVal));

        if (!isNaN(year) && !isNaN(periodNumber) && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          periods.push({ year, periodNumber, startDate, endDate });
        }
      }
    });

    if (periods.length === 0) {
      res.status(400).json({ error: 'No valid pay periods found in file' });
      return;
    }

    // Bulk insert/update
    const count = await PayPeriodRepository.bulkCreate(periods);

    res.json({
      message: `Successfully imported ${count} pay periods`,
      count,
    });
  } catch (error) {
    console.error('Error importing pay periods:', error);
    res.status(500).json({ error: 'Failed to import pay periods' });
  }
});

/**
 * POST /api/admin/pay-periods/:id/generate-report
 * Manually trigger payroll report generation for a specific period
 */
router.post('/pay-periods/:id/generate-report', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const period = await PayPeriodRepository.findById(id);
    if (!period) {
      res.status(404).json({ error: 'Pay period not found' });
      return;
    }

    const webUrl = await generateAndUploadPayrollReport(period);

    res.json({
      message: 'Payroll report generated successfully',
      webUrl,
    });
  } catch (error) {
    console.error('Error generating payroll report:', error);
    res.status(500).json({ error: 'Failed to generate payroll report' });
  }
});

/**
 * DELETE /api/admin/pay-periods/:year
 * Delete all pay periods for a year (for re-importing)
 */
router.delete('/pay-periods/:year', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const year = parseInt(req.params.year);
    if (isNaN(year)) {
      res.status(400).json({ error: 'Invalid year' });
      return;
    }

    const count = await PayPeriodRepository.deleteByYear(year);
    res.json({ message: `Deleted ${count} pay periods for ${year}` });
  } catch (error) {
    console.error('Error deleting pay periods:', error);
    res.status(500).json({ error: 'Failed to delete pay periods' });
  }
});

// ============================================
// EMPLOYEE SKILLS MANAGEMENT
// ============================================

/**
 * GET /api/admin/employee-skills
 * Get all employee skill assignments grouped by employee
 * Query params: ?client=RTA (optional, filter by client)
 */
router.get('/employee-skills', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { client } = req.query;
    
    let skills;
    if (client) {
      skills = await EmployeeSkillsRepository.getAllForClient(client as string);
    } else {
      skills = await EmployeeSkillsRepository.getAll();
    }
    
    // Group by employee for easier frontend consumption
    const employeeMap = new Map<string, { employeeName: string; clientName: string; skills: string[] }>();
    
    for (const skill of skills) {
      const key = `${skill.employeeName}|${skill.clientName}`;
      if (!employeeMap.has(key)) {
        employeeMap.set(key, {
          employeeName: skill.employeeName,
          clientName: skill.clientName,
          skills: []
        });
      }
      employeeMap.get(key)!.skills.push(skill.skillName);
    }
    
    res.json({ data: Array.from(employeeMap.values()) });
  } catch (error) {
    console.error('Error fetching employee skills:', error);
    res.status(500).json({ error: 'Failed to fetch employee skills' });
  }
});

/**
 * GET /api/admin/employee-skills/:employeeName
 * Get skills for a specific employee
 * Query params: ?client=RTA (required)
 */
router.get('/employee-skills/:employeeName', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName } = req.params;
    const { client } = req.query;
    
    if (!client) {
      res.status(400).json({ error: 'client parameter is required' });
      return;
    }
    
    const skills = await EmployeeSkillsRepository.getSkillsForEmployee(
      employeeName,
      client as string
    );
    
    res.json(skills);
  } catch (error) {
    console.error('Error fetching employee skills:', error);
    res.status(500).json({ error: 'Failed to fetch employee skills' });
  }
});

/**
 * PUT /api/admin/employee-skills/:employeeName
 * Set all skills for an employee (replaces existing)
 * Body: { client: string, skills: string[] }
 */
router.put('/employee-skills/:employeeName', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName } = req.params;
    const { client, skills } = req.body;
    
    if (!client) {
      res.status(400).json({ error: 'client is required' });
      return;
    }
    
    if (!Array.isArray(skills)) {
      res.status(400).json({ error: 'skills must be an array' });
      return;
    }
    
    await EmployeeSkillsRepository.setSkillsForEmployee(
      employeeName,
      client,
      skills,
      req.user?.email || 'admin'
    );
    
    res.json({ success: true, message: `Skills updated for ${employeeName}` });
  } catch (error) {
    console.error('Error updating employee skills:', error);
    res.status(500).json({ error: 'Failed to update employee skills' });
  }
});

/**
 * POST /api/admin/employee-skills
 * Add a single skill to an employee
 * Body: { employeeName: string, skillName: string, client: string }
 */
router.post('/employee-skills', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName, skillName, client } = req.body;
    
    if (!employeeName || !skillName || !client) {
      res.status(400).json({ error: 'employeeName, skillName, and client are required' });
      return;
    }
    
    const skill = await EmployeeSkillsRepository.addSkill(
      employeeName,
      skillName,
      client,
      req.user?.email || 'admin'
    );
    
    res.status(201).json(skill);
  } catch (error) {
    console.error('Error adding employee skill:', error);
    res.status(500).json({ error: 'Failed to add employee skill' });
  }
});

/**
 * DELETE /api/admin/employee-skills
 * Remove a skill from an employee
 * Query params: ?employeeName=John&skillName=Welder&client=RTA
 */
router.delete('/employee-skills', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName, skillName, client } = req.query;
    
    if (!employeeName || !skillName || !client) {
      res.status(400).json({ error: 'employeeName, skillName, and client are required' });
      return;
    }
    
    const removed = await EmployeeSkillsRepository.removeSkill(
      employeeName as string,
      skillName as string,
      client as string
    );
    
    if (removed) {
      res.json({ success: true, message: 'Skill removed' });
    } else {
      res.status(404).json({ error: 'Skill assignment not found' });
    }
  } catch (error) {
    console.error('Error removing employee skill:', error);
    res.status(500).json({ error: 'Failed to remove employee skill' });
  }
});

// ============================================
// INACTIVE EMPLOYEES MANAGEMENT
// ============================================

/**
 * GET /api/admin/inactive-employees
 * Get list of all inactive employees
 */
router.get('/inactive-employees', authMiddleware, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const inactive = await InactiveEmployeesRepository.getAll();
    res.json({ data: inactive });
  } catch (error) {
    console.error('Error fetching inactive employees:', error);
    res.status(500).json({ error: 'Failed to fetch inactive employees' });
  }
});

/**
 * POST /api/admin/inactive-employees
 * Set an employee as inactive
 */
router.post('/inactive-employees', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName } = req.body;
    
    if (!employeeName) {
      res.status(400).json({ error: 'employeeName is required' });
      return;
    }
    
    await InactiveEmployeesRepository.setInactive(employeeName, req.user?.id || '');
    res.json({ success: true, message: `${employeeName} marked as inactive` });
  } catch (error) {
    console.error('Error setting employee inactive:', error);
    res.status(500).json({ error: 'Failed to set employee as inactive' });
  }
});

/**
 * DELETE /api/admin/inactive-employees/:employeeName
 * Set an employee as active (remove from inactive list)
 */
router.delete('/inactive-employees/:employeeName', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { employeeName } = req.params;
    
    const removed = await InactiveEmployeesRepository.setActive(employeeName);
    
    if (removed) {
      res.json({ success: true, message: `${employeeName} marked as active` });
    } else {
      res.status(404).json({ error: 'Employee not found in inactive list' });
    }
  } catch (error) {
    console.error('Error setting employee active:', error);
    res.status(500).json({ error: 'Failed to set employee as active' });
  }
});

export default router;
