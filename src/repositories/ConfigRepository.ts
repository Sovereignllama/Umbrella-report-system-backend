import { query } from '../services/database';
import { ChargeOutRate, Equipment, TemplateVersion } from '../types/database';

export class ChargeOutRateRepository {
  static async findAll(): Promise<ChargeOutRate[]> {
    const result = await query<ChargeOutRate>(
      'SELECT * FROM charge_out_rates WHERE active = true ORDER BY skill_level',
    );
    return result.rows;
  }

  static async findBySkillLevel(skillLevel: string): Promise<ChargeOutRate | null> {
    const result = await query<ChargeOutRate>(
      'SELECT * FROM charge_out_rates WHERE skill_level = $1 AND active = true',
      [skillLevel]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    skill_level: string;
    regular_rate: number;
    ot_rate: number;
    dt_rate: number;
  }): Promise<ChargeOutRate> {
    const result = await query<ChargeOutRate>(
      `INSERT INTO charge_out_rates (skill_level, regular_rate, ot_rate, dt_rate)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.skill_level, data.regular_rate, data.ot_rate, data.dt_rate]
    );
    return result.rows[0];
  }

  static async update(
    id: string,
    data: Partial<ChargeOutRate>
  ): Promise<ChargeOutRate | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id' && key !== 'effective_date') {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    values.push(id);
    const result = await query<ChargeOutRate>(
      `UPDATE charge_out_rates SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }
}

export class EquipmentRepository {
  static async findAll(activeOnly = true): Promise<Equipment[]> {
    const sql = activeOnly
      ? 'SELECT * FROM equipment WHERE active = true ORDER BY name'
      : 'SELECT * FROM equipment ORDER BY name';
    
    const result = await query<Equipment>(sql);
    return result.rows;
  }

  static async findById(id: string): Promise<Equipment | null> {
    const result = await query<Equipment>(
      'SELECT * FROM equipment WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async create(name: string): Promise<Equipment> {
    const result = await query<Equipment>(
      'INSERT INTO equipment (name) VALUES ($1) RETURNING *',
      [name]
    );
    return result.rows[0];
  }

  static async deactivate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE equipment SET active = false WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}

export class TemplateVersionRepository {
  static async findActiveByName(name: string): Promise<TemplateVersion | null> {
    const result = await query<TemplateVersion>(
      'SELECT * FROM template_versions WHERE name = $1 AND active = true',
      [name]
    );
    return result.rows[0] || null;
  }

  static async findAll(): Promise<TemplateVersion[]> {
    const result = await query<TemplateVersion>(
      'SELECT * FROM template_versions ORDER BY name, version DESC'
    );
    return result.rows;
  }

  static async create(data: {
    name: string;
    version: string;
    sharepoint_url: string;
  }): Promise<TemplateVersion> {
    const result = await query<TemplateVersion>(
      `INSERT INTO template_versions (name, version, sharepoint_url, active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [data.name, data.version, data.sharepoint_url]
    );
    return result.rows[0];
  }

  static async deactivate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE template_versions SET active = false WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}
