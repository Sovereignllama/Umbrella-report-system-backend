import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireSupervisorOrBoss } from '../middleware';
import { TimeEntryRepository, PayPeriodRepository } from '../repositories';
import { listFilesInFolder, readFileByPath } from '../services/sharepointService';
import { getSetting } from './settingsRoutes';
import ExcelJS from 'exceljs';
import { parseDate } from '../utils/dateParser';
import { parseCSV, getCSVCell } from '../utils/csvParser';

const router = Router();

const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';

// Month abbreviations for date formatting
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Get the current date/time in Vancouver timezone (America/Vancouver, Pacific Time)
 */
function getVancouverDate(): Date {
  // Create a date string in Vancouver timezone
  const vancouverDateString = new Date().toLocaleString('en-US', { 
    timeZone: 'America/Vancouver' 
  });
  return new Date(vancouverDateString);
}

/**
 * Format a date as "Mon Day" (e.g., "Dec 13", "Jan 9").
 * Accepts both Date objects and date strings (e.g., "2026-01-03" from PostgreSQL).
 */
function formatMonthDay(date: Date | string): string {
  if (typeof date === 'string') {
    // For string dates from PostgreSQL DATE columns (e.g., "2026-01-03"),
    // parse the components directly to avoid timezone issues
    const parts = date.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      const month = parts[1];
      const day = parts[2];
      return `${MONTH_ABBR[month - 1]} ${day}`;
    }
    // Fallback: try parsing as Date if format is unexpected
    date = new Date(date);
  }
  
  // For Date objects, use UTC components to avoid timezone shift
  // PostgreSQL DATE values arrive as midnight UTC
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Parse payroll_calender.xlsx from SharePoint.
 * Layout: Row 2 has the year in a title like "2026 bi-weekly payroll calendar".
 * Data rows 5-30 have: col B = period number, col C = start date, col D = end date.
 */
