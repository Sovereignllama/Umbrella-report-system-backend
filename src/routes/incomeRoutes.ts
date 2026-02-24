import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireAdminOrBoss } from '../middleware';
import {
  DailyReportRepository,
  ReportLaborLineRepository,
  ReportEquipmentLineRepository,
  EmployeeRepository,
  ChargeOutRateRepository,
} from '../repositories';

const router = Router();

interface ClientIncomeAggregation {
  clientName: string;
  labourIncome: number;
  equipmentIncome: number;
  totalIncome: number;
}

/**
 * Aggregate income data from a list of reports, grouped by client name.
 */
async function aggregateIncomeByClient(
  reports: Array<{ id: string; clientName?: string | null }>
): Promise<ClientIncomeAggregation[]> {
  const incomeMap = new Map<string, { labourIncome: number; equipmentIncome: number }>();

  for (const report of reports) {
    const clientName = report.clientName || 'Unknown Client';

    const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
    const equipmentLines = await ReportEquipmentLineRepository.findByReportId(report.id);

    let labourIncome = 0;
    for (const line of laborLines) {
      const emp = line.employeeId ? await EmployeeRepository.findById(line.employeeId) : null;
      const skillForRates = line.skillName || emp?.skillLevel || 'Regular';
      const rates = await ChargeOutRateRepository.findBySkillLevel(skillForRates);

      const regHrs = Number(line.regularHours) || 0;
      const overtimeHrs = Number(line.otHours) || 0;
      const doubleTimeHrs = Number(line.dtHours) || 0;

      const regularRateValue = Number(rates?.regularRate) || 0;
      const otRateValue = Number(rates?.otRate) || 0;
      const dtRateValue = Number(rates?.dtRate) || 0;

      labourIncome +=
        regHrs * regularRateValue +
        overtimeHrs * otRateValue +
        doubleTimeHrs * dtRateValue;
    }

    // TODO: Add equipment charge-out rate lookup when EquipmentRepository supports it;
    // for now equipment income defaults to 0
    let equipmentIncome = 0;
    for (const _line of equipmentLines) {
      // equipmentIncome += hours * chargeOutRate (not yet available)
    }

    const existing = incomeMap.get(clientName);
    if (existing) {
      existing.labourIncome += labourIncome;
      existing.equipmentIncome += equipmentIncome;
    } else {
      incomeMap.set(clientName, { labourIncome, equipmentIncome });
    }
  }

  const result: ClientIncomeAggregation[] = [];
  for (const [clientName, { labourIncome, equipmentIncome }] of incomeMap.entries()) {
    result.push({
      clientName,
      labourIncome: Math.round(labourIncome * 100) / 100,
      equipmentIncome: Math.round(equipmentIncome * 100) / 100,
      totalIncome: Math.round((labourIncome + equipmentIncome) * 100) / 100,
    });
  }

  return result;
}

/**
 * GET /api/income/daily?date=YYYY-MM-DD
 * Returns income breakdown by client for a single day
 */
router.get(
  '/daily',
  authMiddleware,
  requireAdminOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { date } = req.query;

      if (!date) {
        res.status(400).json({ error: 'date parameter is required' });
        return;
      }

      const reportDate = new Date(date as string);
      if (isNaN(reportDate.getTime())) {
        res.status(400).json({ error: 'Invalid date parameter' });
        return;
      }
      const endDate = new Date(reportDate);
      endDate.setDate(endDate.getDate() + 1);

      const reports = await DailyReportRepository.findByDateRange(reportDate, endDate);
      const result = await aggregateIncomeByClient(reports);

      res.json(result);
    } catch (error) {
      console.error('Error fetching daily income breakdown:', error);
      res.status(500).json({ error: 'Failed to fetch daily income data' });
    }
  }
);

/**
 * GET /api/income/weekly?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns income breakdown by client for a date range (Mon–Sun week)
 */
router.get(
  '/weekly',
  authMiddleware,
  requireAdminOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: 'Invalid date parameters' });
        return;
      }

      if (start > end) {
        res.status(400).json({ error: 'startDate must be before or equal to endDate' });
        return;
      }

      const reports = await DailyReportRepository.findByDateRange(start, end);
      const result = await aggregateIncomeByClient(reports);

      res.json(result);
    } catch (error) {
      console.error('Error fetching weekly income breakdown:', error);
      res.status(500).json({ error: 'Failed to fetch weekly income data' });
    }
  }
);

/**
 * GET /api/income/monthly?year=YYYY&month=MM
 * Returns income breakdown by client for an entire calendar month
 */
router.get(
  '/monthly',
  authMiddleware,
  requireAdminOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { year, month } = req.query;

      if (!year || !month) {
        res.status(400).json({ error: 'year and month parameters are required' });
        return;
      }

      const yearNum = parseInt(year as string, 10);
      const monthNum = parseInt(month as string, 10);

      if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        res.status(400).json({ error: 'Invalid year or month' });
        return;
      }

      const startDate = new Date(yearNum, monthNum - 1, 1);
      const endDate = new Date(yearNum, monthNum, 1);

      const reports = await DailyReportRepository.findByDateRange(startDate, endDate);
      const result = await aggregateIncomeByClient(reports);

      res.json(result);
    } catch (error) {
      console.error('Error fetching monthly income breakdown:', error);
      res.status(500).json({ error: 'Failed to fetch monthly income data' });
    }
  }
);

export default router;
