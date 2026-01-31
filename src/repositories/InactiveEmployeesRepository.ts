import { query } from '../services/database';

export interface InactiveEmployee {
  id: string;
  employeeName: string;
  createdAt: Date;
  createdBy: string;
}

export class InactiveEmployeesRepository {
  /**
   * Check if an employee is inactive
   */
  static async isInactive(employeeName: string): Promise<boolean> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM inactive_employees 
       WHERE LOWER(employee_name) = LOWER($1)`,
      [employeeName]
    );
    return parseInt(result.rows[0].count) > 0;
  }

  /**
   * Get all inactive employees
   */
  static async getAll(): Promise<InactiveEmployee[]> {
    const result = await query<InactiveEmployee>(
      `SELECT * FROM inactive_employees ORDER BY employee_name`
    );
    return result.rows;
  }

  /**
   * Get list of inactive employee names (for filtering)
   */
  static async getInactiveNames(): Promise<string[]> {
    const result = await query<{ employeeName: string }>(
      `SELECT employee_name FROM inactive_employees`
    );
    return result.rows.map(r => r.employeeName.toLowerCase());
  }

  /**
   * Set employee as inactive
   */
  static async setInactive(employeeName: string, createdBy: string): Promise<InactiveEmployee> {
    const result = await query<InactiveEmployee>(
      `INSERT INTO inactive_employees (employee_name, created_by)
       VALUES ($1, $2)
       ON CONFLICT (employee_name) DO NOTHING
       RETURNING *`,
      [employeeName, createdBy]
    );
    return result.rows[0];
  }

  /**
   * Set employee as active (remove from inactive list)
   */
  static async setActive(employeeName: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM inactive_employees 
       WHERE LOWER(employee_name) = LOWER($1)`,
      [employeeName]
    );
    return (result.rowCount || 0) > 0;
  }
}
