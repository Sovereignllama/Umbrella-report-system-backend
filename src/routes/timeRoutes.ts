import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireSupervisorOrBoss } from '../middleware';
import { TimeEntryRepository, PayPeriodRepository } from '../repositories';
import { listFilesInFolder, readFileByPath } from '../services/sharepointService';
import { getSetting } from './settingsRoutes';
import ExcelJS from 'exceljs';
import { parseDate } from '../utils/dateParser';

const router = Router();

const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';

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
      && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
  );

  if (!payrollFile) {
    console.log(`No payroll_calender file found in: ${configFolder}`);
    return [];
  }

  console.log(`Reading payroll calendar file: ${payrollFile.name}`);
  const buffer = await readFileByPath(`${configFolder}/${payrollFile.name}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  // Try to extract year from the title row (row 2, merged across columns)
  let fileYear: number | null = null;
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

  const periods: Array<{
    year: number;
    periodNumber: number;
    startDate: Date;
    endDate: Date;
  }> = [];

  // Data rows 5-30: col B = period number, col C = start date, col D = end date
  for (let rowNum = 5; rowNum <= 30; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const periodVal = row.getCell(2).value; // Column B
    const startDateVal = row.getCell(3).value; // Column C
    const endDateVal = row.getCell(4).value; // Column D

    if (!periodVal || !startDateVal || !endDateVal) {
      continue;
    }

    const periodNumber = typeof periodVal === 'number'
      ? periodVal
      : parseInt(String(periodVal));

    const startDate = parseDate(startDateVal);
    const endDate = parseDate(endDateVal);

    // Debug logging for row 5
    if (rowNum === 5) {
      console.log('Row 5 raw values:', { periodVal, startDateVal, endDateVal });
      console.log('Row 5 parsed values:', { periodNumber, startDate, endDate });
    }

    if (!startDate || !endDate) {
      console.log(`Row ${rowNum}: Could not parse dates. start=${JSON.stringify(startDateVal)}, end=${JSON.stringify(endDateVal)}`);
      continue;
    }

    // Determine year from the file title or from the end date
    const periodYear = fileYear || endDate.getFullYear();

    if (!isNaN(periodNumber)) {
      periods.push({ year: periodYear, periodNumber, startDate, endDate });
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
      const year = yearParam ? parseInt(yearParam as string) : new Date().getFullYear();

      if (isNaN(year)) {
        res.status(400).json({ error: 'Invalid year' });
        return;
      }

      let periods = await PayPeriodRepository.findByYear(year);

      // If no periods in DB, try auto-loading from SharePoint payroll_calender.xlsx
      if (periods.length === 0) {
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

      res.json(periods);
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
        new Date(startDate as string),
        new Date(endDate as string),
        employeeId as string,
        projectId as string
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
        new Date(date as string)
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

export default router;