async function loadPayPeriodsFromSharePoint(year: number): Promise<Array<{
  year: number;
  periodNumber: number;
  startDate: Date;
  endDate: Date;
}>> {
  const configFolder = await getSetting('employeesPath') || DEFAULT_CONFIG_BASE_PATH;
  const files = await listFilesInFolder(configFolder);

  // Match both "payroll_calender" (actual filename) and "payroll_calendar" (correct spelling)
  const payrollFile = files.find(
    f => (f.name.toLowerCase().includes('payroll_calender') || f.name.toLowerCase().includes('payroll_calendar'))
      && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv'))
  );

  if (!payrollFile) {
    console.log(`No payroll_calender file found in: ${configFolder}`);
    return [];
  }

  console.log(`Reading payroll calendar file: ${payrollFile.name}`);
  const buffer = await readFileByPath(`${configFolder}/${payrollFile.name}`);
  
  // Determine file type and parse accordingly
  const isCSV = payrollFile.name.endsWith('.csv');
  
  let fileYear: number | null = null;
  const periods: Array<{
    year: number;
    periodNumber: number;
    startDate: Date;
    endDate: Date;
  }> = [];

  if (isCSV) {
    // Parse CSV file
    const csvText = buffer.toString('utf-8');
    const rows = parseCSV(csvText);

    // Row 2 (index 1) contains the title with the year in column B (index 1)
    if (rows.length > 1) {
      const titleCell = getCSVCell(rows[1], 1); // Column B
      const match = titleCell.match(/(\d{4})/);
      if (match) {
        fileYear = parseInt(match[1]);
        console.log(`Extracted year from CSV title: ${fileYear}`);
      }
    }

    // Data rows 5-30 (indices 4-29): col B (index 1) = period, col C (index 2) = start, col D (index 3) = end
    for (let rowIdx = 4; rowIdx <= 29 && rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const periodVal = getCSVCell(row, 1).trim(); // Column B
      const startDateVal = getCSVCell(row, 2).trim(); // Column C
      const endDateVal = getCSVCell(row, 3).trim(); // Column D

      // Skip rows with all empty values
      if (!periodVal && !startDateVal && !endDateVal) {
        continue;
      }

      // Skip rows with incomplete data
      if (!periodVal || !startDateVal || !endDateVal) {
        console.log(`CSV row ${rowIdx + 1}: Skipping incomplete row (period=${periodVal}, start=${startDateVal ? 'present' : 'missing'}, end=${endDateVal ? 'present' : 'missing'})`);
        continue;
      }

      const periodNumber = parseInt(periodVal);
      const startDate = parseDate(startDateVal);
      const endDate = parseDate(endDateVal);

      if (!startDate || !endDate) {
        console.log(`CSV row ${rowIdx + 1}: Could not parse dates. start=${startDateVal}, end=${endDateVal}`);
        continue;
      }

      // Determine year from the file title or from the end date
      const periodYear = fileYear || endDate.getFullYear();

      if (!isNaN(periodNumber) && periodNumber > 0) {
        periods.push({ year: periodYear, periodNumber, startDate, endDate });
        console.log(`CSV row ${rowIdx + 1}: Successfully parsed period ${periodNumber} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
      } else {
        console.log(`CSV row ${rowIdx + 1}: Invalid period number: ${periodVal}`);
      }
    }
  } else {
    // Parse Excel file
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return [];
    }

    // Try to extract year from the title row (row 2, merged across columns)
    const titleRow = worksheet.getRow(2);
    for (let col = 1; col <= 5; col++) {
      let cellVal = titleRow.getCell(col).value;
      if (cellVal) {
        // Handle ExcelJS rich text objects
        if (typeof cellVal === 'object' && (cellVal as any).richText) {
          cellVal = (cellVal as any).richText.map((r: any) => r.text).join('');
        }
        const match = String(cellVal).match(/(\d{4})/);
        if (match) {
          fileYear = parseInt(match[1]);
          break;
        }
      }
    }

    // Data rows 5-30: col B = period number, col C = start date, col D = end date
    // Process all rows 5-30 without early stopping to handle merged cells and edge cases
    for (let rowNum = 5; rowNum <= 30; rowNum++) {
      const row = worksheet.getRow(rowNum);
      let periodVal = row.getCell(2).value; // Column B
      let startDateVal = row.getCell(3).value; // Column C
      let endDateVal = row.getCell(4).value; // Column D

      // Handle ExcelJS rich text objects (can occur with merged cells or formatted text)
      if (periodVal && typeof periodVal === 'object' && (periodVal as any).richText) {
        periodVal = (periodVal as any).richText.map((r: any) => r.text).join('').trim();
      }
      if (startDateVal && typeof startDateVal === 'object' && (startDateVal as any).richText) {
        startDateVal = (startDateVal as any).richText.map((r: any) => r.text).join('').trim();
      }
      if (endDateVal && typeof endDateVal === 'object' && (endDateVal as any).richText) {
        endDateVal = (endDateVal as any).richText.map((r: any) => r.text).join('').trim();
      }

      // Skip rows with all empty values (but don't break early)
      if (!periodVal && !startDateVal && !endDateVal) {
        continue;
      }

      // Skip rows with incomplete data
      if (!periodVal || !startDateVal || !endDateVal) {
        console.log(`Row ${rowNum}: Skipping incomplete row (period=${periodVal}, start=${startDateVal ? 'present' : 'missing'}, end=${endDateVal ? 'present' : 'missing'})`);
        continue;
      }

      const periodNumber = typeof periodVal === 'number'
        ? periodVal
        : parseInt(String(periodVal).trim());

      const startDate = parseDate(startDateVal);
      const endDate = parseDate(endDateVal);

      if (!startDate || !endDate) {
        console.log(`Row ${rowNum}: Could not parse dates. start=${JSON.stringify(startDateVal)}, end=${JSON.stringify(endDateVal)}`);
        continue;
      }

      // Determine year from the file title or from the end date
      const periodYear = fileYear || endDate.getFullYear();

      if (!isNaN(periodNumber) && periodNumber > 0) {
        periods.push({ year: periodYear, periodNumber, startDate, endDate });
        console.log(`Row ${rowNum}: Successfully parsed period ${periodNumber} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
      } else {
        console.log(`Row ${rowNum}: Invalid period number: ${periodVal}`);
      }
    }
  }


  console.log(`Parsed ${periods.length} pay periods from payroll calendar`);

  // If periods were found, persist them to the database for future queries
  if (periods.length > 0) {
    try {
      await PayPeriodRepository.bulkCreate(periods);
      console.log(`Auto-imported ${periods.length} pay periods from SharePoint`);
    } catch (err) {
      console.error('Failed to persist pay periods from SharePoint:', err);
    }
  }

  return periods.filter(p => p.year === year);
}

/**
 * GET /api/time/pay-periods
 * Get pay periods for the current year (or specified year)
 * Query params: year (optional, defaults to current year)
 */
router.get(
  '/pay-periods',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const yearParam = req.query.year;
      const year = yearParam ? parseInt(yearParam as string) : getVancouverDate().getFullYear();

      if (isNaN(year)) {
        res.status(400).json({ error: 'Invalid year' });
        return;
      }

      let periods = await PayPeriodRepository.findByYear(year);

      // If fewer than 26 periods in DB (incomplete or missing), try auto-loading from SharePoint
      if (periods.length < 26) {
        try {
          const loaded = await loadPayPeriodsFromSharePoint(year);
          if (loaded.length > 0) {
            // Re-fetch from DB to get full records with IDs
            periods = await PayPeriodRepository.findByYear(year);
          }
        } catch (spError) {
          console.error('Failed to auto-load pay periods from SharePoint:', spError);
        }
      }

      // Add label field to each period (e.g., "PP# 1 Dec 13 - Dec 26")
      const periodsWithLabels = periods.map(period => ({
        ...period,
        label: `PP# ${period.periodNumber} ${formatMonthDay(period.startDate)} - ${formatMonthDay(period.endDate)}`
      }));

      res.json(periodsWithLabels);
    } catch (error) {
      console.error('Error fetching pay periods:', error);
      res.status(500).json({ error: 'Failed to fetch pay periods' });
    }
  }
);

