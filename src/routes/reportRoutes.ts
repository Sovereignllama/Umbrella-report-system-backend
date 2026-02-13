import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../types/auth';
import {
  authMiddleware,
  requireSupervisor,
  requireSupervisorOrBoss,
  requireAdmin,
} from '../middleware';
import {
  DailyReportRepository,
  ProjectRepository,
  ClientRepository,
  ReportLaborLineRepository,
  ReportEquipmentLineRepository,
  ReportAttachmentRepository,
  UserRepository,
} from '../repositories';
import {
  archivePreviousReport,
} from '../services/reportSharePointService';
import {
  generateDfaExcel,
  uploadDfaToSharePoint,
  generateAggregateReport,
  uploadAggregateToSharePoint,
  archiveDfaToSharePoint,
  uploadPhotoToSharePoint,
} from '../services/dfaService';
import {
  generateAndUploadTracker,
} from '../services/trackerService';

// Configure multer for memory storage (files stored in memory as Buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
  },
  fileFilter: (_req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const router = Router();

// ============================================
// CHECK FOR EXISTING REPORT
// ============================================

/**
 * GET /api/reports/check-existing
 * Check if a report already exists for a client/project/date combination
 */
router.get('/check-existing', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientName, projectName, reportDate } = req.query;

    if (!clientName || !projectName || !reportDate) {
      res.status(400).json({ error: 'clientName, projectName, and reportDate are required' });
      return;
    }

    // Look up existing report by client/project/date
    const existingReport = await DailyReportRepository.findByClientProjectDate(
      clientName as string,
      projectName as string,
      new Date(reportDate as string)
    );

    if (existingReport) {
      res.json({ exists: true, reportId: existingReport.id });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking for existing report:', error);
    res.status(500).json({ error: 'Failed to check for existing report' });
  }
});

// ============================================
// CLIENT AND PROJECT LOOKUPS (for report form)
// ============================================

/**
 * GET /api/reports/clients
 * Get all active clients (for dropdown)
 */
