import { query } from '../services/database';
import { SignInOutForm } from '../types/database';

export class SignInOutFormRepository {
  static async create(data: {
    date: string;
    fileName: string;
    uploadedBy: string;
    sharepointUrl: string;
  }): Promise<SignInOutForm> {
    const result = await query<SignInOutForm>(
      `INSERT INTO sign_in_out_forms (date, file_name, uploaded_by, sharepoint_url)
       VALUES ($1, $2, $3, $4)
       RETURNING 
         id,
         date::text as date,
         file_name as "fileName",
         uploaded_by as "uploadedBy",
         uploaded_at::text as "uploadedAt",
         sharepoint_url as "sharepointUrl",
         created_at as "createdAt"`,
      [data.date, data.fileName, data.uploadedBy, data.sharepointUrl]
    );
    return result.rows[0];
  }

  static async findByDateRange(
    startDate: string,
    endDate: string
  ): Promise<SignInOutForm[]> {
    const result = await query<SignInOutForm>(
      `SELECT 
         id,
         date::text as date,
         file_name as "fileName",
         uploaded_by as "uploadedBy",
         uploaded_at::text as "uploadedAt",
         sharepoint_url as "sharepointUrl",
         created_at as "createdAt"
       FROM sign_in_out_forms
       WHERE date >= $1 AND date <= $2
       ORDER BY date DESC`,
      [startDate, endDate]
    );
    return result.rows;
  }

  static async findByDate(date: string): Promise<SignInOutForm | null> {
    const result = await query<SignInOutForm>(
      `SELECT 
         id,
         date::text as date,
         file_name as "fileName",
         uploaded_by as "uploadedBy",
         uploaded_at::text as "uploadedAt",
         sharepoint_url as "sharepointUrl",
         created_at as "createdAt"
       FROM sign_in_out_forms
       WHERE date = $1`,
      [date]
    );
    return result.rows[0] || null;
  }

  static async deleteById(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM sign_in_out_forms WHERE id = $1',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async deleteByDateAndFileName(date: string, fileName: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM sign_in_out_forms WHERE date = $1 AND file_name = $2',
      [date, fileName]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