/**
 * POST /api/time/sign-in
 * Record an employee sign-in
 */
router.post(
  '/sign-in',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { employeeId, employeeName, projectId, projectName, signInTime, notes } = req.body;

      if (!employeeName) {
        res.status(400).json({ error: 'employeeName is required' });
        return;
      }

      const entry = await TimeEntryRepository.create({
        employeeId,
        employeeName,
        projectId,
        projectName,
        signInTime: signInTime ? new Date(signInTime) : new Date(),
        notes,
        recordedBy: req.user.id,
      });

      res.status(201).json(entry);
    } catch (error) {
      console.error('Error recording sign-in:', error);
      res.status(500).json({ error: 'Failed to record sign-in' });
    }
  }
);

/**
 * POST /api/time/sign-out
 * Record an employee sign-out
 */
router.post(
  '/sign-out',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { entryId, signOutTime } = req.body;

      if (!entryId) {
        res.status(400).json({ error: 'entryId is required' });
        return;
      }

      // Verify entry exists
      const existing = await TimeEntryRepository.findById(entryId);
      if (!existing) {
        res.status(404).json({ error: 'Time entry not found' });
        return;
      }

      if (existing.signOutTime) {
        res.status(400).json({ error: 'Employee has already signed out for this entry' });
        return;
      }

      const updated = await TimeEntryRepository.signOut(
        entryId,
        signOutTime ? new Date(signOutTime) : new Date()
      );

      res.json(updated);
    } catch (error) {
      console.error('Error recording sign-out:', error);
      res.status(500).json({ error: 'Failed to record sign-out' });
    }
  }
);

/**
 * GET /api/time/employees
 * Get list of employees who have time entries or labor lines in the specified date range
 * Query params: startDate, endDate
 */
router.get(
  '/employees',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      // Get all time entries in the date range
      const entries = await TimeEntryRepository.findByDateRange(
        startDate as string,
        endDate as string
      );

      // Extract unique employees from time entries
      const employeeMap = new Map<string, { name: string; id: string | null }>();
      for (const entry of entries) {
        if (!entry.employeeName) continue; // Skip entries without employee names
        const key = entry.employeeName.toLowerCase();
        if (!employeeMap.has(key)) {
          employeeMap.set(key, {
            name: entry.employeeName,
            id: entry.employeeId || null,
          });
        }
      }

      // Also get employees from report_labor_lines
      const { query } = await import('../services/database');
      const laborResult = await query<{ id: string; name: string }>(
        `SELECT DISTINCT e.id, e.name
         FROM report_labor_lines rll
         INNER JOIN daily_reports dr ON rll.report_id = dr.id
         INNER JOIN employees e ON rll.employee_id = e.id
         WHERE dr.report_date >= $1 
           AND dr.report_date <= $2
           AND dr.status = 'submitted'`,
        [startDate as string, endDate as string]
      );

      // Merge labor line employees into the map
      for (const emp of laborResult.rows) {
        const key = emp.name.toLowerCase();
        if (!employeeMap.has(key)) {
          employeeMap.set(key, {
            name: emp.name,
            id: emp.id,
          });
        }
      }

      // Convert to array and sort by name, then map to match frontend's EmployeeSummary interface
      const employees = Array.from(employeeMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(emp => ({
          employeeId: emp.id || emp.name, // Use name as fallback if no UUID
          employeeName: emp.name,
        }));

      res.json(employees);
    } catch (error) {
      console.error('Error fetching employees:', error);
      res.status(500).json({ error: 'Failed to fetch employees' });
    }
  }
);

