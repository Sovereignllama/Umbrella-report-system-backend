import { Router, Response } from 'express';
import { AuthRequest } from '../types/auth';
import { authMiddleware, requireSupervisorOrBoss } from '../middleware';
import { TimeEntryRepository } from '../repositories';

const router = Router();

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
