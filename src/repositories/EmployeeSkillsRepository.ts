import { query } from '../services/database';

export interface EmployeeAllowedSkill {
  id: string;
  employeeName: string;
  skillName: string;
  clientName: string;
  createdAt: Date;
  createdBy: string;
}

export class EmployeeSkillsRepository {
  /**
   * Get all allowed skills for an employee for a specific client
   */
  static async getSkillsForEmployee(employeeName: string, clientName: string): Promise<string[]> {
    const result = await query<{ skill_name: string }>(
      `SELECT skill_name FROM employee_allowed_skills 
       WHERE LOWER(employee_name) = LOWER($1) AND LOWER(client_name) = LOWER($2)`,
      [employeeName, clientName]
    );
    return result.rows.map(r => r.skill_name);
  }

  /**
   * Get all skill assignments for a client
   */
  static async getAllForClient(clientName: string): Promise<EmployeeAllowedSkill[]> {
    const result = await query<EmployeeAllowedSkill>(
      `SELECT * FROM employee_allowed_skills 
       WHERE LOWER(client_name) = LOWER($1)
       ORDER BY employee_name, skill_name`,
      [clientName]
    );
    return result.rows;
  }

  /**
   * Get all skill assignments (for admin view)
   */
  static async getAll(): Promise<EmployeeAllowedSkill[]> {
    const result = await query<EmployeeAllowedSkill>(
      `SELECT * FROM employee_allowed_skills ORDER BY client_name, employee_name, skill_name`
    );
    return result.rows;
  }

  /**
   * Add a skill for an employee
   */
  static async addSkill(
    employeeName: string,
    skillName: string,
    clientName: string,
    createdBy: string
  ): Promise<EmployeeAllowedSkill> {
    const result = await query<EmployeeAllowedSkill>(
      `INSERT INTO employee_allowed_skills (employee_name, skill_name, client_name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_name, skill_name, client_name) DO NOTHING
       RETURNING *`,
      [employeeName, skillName, clientName, createdBy]
    );
    return result.rows[0];
  }

  /**
   * Remove a skill from an employee
   */
  static async removeSkill(
    employeeName: string,
    skillName: string,
    clientName: string
  ): Promise<boolean> {
    const result = await query(
      `DELETE FROM employee_allowed_skills 
       WHERE LOWER(employee_name) = LOWER($1) 
       AND LOWER(skill_name) = LOWER($2) 
       AND LOWER(client_name) = LOWER($3)`,
      [employeeName, skillName, clientName]
    );
    return (result.rowCount || 0) > 0;
  }

  /**
   * Set all skills for an employee (replaces existing)
   */
  static async setSkillsForEmployee(
    employeeName: string,
    clientName: string,
    skills: string[],
    createdBy: string
  ): Promise<void> {
    // Delete existing skills for this employee/client
    await query(
      `DELETE FROM employee_allowed_skills 
       WHERE LOWER(employee_name) = LOWER($1) AND LOWER(client_name) = LOWER($2)`,
      [employeeName, clientName]
    );

    // Insert new skills
    for (const skillName of skills) {
      await query(
        `INSERT INTO employee_allowed_skills (employee_name, skill_name, client_name, created_by)
         VALUES ($1, $2, $3, $4)`,
        [employeeName, skillName, clientName, createdBy]
      );
    }
  }
}