/**
 * GET /api/time/sign-in-out
 * Get time entries (sign-in/out forms) by date range
 * Query params: startDate, endDate, employeeId (optional), projectId (optional)
 */
router.get(
  '/sign-in-out',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate, employeeId, projectId } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const entries = await TimeEntryRepository.findByDateRange(
        startDate as string,
        endDate as string,
        employeeId ? String(employeeId) : undefined,
        projectId ? String(projectId) : undefined
      );

      res.json(entries);
    } catch (error) {
      console.error('Error fetching sign-in-out forms:', error);
      res.status(500).json({ error: 'Failed to fetch sign-in-out forms' });
    }
  }
);

/**
 * GET /api/time/entries
 * Get time entries by date range
 * Query params: startDate, endDate, employeeId (optional), projectId (optional)
 */
router.get(
  '/entries',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate, employeeId, projectId } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const entries = await TimeEntryRepository.findByDateRange(
        startDate as string,
        endDate as string,
        employeeId ? String(employeeId) : undefined,
        projectId ? String(projectId) : undefined
      );

      res.json(entries);
    } catch (error) {
      console.error('Error fetching time entries:', error);
      res.status(500).json({ error: 'Failed to fetch time entries' });
    }
  }
);

/**
 * GET /api/time/entries/:employeeId
 * Get time entries for a specific employee
 * Query params: limit (optional, default 50)
 */
router.get(
  '/entries/:employeeId',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { employeeId } = req.params;
      const { limit = '50' } = req.query;

      const entries = await TimeEntryRepository.findByEmployee(
        employeeId,
        parseInt(limit as string)
      );

      res.json(entries);
    } catch (error) {
      console.error('Error fetching employee time entries:', error);
      res.status(500).json({ error: 'Failed to fetch time entries' });
    }
  }
);

/**
 * GET /api/time/open
 * Get currently open (signed-in, not signed-out) time entries
 * Query params: employeeId (optional)
 */
router.get(
  '/open',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { employeeId } = req.query;

      const entries = await TimeEntryRepository.findOpenEntries(
        employeeId as string
      );

      res.json(entries);
    } catch (error) {
      console.error('Error fetching open time entries:', error);
      res.status(500).json({ error: 'Failed to fetch open entries' });
    }
  }
);

/**
 * GET /api/time/dashboard/summary
 * Get daily time summary for dashboard
 * Query params: date (required, YYYY-MM-DD format)
 */
router.get(
  '/dashboard/summary',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { date } = req.query;

      if (!date) {
        res.status(400).json({ error: 'date parameter is required' });
        return;
      }

      const summary = await TimeEntryRepository.getDailySummary(
        date as string
      );

      // Calculate aggregates
      let totalEntries = summary.length;
      let signedOutCount = 0;
      let totalHoursWorked = 0;

      for (const entry of summary) {
        if (entry.signOutTime) {
          signedOutCount++;
          totalHoursWorked += Number(entry.totalHours) || 0;
        }
      }

      res.json({
        date,
        totalEntries,
        signedInCount: totalEntries - signedOutCount,
        signedOutCount,
        totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
        entries: summary,
      });
    } catch (error) {
      console.error('Error fetching time dashboard summary:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
  }
);

/**
 * GET /api/time/employee-hours
 * Get employee hours report for a specific employee and date range
 * Query params: employeeId (UUID), startDate, endDate, applyLunchDeduction (optional, default: true)
 */
