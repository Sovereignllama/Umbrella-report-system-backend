import { query } from '../services/database';
import { TimeEntry } from '../types/database';

export class TimeEntryRepository {
  static async create(data: {
    employeeId?: string;
    employeeName: string;
    projectId?: string;
    projectName?: string;
    signInTime: Date;
    notes?: string;
    recordedBy: string;
  }): Promise<TimeEntry> {
    const isValidUuid = data.employeeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.employeeId);
    const isValidProjectUuid = data.projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.projectId);

    const result = await query<TimeEntry>(
      `INSERT INTO time_entries (employee_id, employee_name, project_id, project_name, sign_in_time, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        isValidUuid ? data.employeeId : null,
        data.employeeName,
        isValidProjectUuid ? data.projectId : null,
        data.projectName || null,
        data.signInTime,
        data.notes || null,
        data.recordedBy,
      ]
    );
    return result.rows[0];
  }

  static async signOut(id: string, signOutTime: Date): Promise<TimeEntry | null> {
    const result = await query<TimeEntry>(
      `UPDATE time_entries SET sign_out_time = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [signOutTime, id]
    );
    return result.rows[0] || null;
  }

  static async findById(id: string): Promise<TimeEntry | null> {
    const result = await query<TimeEntry>(
      'SELECT * FROM time_entries WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByDateRange(
    startDate: Date | string,
    endDate: Date | string,
    employeeId?: string,
    projectId?: string
  ): Promise<TimeEntry[]> {
    let sql = `SELECT * FROM time_entries WHERE sign_in_time >= $1 AND sign_in_time <= $2`;
    const params: any[] = [startDate, endDate];
    let paramIndex = 3;

    if (employeeId) {
      sql += ` AND employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (projectId) {
      sql += ` AND project_id = $${paramIndex}`;
      params.push(projectId);
    }

    sql += ' ORDER BY sign_in_time DESC';
    const result = await query<TimeEntry>(sql, params);
    return result.rows;
  }

  static async findByEmployee(
    employeeId: string,
    limit = 50
  ): Promise<TimeEntry[]> {
    const result = await query<TimeEntry>(
      `SELECT * FROM time_entries WHERE employee_id = $1
       ORDER BY sign_in_time DESC
       LIMIT $2`,
      [employeeId, limit]
    );
    return result.rows;
  }

  static async findOpenEntries(employeeId?: string): Promise<TimeEntry[]> {
    let sql = 'SELECT * FROM time_entries WHERE sign_out_time IS NULL';
    const params: any[] = [];

    if (employeeId) {
      sql += ' AND employee_id = $1';
      params.push(employeeId);
    }

    sql += ' ORDER BY sign_in_time DESC';
    const result = await query<TimeEntry>(sql, params);
    return result.rows;
  }

  static async getDailySummary(date: Date | string): Promise<Array<{
    employeeName: string;
    employeeId: string | null;
    projectName: string | null;
    signInTime: Date;
    signOutTime: Date | null;
    totalHours: number | null;
  }>> {
    const result = await query(
      `SELECT 
         employee_name,
         employee_id,
         project_name,
         sign_in_time,
         sign_out_time,
         CASE 
           WHEN sign_out_time IS NOT NULL 
           THEN ROUND(EXTRACT(EPOCH FROM (sign_out_time - sign_in_time)) / 3600.0, 2)
           ELSE NULL
         END as total_hours
       FROM time_entries
       WHERE DATE(sign_in_time) = $1
       ORDER BY sign_in_time ASC`,
      [date]
    );
    return result.rows;
  }
}
