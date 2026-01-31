import { query } from '../services/database';
import { Project } from '../types/database';

export class ProjectRepository {
  static async findAll(activeOnly = true): Promise<Project[]> {
    const sql = activeOnly
      ? 'SELECT * FROM projects WHERE active = true ORDER BY name'
      : 'SELECT * FROM projects ORDER BY name';
    
    const result = await query<Project>(sql);
    return result.rows;
  }

  static async findByClientId(clientId: string, activeOnly = true): Promise<Project[]> {
    const sql = activeOnly
      ? 'SELECT * FROM projects WHERE client_id = $1 AND active = true ORDER BY name'
      : 'SELECT * FROM projects WHERE client_id = $1 ORDER BY name';
    
    const result = await query<Project>(sql, [clientId]);
    return result.rows;
  }

  static async findById(id: string): Promise<Project | null> {
    const result = await query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    name: string;
    clientId?: string;
    sharepoint_folder_id: string;
    sharepoint_web_url: string;
  }): Promise<Project> {
    const result = await query<Project>(
      `INSERT INTO projects (name, client_id, sharepoint_folder_id, sharepoint_web_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.name, data.clientId || null, data.sharepoint_folder_id, data.sharepoint_web_url]
    );
    return result.rows[0];
  }

  static async update(
    id: string,
    data: Partial<Project>
  ): Promise<Project | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id' && key !== 'created_at') {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = await query<Project>(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  static async deactivate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE projects SET active = false WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}