router.get(
  '/employee-hours',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { employeeId, startDate, endDate, applyLunchDeduction } = req.query;

      if (!employeeId || !startDate || !endDate) {
        res.status(400).json({ error: 'employeeId, startDate, and endDate are required' });
        return;
      }

      // Parse applyLunchDeduction parameter (default: true)
      const shouldDeductLunch = applyLunchDeduction !== 'false';
      const LUNCH_DEDUCTION_HOURS = 0.5;

      // Import query function from database service
      const { query } = await import('../services/database');

      // Get employee name
      const employeeResult = await query<{ id: string; name: string }>(
        'SELECT id, name FROM employees WHERE id = $1',
        [employeeId as string]
      );

      if (employeeResult.rows.length === 0) {
        res.status(404).json({ error: 'Employee not found' });
        return;
      }

      const employee = employeeResult.rows[0];

      // Query labor lines joined with daily reports and projects
      const laborResult = await query<{
        report_date: string;
        project_id: string | null;
        project_name: string | null;
        regular_hours: number;
        ot_hours: number;
        dt_hours: number;
        start_time: string | null;
        end_time: string | null;
      }>(
        `SELECT 
          dr.report_date,
          dr.project_id,
          p.name as project_name,
          rll.regular_hours,
          rll.ot_hours,
          rll.dt_hours,
          rll.start_time,
          rll.end_time
         FROM report_labor_lines rll
         INNER JOIN daily_reports dr ON rll.report_id = dr.id
         LEFT JOIN projects p ON dr.project_id = p.id
         WHERE rll.employee_id = $1 
           AND dr.report_date >= $2 
           AND dr.report_date <= $3
           AND dr.status = 'submitted'
         ORDER BY dr.report_date, rll.start_time NULLS LAST, p.name`,
        [employeeId as string, startDate as string, endDate as string]
      );

      // Group results by date, then by project
      interface ProjectData {
        projectId: string | null;
        projectName: string | null;
        startTime: string | null;
        endTime: string | null;
        totalHours: number;
      }

      interface DateData {
        date: string;
        projects: ProjectData[];
        dailyTotalHours: number;
      }

      const dateMap = new Map<string, DateData>();

      for (const row of laborResult.rows) {
        const dateKey = row.report_date;
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, {
            date: dateKey,
            projects: [],
            dailyTotalHours: 0,
          });
        }

        const dateData = dateMap.get(dateKey)!;
        const totalHours = (row.regular_hours || 0) + (row.ot_hours || 0) + (row.dt_hours || 0);

        // Check if project already exists for this date
        const existingProject = dateData.projects.find(
          p => p.projectId === row.project_id
        );

        if (existingProject) {
          existingProject.totalHours += totalHours;
          // Update time range if needed (use earliest start, latest end)
          // PostgreSQL TIME values are returned as 'HH:MM:SS' strings which compare correctly lexicographically
          // Note: This assumes times are within the same calendar day (no midnight crossings)
          // which is valid since we group by report_date
          if (row.start_time && (!existingProject.startTime || row.start_time < existingProject.startTime)) {
            existingProject.startTime = row.start_time;
          }
          if (row.end_time && (!existingProject.endTime || row.end_time > existingProject.endTime)) {
            existingProject.endTime = row.end_time;
          }
        } else {
          dateData.projects.push({
            projectId: row.project_id,
            projectName: row.project_name,
            startTime: row.start_time,
            endTime: row.end_time,
            totalHours,
          });
        }

        dateData.dailyTotalHours += totalHours;
      }

      // Convert map to array and sort by date
      const dates = Array.from(dateMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      // Apply lunch deduction per day if enabled
      // Only deduct lunch if employee worked at least 4 hours (half day minimum)
      // Note: The deduction is applied to daily totals, not per-project hours
      // This means project hours show raw work time, while daily totals reflect billable/payable hours
      const MIN_HOURS_FOR_LUNCH_DEDUCTION = 4;
      if (shouldDeductLunch) {
        for (const dateData of dates) {
          if (dateData.dailyTotalHours >= MIN_HOURS_FOR_LUNCH_DEDUCTION) {
            dateData.dailyTotalHours = Math.max(0, dateData.dailyTotalHours - LUNCH_DEDUCTION_HOURS);
          }
        }
      }

      // Calculate grand total
      const grandTotalHours = dates.reduce(
        (sum, date) => sum + date.dailyTotalHours,
        0
      );

      res.json({
        employeeId: employee.id,
        employeeName: employee.name,
        periodStart: startDate,
        periodEnd: endDate,
        dates,
        grandTotalHours: Math.round(grandTotalHours * 100) / 100,
        lunchDeducted: shouldDeductLunch,
      });
    } catch (error) {
      console.error('Error fetching employee hours:', error);
      res.status(500).json({ error: 'Failed to fetch employee hours' });
    }
  }
);

/**
 * GET /api/time/period-summary
 * Get aggregated summary of all hours for a pay period across all employees and projects
 * Query params: startDate, endDate
 */
