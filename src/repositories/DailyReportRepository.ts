import { query, withTransaction } from '../services/database';
import { DailyReport, ReportLaborLine, ReportEquipmentLine, ReportMaterials, ReportAttachment } from '../types/database';

export interface CreateDailyReportData {
  projectId: string | null;
  clientName?: string;
  projectName?: string;
  weekFolder?: string;
  reportDate: Date;
  supervisorId: string;
  notes: string;
  materials?: string;
  delays?: string;
  tomorrowsActivities?: string;
  laborLines: Array<{
    employeeId: string;
    employeeName?: string;
    skillName?: string;
    regularHours: number;
    otHours: number;
    dtHours: number;
    workDescription?: string;
  }>;
  equipmentLines: Array<{
    equipmentId: string;
    equipmentName?: string;
    hoursUsed: number;
  }>;
  attachments?: Array<{
    sharepoint_url: string;
    file_name: string;
  }>;
}

export class DailyReportRepository {
  static async findByProjectAndDate(
    projectId: string,
    reportDate: Date
  ): Promise<DailyReport | null> {
    const result = await query<DailyReport>(
      `SELECT * FROM daily_reports 
       WHERE project_id = $1 AND report_date = $2 AND status = 'submitted'`,
      [projectId, reportDate]
    );
    return result.rows[0] || null;
  }

  /**
   * Find report by client name, project name, and date
   * Used for SharePoint-based folder structure lookups
   */
  static async findByClientProjectDate(
    clientName: string,
    projectName: string,
    reportDate: Date
  ): Promise<DailyReport | null> {
    const result = await query<DailyReport>(
      `SELECT * FROM daily_reports 
       WHERE client_name = $1 AND project_name = $2 AND report_date = $3 AND status = 'submitted'`,
      [clientName, projectName, reportDate]
    );
    return result.rows[0] || null;
  }

