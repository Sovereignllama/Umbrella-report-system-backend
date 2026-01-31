import { query } from '../services/database';
import { User } from '../types/database';

export class UserRepository {
  static async findAll(): Promise<User[]> {
    const result = await query<User>(
      'SELECT * FROM users ORDER BY created_at DESC'
    );
    return result.rows;
  }

  static async findById(id: string): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByEmail(email: string): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    return result.rows[0] || null;
  }

  static async findByRole(role: 'admin' | 'supervisor' | 'boss'): Promise<User[]> {
    const result = await query<User>(
      'SELECT * FROM users WHERE role = $1 AND active = true ORDER BY name',
      [role]
    );
    return result.rows;
  }

  static async create(data: {
    email: string;
    name: string;
    role: 'admin' | 'supervisor' | 'boss';
  }): Promise<User> {
    const result = await query<User>(
      `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.email.toLowerCase(), data.name, data.role]
    );
    return result.rows[0];
  }

  static async assignRole(
    userId: string,
    role: 'admin' | 'supervisor' | 'boss',
    assignedBy: string
  ): Promise<User | null> {
    const result = await query<User>(
      `UPDATE users 
       SET role = $1, assigned_by = $2, assigned_date = NOW()
       WHERE id = $3
       RETURNING *`,
      [role, assignedBy, userId]
    );
    return result.rows[0] || null;
  }

  static async deactivate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE users SET active = false WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }

  static async activate(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE users SET active = true WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}
