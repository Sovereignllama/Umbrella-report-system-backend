import { query } from '../services/database';
import { Employee } from '../types/database';

export class EmployeeRepository {
  static async findAll(activeOnly = true): Promise<Employee[]> {
    const sql = activeOnly
      ? 'SELECT * FROM employees WHERE active = true ORDER BY name'
      : 'SELECT * FROM employees ORDER BY name';
    
    const result = await query<Employee>(sql);
    return result.rows;
  }

  static async findById(id: string): Promise<Employee | null> {
    const result = await query<Employee>(
      'SELECT * FROM employees WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByQbId(qbId: string): Promise<Employee | null> {
    const result = await query<Employee>(
      'SELECT * FROM employees WHERE qb_id = $1',
      [qbId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    name: string;
    qb_id?: string;
    skill_level: string;
  }): Promise<Employee> {
    const result = await query<Employee>(
      `INSERT INTO employees (name, qb_id, skill_level)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.qb_id || null, data.skill_level]
    );
    return result.rows[0];
  }

  static async createBulk(employees: Array<{
    name: string;
    qb_id?: string;
    skill_level: string;
  }>): Promise<Employee[]> {
    if (employees.length === 0) return [];

    const values = employees
      .map((_emp, idx) => {
        const paramOffset = idx * 3;
        return `($${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3})`;
      })
      .join(',');

    const flatParams = employees.flatMap(emp => [
      emp.name,
      emp.qb_id || null,
      emp.skill_level
    ]);

    const result = await query<Employee>(
      `INSERT INTO employees (name, qb_id, skill_level)
       VALUES ${values}
       RETURNING *`,
      flatParams
    );
    return result.rows;
  }

  static async update(
    id: string,
    data: Partial<Employee>
  ): Promise<Employee | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id' && key !== 'imported_at') {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = await query<Employee>(
      `UPDATE employees SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  static async deactivate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE employees SET active = false WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}