router.get(
  '/period-summary',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      // Import query function from database service
      const { query } = await import('../services/database');

      // Query aggregated data by project
      const projectResult = await query<{
        project_id: string | null;
        project_name: string | null;
        total_regular_hours: number;
        total_ot_hours: number;
        total_dt_hours: number;
      }>(
        `SELECT 
          dr.project_id,
          p.name as project_name,
          SUM(rll.regular_hours) as total_regular_hours,
          SUM(rll.ot_hours) as total_ot_hours,
          SUM(rll.dt_hours) as total_dt_hours
         FROM report_labor_lines rll
         INNER JOIN daily_reports dr ON rll.report_id = dr.id
         LEFT JOIN projects p ON dr.project_id = p.id
         WHERE dr.report_date >= $1 
           AND dr.report_date <= $2
           AND dr.status = 'submitted'
         GROUP BY dr.project_id, p.name
         ORDER BY p.name`,
        [startDate as string, endDate as string]
      );

      // For each project, get the list of employees who worked on it
      const projects = [];
      let totalRegularHours = 0;
      let totalOtHours = 0;
      let totalDtHours = 0;
      const employeeSet = new Set<string>();

      for (const projectRow of projectResult.rows) {
        // Get employees for this project
        let employeeQuery: string;
        let employeeParams: (string | null)[];

        if (projectRow.project_id) {
          employeeQuery = `SELECT 
            e.id as employee_id,
            e.name as employee_name,
            SUM(rll.regular_hours + rll.ot_hours + rll.dt_hours) as total_hours
           FROM report_labor_lines rll
           INNER JOIN daily_reports dr ON rll.report_id = dr.id
           INNER JOIN employees e ON rll.employee_id = e.id
           WHERE dr.project_id = $1
             AND dr.report_date >= $2 
             AND dr.report_date <= $3
             AND dr.status = 'submitted'
           GROUP BY e.id, e.name
           ORDER BY e.name`;
          employeeParams = [projectRow.project_id, startDate as string, endDate as string];
        } else {
          employeeQuery = `SELECT 
            e.id as employee_id,
            e.name as employee_name,
            SUM(rll.regular_hours + rll.ot_hours + rll.dt_hours) as total_hours
           FROM report_labor_lines rll
           INNER JOIN daily_reports dr ON rll.report_id = dr.id
           INNER JOIN employees e ON rll.employee_id = e.id
           WHERE dr.project_id IS NULL
             AND dr.report_date >= $1 
             AND dr.report_date <= $2
             AND dr.status = 'submitted'
           GROUP BY e.id, e.name
           ORDER BY e.name`;
          employeeParams = [startDate as string, endDate as string];
        }

        const employeeResult = await query<{
          employee_id: string;
          employee_name: string;
          total_hours: number;
        }>(employeeQuery, employeeParams);

        const employees = employeeResult.rows.map(emp => {
          employeeSet.add(emp.employee_id);
          return {
            employeeId: emp.employee_id,
            employeeName: emp.employee_name,
            totalHours: Math.round((emp.total_hours || 0) * 100) / 100,
          };
        });

        const regularHours = projectRow.total_regular_hours || 0;
        const otHours = projectRow.total_ot_hours || 0;
        const dtHours = projectRow.total_dt_hours || 0;
        const projectTotalHours = regularHours + otHours + dtHours;

        totalRegularHours += regularHours;
        totalOtHours += otHours;
        totalDtHours += dtHours;

        projects.push({
          projectId: projectRow.project_id,
          projectName: projectRow.project_name,
          totalRegularHours: Math.round(regularHours * 100) / 100,
          totalOtHours: Math.round(otHours * 100) / 100,
          totalDtHours: Math.round(dtHours * 100) / 100,
          totalHours: Math.round(projectTotalHours * 100) / 100,
          employees,
        });
      }

      const grandTotalHours = totalRegularHours + totalOtHours + totalDtHours;

      res.json({
        periodStart: startDate,
        periodEnd: endDate,
        projects,
        totalRegularHours: Math.round(totalRegularHours * 100) / 100,
        totalOtHours: Math.round(totalOtHours * 100) / 100,
        totalDtHours: Math.round(totalDtHours * 100) / 100,
        grandTotalHours: Math.round(grandTotalHours * 100) / 100,
        totalEmployees: employeeSet.size,
      });
    } catch (error) {
      console.error('Error fetching period summary:', error);
      res.status(500).json({ error: 'Failed to fetch period summary' });
    }
  }
);

export default router;
