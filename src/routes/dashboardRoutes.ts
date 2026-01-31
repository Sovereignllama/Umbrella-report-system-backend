import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireSupervisorOrBoss } from '../middleware';
import {
  DailyReportRepository,
  ReportLaborLineRepository,
  ReportEquipmentLineRepository,
  ProjectRepository,
  EmployeeRepository,
  ChargeOutRateRepository,
} from '../repositories';
import { getWeekRangeForDate } from '../utils/weekUtils';

const router = Router();

interface DailyAggregation {
  date: string;
  projectId: string;
  projectName: string;
  totalRegularHours: number;
  totalOTHours: number;
  totalDTHours: number;
  totalLaborCost: number;
  equipmentHours: number;
  reportsCount: number;
}

interface WeeklyAggregation {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  projectId: string;
  projectName: string;
  totalRegularHours: number;
  totalOTHours: number;
  totalDTHours: number;
  totalLaborCost: number;
  equipmentHours: number;
  reportsCount: number;
}

/**
 * GET /api/dashboard/daily
 * Get daily aggregation by date and optional project
 */
router.get(
  '/daily',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { date, projectId } = req.query;

      if (!date) {
        res.status(400).json({ error: 'date parameter is required' });
        return;
      }

      const reportDate = new Date(date as string);
      const endDate = new Date(reportDate);
      endDate.setDate(endDate.getDate() + 1);

      // Get all reports for the day
      const reports = await DailyReportRepository.findByDateRange(
        reportDate,
        endDate,
        projectId as string
      );

      const dailyData: DailyAggregation[] = [];

      for (const report of reports) {
        const project = await ProjectRepository.findById(report.projectId);
        if (!project) continue;

        const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
        const equipmentLines = await ReportEquipmentLineRepository.findByReportId(
          report.id
        );

        let totalRegularHours = 0;
        let totalOTHours = 0;
        let totalDTHours = 0;
        let totalLaborCost = 0;

        // Calculate labor costs
        for (const line of laborLines) {
          const emp = line.employeeId ? await EmployeeRepository.findById(line.employeeId) : null;
          const rates = await ChargeOutRateRepository.findBySkillLevel(
            emp?.skillLevel || 'Regular'
          );

          totalRegularHours += line.regularHours;
          totalOTHours += line.otHours;
          totalDTHours += line.dtHours;

          totalLaborCost +=
            line.regularHours * (rates?.regularRate || 0) +
            line.otHours * (rates?.otRate || 0) +
            line.dtHours * (rates?.dtRate || 0);
        }

        // Calculate equipment hours
        let equipmentHours = 0;
        for (const line of equipmentLines) {
          equipmentHours += line.hoursUsed;
        }

        // Find existing project entry or create new
        const existingIndex = dailyData.findIndex(
          (d) => d.projectId === report.projectId
        );

        if (existingIndex >= 0) {
          dailyData[existingIndex].totalRegularHours += totalRegularHours;
          dailyData[existingIndex].totalOTHours += totalOTHours;
          dailyData[existingIndex].totalDTHours += totalDTHours;
          dailyData[existingIndex].totalLaborCost += totalLaborCost;
          dailyData[existingIndex].equipmentHours += equipmentHours;
          dailyData[existingIndex].reportsCount += 1;
        } else {
          dailyData.push({
            date: reportDate.toISOString().split('T')[0],
            projectId: report.projectId,
            projectName: project.name,
            totalRegularHours,
            totalOTHours,
            totalDTHours,
            totalLaborCost,
            equipmentHours,
            reportsCount: 1,
          });
        }
      }

      res.json(dailyData);
    } catch (error) {
      console.error('Error fetching daily aggregation:', error);
      res.status(500).json({ error: 'Failed to fetch daily data' });
    }
  }
);

/**
 * GET /api/dashboard/weekly
 * Get weekly aggregation by date range
 */
router.get(
  '/weekly',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate, projectId } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      // Get all reports in range
      const reports = await DailyReportRepository.findByDateRange(
        start,
        end,
        projectId as string
      );

      // Group by week and project
      const weeklyMap = new Map<string, WeeklyAggregation>();

      for (const report of reports) {
        const project = await ProjectRepository.findById(report.projectId);
        if (!project) continue;

        const weekRange = getWeekRangeForDate(report.reportDate);
        const key = `${report.projectId}-${weekRange.weekNumber}`;

        const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
        const equipmentLines = await ReportEquipmentLineRepository.findByReportId(
          report.id
        );

        let regularHours = 0;
        let otHours = 0;
        let dtHours = 0;
        let laborCost = 0;

        for (const line of laborLines) {
          const emp = line.employeeId ? await EmployeeRepository.findById(line.employeeId) : null;
          const rates = await ChargeOutRateRepository.findBySkillLevel(
            emp?.skillLevel || 'Regular'
          );

          regularHours += line.regularHours;
          otHours += line.otHours;
          dtHours += line.dtHours;

          laborCost +=
            line.regularHours * (rates?.regularRate || 0) +
            line.otHours * (rates?.otRate || 0) +
            line.dtHours * (rates?.dtRate || 0);
        }

        let equipmentHours = 0;
        for (const line of equipmentLines) {
          equipmentHours += line.hoursUsed;
        }

        if (weeklyMap.has(key)) {
          const existing = weeklyMap.get(key)!;
          existing.totalRegularHours += regularHours;
          existing.totalOTHours += otHours;
          existing.totalDTHours += dtHours;
          existing.totalLaborCost += laborCost;
          existing.equipmentHours += equipmentHours;
          existing.reportsCount += 1;
        } else {
          weeklyMap.set(key, {
            weekStart: weekRange.startDate.toISOString().split('T')[0],
            weekEnd: weekRange.endDate.toISOString().split('T')[0],
            weekLabel: weekRange.folderName,
            projectId: report.projectId,
            projectName: project.name,
            totalRegularHours: regularHours,
            totalOTHours: otHours,
            totalDTHours: dtHours,
            totalLaborCost: laborCost,
            equipmentHours,
            reportsCount: 1,
          });
        }
      }

      res.json(Array.from(weeklyMap.values()));
    } catch (error) {
      console.error('Error fetching weekly aggregation:', error);
      res.status(500).json({ error: 'Failed to fetch weekly data' });
    }
  }
);

/**
 * GET /api/dashboard/projects
 * Get all projects with basic info
 */
router.get(
  '/projects',
  authMiddleware,
  requireSupervisorOrBoss,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const projects = await ProjectRepository.findAll(true);
      res.json(projects);
    } catch (error) {
      console.error('Error fetching projects:', error);
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  }
);

export default router;