  static async findById(id: string): Promise<DailyReport | null> {
    const result = await query<DailyReport>(
      'SELECT * FROM daily_reports WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByProject(projectId: string, limit = 30): Promise<DailyReport[]> {
    const result = await query<DailyReport>(
      `SELECT * FROM daily_reports 
       WHERE project_id = $1 AND status = 'submitted'
       ORDER BY report_date DESC
       LIMIT $2`,
      [projectId, limit]
    );
    return result.rows;
  }

  static async findByDateRange(
    startDate: Date,
    endDate: Date,
    projectId?: string
  ): Promise<(DailyReport & { supervisorName?: string })[]> {
    let sql = `SELECT dr.*, u.name as supervisor_name 
               FROM daily_reports dr
               LEFT JOIN users u ON dr.supervisor_id = u.id
               WHERE dr.report_date >= $1 AND dr.report_date <= $2 AND dr.status = 'submitted'`;
    const params: any[] = [startDate, endDate];

    if (projectId) {
      sql += ` AND dr.project_id = $3`;
      params.push(projectId);
    }

    sql += ` ORDER BY dr.report_date DESC`;
    const result = await query<DailyReport & { supervisorName?: string }>(sql, params);
    return result.rows;
  }

  static async create(data: CreateDailyReportData): Promise<DailyReport> {
    return withTransaction(async (client) => {
      // Create report
      const reportResult = await client.query(
        `INSERT INTO daily_reports (project_id, client_name, project_name, week_folder, report_date, supervisor_id, notes, materials, delays, tomorrows_activities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [data.projectId, data.clientName || null, data.projectName || null, data.weekFolder || null, data.reportDate, data.supervisorId, data.notes, data.materials || null, data.delays || null, data.tomorrowsActivities || null]
      );
      const report = reportResult.rows[0] as DailyReport;

      // Create labor lines
      if (data.laborLines.length > 0) {
        const laborValues = data.laborLines
          .map((_line, idx) => {
            const paramOffset = idx * 7;
            return `($1, $${paramOffset + 2}, $${paramOffset + 3}, $${paramOffset + 4}, $${paramOffset + 5}, $${paramOffset + 6}, $${paramOffset + 7}, $${paramOffset + 8})`;
          })
          .join(',');

        const laborParams: (string | number | null)[] = [report.id];
        data.laborLines.forEach(line => {
          // Check if employeeId is a valid UUID, otherwise use null and rely on employee_name
          const isValidUuid = line.employeeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.employeeId);
          laborParams.push(
            isValidUuid ? line.employeeId : null,
            line.employeeName || null,
            line.skillName || null,
            line.regularHours,
            line.otHours,
            line.dtHours,
            line.workDescription || ''
          );
        });

        await client.query(
          `INSERT INTO report_labor_lines (report_id, employee_id, employee_name, skill_name, regular_hours, ot_hours, dt_hours, work_description)
           VALUES ${laborValues}`,
          laborParams
        );
      }

      // Create equipment lines
      if (data.equipmentLines.length > 0) {
        const equipmentValues = data.equipmentLines
          .map((_line, idx) => `($1, $${idx * 3 + 2}, $${idx * 3 + 3}, $${idx * 3 + 4})`)
          .join(',');

        const equipmentParams: (string | number | null)[] = [report.id];
        data.equipmentLines.forEach(line => {
          // Check if equipmentId is a valid UUID, otherwise use null and rely on equipment_name
          const isValidUuid = line.equipmentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.equipmentId);
          equipmentParams.push(
            isValidUuid ? line.equipmentId : null, 
            line.equipmentName || null,
            line.hoursUsed
          );
        });

        await client.query(
          `INSERT INTO report_equipment_lines (report_id, equipment_id, equipment_name, hours_used)
           VALUES ${equipmentValues}`,
          equipmentParams
        );
      }

      // Create materials
      if (data.materials) {
        await client.query(
          `INSERT INTO report_materials (report_id, free_text_notes) VALUES ($1, $2)`,
          [report.id, data.materials]
        );
      }

      // Create attachments
      if (data.attachments && data.attachments.length > 0) {
        const attachmentValues = data.attachments
          .map((_att, idx) => `($1, $${idx * 2 + 2}, $${idx * 2 + 3})`)
          .join(',');

        const attachmentParams: string[] = [report.id];
        data.attachments.forEach(att => {
          attachmentParams.push(att.sharepoint_url, att.file_name);
        });

        await client.query(
          `INSERT INTO report_attachments (report_id, sharepoint_url, file_name)
           VALUES ${attachmentValues}`,
          attachmentParams
        );
      }

      return report;
    });
  }

  static async archiveReport(id: string): Promise<boolean> {
    const result = await query(
      `UPDATE daily_reports SET status = 'archived' WHERE id = $1`,
      [id]
    );
    return result.rowCount > 0;
  }

  /**
   * Find all reports for a client/project combination (for aggregate reports)
   */
  static async findByClientProject(clientName: string, projectName: string): Promise<DailyReport[]> {
    const result = await query<DailyReport>(
      `SELECT * FROM daily_reports 
       WHERE client_name = $1 AND project_name = $2 AND status = 'submitted'
       ORDER BY report_date ASC`,
      [clientName, projectName]
    );
    return result.rows;
  }

  static async updateExcelUrls(
    id: string,
    supervisorUrl: string,
    bossUrl: string
  ): Promise<boolean> {
    const result = await query(
      `UPDATE daily_reports SET excel_supervisor_url = $1, excel_boss_url = $2 WHERE id = $3`,
      [supervisorUrl, bossUrl, id]
    );
    return result.rowCount > 0;
  }

  /**
   * Delete a report and all related data (labor lines, equipment lines, etc.)
   * Uses CASCADE delete if foreign keys are set up, otherwise deletes manually
   */
  static async deleteById(id: string): Promise<boolean> {
    return withTransaction(async (client) => {
      // Delete related records first (in case CASCADE isn't set up)
      await client.query('DELETE FROM report_labor_lines WHERE report_id = $1', [id]);
      await client.query('DELETE FROM report_equipment_lines WHERE report_id = $1', [id]);
      await client.query('DELETE FROM report_materials WHERE report_id = $1', [id]);
      await client.query('DELETE FROM report_attachments WHERE report_id = $1', [id]);
      
      // Delete the report itself
      const result = await client.query('DELETE FROM daily_reports WHERE id = $1', [id]);
      return (result.rowCount || 0) > 0;
    });
  }
}

export class ReportLaborLineRepository {
  static async findByReportId(reportId: string): Promise<ReportLaborLine[]> {
    const result = await query<ReportLaborLine>(
      `SELECT * FROM report_labor_lines WHERE report_id = $1`,
      [reportId]
    );
    return result.rows;
  }
}

export class ReportEquipmentLineRepository {
  static async findByReportId(reportId: string): Promise<ReportEquipmentLine[]> {
    const result = await query<ReportEquipmentLine>(
      `SELECT * FROM report_equipment_lines WHERE report_id = $1`,
      [reportId]
    );
    return result.rows;
  }
}

export class ReportMaterialsRepository {
  static async findByReportId(reportId: string): Promise<ReportMaterials | null> {
    const result = await query<ReportMaterials>(
      `SELECT * FROM report_materials WHERE report_id = $1`,
      [reportId]
    );
    return result.rows[0] || null;
  }
}

export class ReportAttachmentRepository {
  static async findByReportId(reportId: string): Promise<ReportAttachment[]> {
    const result = await query<ReportAttachment>(
      `SELECT * FROM report_attachments WHERE report_id = $1`,
      [reportId]
    );
    return result.rows;
  }
}