router.get('/clients', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clients = await ClientRepository.findAll(true); // activeOnly = true
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

/**
 * GET /api/reports/clients/:clientId/projects
 * Get active projects for a specific client
 */
router.get('/clients/:clientId/projects', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;
    const projects = await ProjectRepository.findByClientId(clientId, true); // activeOnly = true
    res.json(projects);
  } catch (error) {
    console.error('Error fetching client projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * POST /api/reports
 * Submit a new daily report
 */
router.post(
  '/',
  authMiddleware,
  requireSupervisor,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        projectId,
        clientName,
        projectName,
        weekFolder,
        reportDate,
        notes,
        laborLines,
        equipmentLines,
        materials,
        delays,
        tomorrowsActivities,
        attachments,
        overwriteExisting: _overwriteExisting,
      } = req.body;

      // Validate required fields
      if (!reportDate) {
        res.status(400).json({ error: 'reportDate is required' });
        return;
      }

      // Check if report already exists for this client/project/date
      let existingReport = null;
      if (clientName && projectName) {
        existingReport = await DailyReportRepository.findByClientProjectDate(
          clientName,
          projectName,
          new Date(reportDate)
        );
      } else if (projectId) {
        existingReport = await DailyReportRepository.findByProjectAndDate(
          projectId,
          new Date(reportDate)
        );
      }

      if (existingReport) {
        // Delete any previously archived reports for this client/project/date
        // so the unique constraint doesn't conflict
        if (clientName && projectName) {
          await DailyReportRepository.deleteArchivedByClientProjectDate(
            clientName,
            projectName,
            new Date(reportDate)
          );
        }
        
        // Archive the old report
        await DailyReportRepository.archiveReport(existingReport.id);

        // Archive in SharePoint if URL exists
        if (existingReport.excelSupervisorUrl) {
          try {
            const project = await ProjectRepository.findById(projectId);
            if (project?.sharePointFolderId) {
              await archivePreviousReport(
                project.sharePointFolderId,
                existingReport.excelSupervisorUrl
              );
            }
          } catch (error) {
            console.warn('Failed to archive SharePoint file:', error);
          }
        }
      }

      // Map labor lines to the expected format
      const mappedLaborLines = (laborLines || []).map((line: any) => ({
        employeeId: line.employee_id || line.employeeId,
        employeeName: line.employee_name || line.employeeName,
        skillName: line.skill_name || line.skillName,
        regularHours: line.regular_hours || line.regularHours || 0,
        otHours: line.ot_hours || line.otHours || 0,
        dtHours: line.dt_hours || line.dtHours || 0,
        workDescription: line.work_description || line.workDescription || '',
        startTime: line.start_time || line.startTime || null,
        endTime: line.end_time || line.endTime || null,
        thirtyMinDeduction: line.thirty_min_deduction || line.thirtyMinDeduction || false,
      }));

      // Map equipment lines to the expected format
      const mappedEquipmentLines = (equipmentLines || []).map((line: any) => ({
        equipmentId: line.equipment_id || line.equipmentId,
        equipmentName: line.equipment_name || line.equipmentName,
        hoursUsed: line.hours_used || line.hoursUsed || 0,
      }));

      // Check if projectId is a valid UUID, otherwise use null
      const isValidProjectUuid = projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);

      // Debug logging
      console.log('Creating report with data:', {
        projectId: isValidProjectUuid ? projectId : null,
        clientName,
        projectName,
        weekFolder,
        reportDate,
        supervisorId: req.user.id,
        notes,
        materials,
        delays,
        tomorrowsActivities,
        laborLinesCount: mappedLaborLines.length,
        equipmentLinesCount: mappedEquipmentLines.length,
      });

      // Determine supervisor for report (preserve original supervisor when overwriting)
      let supervisorId = req.user.id;
      let supervisorName = req.user.name || 'Unknown Supervisor';
      if (existingReport) {
        supervisorId = existingReport.supervisorId;
        // Look up original supervisor name
        const originalSupervisor = await UserRepository.findById(existingReport.supervisorId);
        if (originalSupervisor) {
          supervisorName = originalSupervisor.name;
        }
      }

      // Create report in database
      const newReport = await DailyReportRepository.create({
        projectId: isValidProjectUuid ? projectId : null, // null for SharePoint-based projects without DB record
        clientName,
        projectName,
        weekFolder,
        reportDate: new Date(reportDate),
        supervisorId: supervisorId,
        notes,
        materials,
        delays,
        tomorrowsActivities,
        laborLines: mappedLaborLines,
        equipmentLines: mappedEquipmentLines,
        attachments,
      });

      console.log('Report created:', newReport);

      // Get project details (may not exist for SharePoint-based projects)
      const project = isValidProjectUuid ? await ProjectRepository.findById(projectId) : null;
      const displayProjectName = projectName || project?.name || 'Unknown Project';

      // Respond immediately so the client doesn't time out
      res.status(201).json({
        id: newReport.id,
        message: existingReport ? 'Report updated successfully' : 'Report submitted successfully',
        clientName,
        projectName: displayProjectName,
        weekFolder,
      });

      // Generate and upload DFA Excel to SharePoint asynchronously (non-blocking)
      if (clientName && displayProjectName && weekFolder) {
        setImmediate(async () => {
          try {
            console.log('Generating DFA Excel...');
            const { buffer: dfaBuffer, fileName: dfaFileName, totalCost } = await generateDfaExcel(
              newReport,
              supervisorName
            );
            
            console.log(`DFA generated: ${dfaFileName}, Total Cost: $${totalCost.toFixed(2)}`);
            
            // Upload DFA to week folder
            const dfaUploadResult = await uploadDfaToSharePoint(
              clientName,
              displayProjectName,
              weekFolder,
              dfaBuffer,
              dfaFileName
            );
            console.log(`DFA uploaded: ${dfaUploadResult.webUrl}`);
            
            // Generate and upload aggregate report to project folder
            const projectReports = await DailyReportRepository.findByClientProject(clientName, displayProjectName);
            if (projectReports.length > 0) {
              console.log(`Generating aggregate report for ${projectReports.length} DFAs...`);
              const { buffer: aggBuffer, fileName: aggFileName } = await generateAggregateReport(
                clientName,
                displayProjectName,
                projectReports
              );
              
              await uploadAggregateToSharePoint(
                clientName,
                displayProjectName,
                aggBuffer,
                aggFileName
              );
              console.log('Aggregate report uploaded');
            }
          } catch (dfaError) {
            console.error('Error generating/uploading DFA:', dfaError);
            console.error('DFA Error details:', dfaError instanceof Error ? dfaError.message : String(dfaError));
          }
          
          // Generate and upload Tracker Excel (separate try-catch so it doesn't block on DFA errors)
          try {
            console.log('Generating Tracker Excel...');
            await generateAndUploadTracker(newReport, supervisorName, weekFolder);
            console.log(`Tracker updated for week: ${weekFolder}`);
          } catch (trackerError) {
            console.error('Error generating/uploading Tracker:', trackerError);
            console.error('Tracker Error details:', trackerError instanceof Error ? trackerError.message : String(trackerError));
            // Don't throw - tracker errors shouldn't block report submission
          }
        });
      }
    } catch (error) {
      console.error('Error submitting report:', error);
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to submit report' });
      }
    }
  }
);

/**
 * GET /api/reports/:id
 * Get report details with labor and equipment lines
 */
