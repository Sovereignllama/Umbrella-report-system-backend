import { query } from '../services/database';
import { Client } from '../types/database';

export class ClientRepository {
  static async findAll(activeOnly = true): Promise<Client[]> {
    const sql = activeOnly
      ? 'SELECT * FROM clients WHERE active = true ORDER BY name'
      : 'SELECT * FROM clients ORDER BY name';
    const result = await query<Client>(sql);
    return result.rows;
  }

  static async findById(id: string): Promise<Client | null> {
    const result = await query<Client>(
      'SELECT * FROM clients WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByName(name: string): Promise<Client | null> {
    const result = await query<Client>(
      'SELECT * FROM clients WHERE name = $1',
      [name]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    name: string;
    sharePointFolderId?: string;
  }): Promise<Client> {
    const result = await query<Client>(
      `INSERT INTO clients (name, sharepoint_folder_id)
       VALUES ($1, $2)
       RETURNING *`,
      [data.name, data.sharePointFolderId || null]
    );
    return result.rows[0];
  }

  static async update(
    id: string,
    data: Partial<Client>
  ): Promise<Client | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex}`);
      values.push(data.name);
      paramIndex++;
    }
    if (data.sharePointFolderId !== undefined) {
      fields.push(`sharepoint_folder_id = $${paramIndex}`);
      values.push(data.sharePointFolderId);
      paramIndex++;
    }
    if (data.active !== undefined) {
      fields.push(`active = $${paramIndex}`);
      values.push(data.active);
      paramIndex++;
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = await query<Client>(
      `UPDATE clients SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  static async deactivate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE clients SET active = false WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}