router.get(
  '/:id',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const report = await DailyReportRepository.findById(id);
      if (!report) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      // Get labor and equipment lines
      const laborLines = await ReportLaborLineRepository.findByReportId(id);
      const equipmentLines = await ReportEquipmentLineRepository.findByReportId(id);

      // Map labor lines to camelCase
      const mappedLaborLines = laborLines.map((line: any) => ({
        id: line.id,
        reportId: line.report_id || line.reportId,
        employeeId: line.employee_id || line.employeeId,
        employeeName: line.employee_name || line.employeeName,
        skillName: line.skill_name || line.skillName,
        startTime: line.start_time || line.startTime,
        endTime: line.end_time || line.endTime,
        regularHours: line.regular_hours || line.regularHours,
        otHours: line.ot_hours || line.otHours,
        dtHours: line.dt_hours || line.dtHours,
        workDescription: line.work_description || line.workDescription,
        thirtyMinDeduction: line.thirty_min_deduction || line.thirtyMinDeduction || false,
      }));

      res.json({
        report,
        laborLines: mappedLaborLines,
        equipmentLines
      });
    } catch (error) {
      console.error('Error fetching report:', error);
      res.status(500).json({ error: 'Failed to fetch report' });
    }
  }
);

/**
 * GET /api/reports/project/:projectId
 * Get reports for a project
 */
router.get(
  '/project/:projectId',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { limit = '30' } = req.query;

      const reports = await DailyReportRepository.findByProject(
        projectId,
        parseInt(limit as string)
      );

      res.json(reports);
    } catch (error) {
      console.error('Error fetching reports:', error);
      res.status(500).json({ error: 'Failed to fetch reports' });
    }
  }
);

/**
 * GET /api/reports
 * Get reports by date range
 */
router.get(
  '/',
  authMiddleware,
  requireSupervisorOrBoss,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { startDate, endDate, projectId } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const reports = await DailyReportRepository.findByDateRange(
        new Date(startDate as string),
        new Date(endDate as string),
        projectId as string
      );

      res.json(reports);
    } catch (error) {
      console.error('Error fetching reports:', error);
      res.status(500).json({ error: 'Failed to fetch reports' });
    }
  }
);

// ============================================
// DELETE REPORT (Admin only)
// ============================================

/**
 * DELETE /api/reports/:id
 * Delete a report - Admin only
 */
router.delete(
  '/:id',
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Check if report exists
      const report = await DailyReportRepository.findById(id);
      if (!report) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      // Archive the DFA to SharePoint before deleting
      try {
        await archiveDfaToSharePoint(report);
      } catch (archiveError: any) {
        if (archiveError.message === 'FILE_LOCKED') {
          res.status(423).json({ 
            error: 'FILE_LOCKED',
            message: 'Please close the Excel file in SharePoint before deleting this report.' 
          });
          return;
        }
        // For other archive errors, also stop deletion and return error
        console.error('Archive error:', archiveError);
        res.status(500).json({ 
          error: 'ARCHIVE_FAILED',
          message: 'Failed to archive the DFA file. Please try again.' 
        });
        return;
      }

      // Delete the report
      const deleted = await DailyReportRepository.deleteById(id);
      
      if (deleted) {
        console.log(`Report ${id} deleted by admin ${req.user?.email}`);
        res.json({ success: true, message: 'Report deleted successfully' });
      } else {
        res.status(500).json({ error: 'Failed to delete report' });
      }
    } catch (error) {
      console.error('Error deleting report:', error);
      res.status(500).json({ error: 'Failed to delete report' });
    }
  }
);

// ============================================
// UPLOAD PHOTOS
// ============================================

/**
 * POST /api/reports/:id/photos
 * Upload photos for a report
 */
router.post(
  '/:id/photos',
  authMiddleware,
  requireSupervisor,
  upload.array('photos', 10) as any, // Max 10 photos
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No photos provided' });
        return;
      }

      // Get the report to find client/project/week info
      const report = await DailyReportRepository.findById(id);
      if (!report) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      if (!report.clientName || !report.projectName || !report.weekFolder) {
        res.status(400).json({ error: 'Report missing client/project/week info' });
        return;
      }

      console.log(`Uploading ${files.length} photos for report ${id}`);

      const uploadedPhotos: Array<{ sharepoint_url: string; file_name: string }> = [];

      for (const file of files) {
        try {
          const result = await uploadPhotoToSharePoint(
            report.clientName,
            report.projectName,
            report.weekFolder,
            file.buffer,
            file.originalname
          );
          uploadedPhotos.push({
            sharepoint_url: result.webUrl,
            file_name: file.originalname,
          });
          console.log(`Uploaded photo: ${file.originalname} -> ${result.webUrl}`);
        } catch (photoError) {
          console.error(`Failed to upload photo ${file.originalname}:`, photoError);
        }
      }

      // Save attachment records to database
      if (uploadedPhotos.length > 0) {
        await ReportAttachmentRepository.addAttachments(id, uploadedPhotos);
      }

      res.json({
        success: true,
        uploaded: uploadedPhotos.length,
        total: files.length,
        photos: uploadedPhotos,
      });
    } catch (error) {
      console.error('Error uploading photos:', error);
      res.status(500).json({ error: 'Failed to upload photos' });
    }
  }
);

export default router;
