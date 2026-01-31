import { query } from '../services/database';
import { PayPeriod } from '../types/database';

export class PayPeriodRepository {
  /**
   * Get all pay periods for a year
   */
  static async findByYear(year: number): Promise<PayPeriod[]> {
    const result = await query<PayPeriod>(
      `SELECT * FROM pay_periods WHERE year = $1 ORDER BY period_number`,
      [year]
    );
    return result.rows;
  }

  /**
   * Get a specific pay period
   */
  static async findById(id: string): Promise<PayPeriod | null> {
    const result = await query<PayPeriod>(
      `SELECT * FROM pay_periods WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get pay period by year and period number
   */
  static async findByYearAndPeriod(year: number, periodNumber: number): Promise<PayPeriod | null> {
    const result = await query<PayPeriod>(
      `SELECT * FROM pay_periods WHERE year = $1 AND period_number = $2`,
      [year, periodNumber]
    );
    return result.rows[0] || null;
  }

  /**
   * Find which pay period a date falls into
   */
  static async findByDate(date: Date): Promise<PayPeriod | null> {
    const result = await query<PayPeriod>(
      `SELECT * FROM pay_periods WHERE $1 BETWEEN start_date AND end_date`,
      [date]
    );
    return result.rows[0] || null;
  }

  /**
   * Find pay periods that ended yesterday and haven't had reports generated
   */
  static async findPendingReportGeneration(): Promise<PayPeriod[]> {
    const result = await query<PayPeriod>(
      `SELECT * FROM pay_periods 
       WHERE end_date = CURRENT_DATE - INTERVAL '1 day'
       AND report_generated = FALSE
       ORDER BY year, period_number`
    );
    return result.rows;
  }

  /**
   * Create a new pay period
   */
  static async create(data: {
    year: number;
    periodNumber: number;
    startDate: Date;
    endDate: Date;
  }): Promise<PayPeriod> {
    const result = await query<PayPeriod>(
      `INSERT INTO pay_periods (year, period_number, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.year, data.periodNumber, data.startDate, data.endDate]
    );
    return result.rows[0];
  }

  /**
   * Bulk insert pay periods (for importing from Excel)
   */
  static async bulkCreate(periods: Array<{
    year: number;
    periodNumber: number;
    startDate: Date;
    endDate: Date;
  }>): Promise<number> {
    if (periods.length === 0) return 0;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    
    periods.forEach((period, i) => {
      const offset = i * 4;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
      values.push(period.year, period.periodNumber, period.startDate, period.endDate);
    });

    const result = await query(
      `INSERT INTO pay_periods (year, period_number, start_date, end_date)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (year, period_number) DO UPDATE SET
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      values
    );
    
    return result.rowCount || 0;
  }

  /**
   * Mark a pay period as having its report generated
   */
  static async markReportGenerated(id: string): Promise<void> {
    await query(
      `UPDATE pay_periods 
       SET report_generated = TRUE, report_generated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Delete all pay periods for a year (useful when re-importing)
   */
  static async deleteByYear(year: number): Promise<number> {
    const result = await query(
      `DELETE FROM pay_periods WHERE year = $1`,
      [year]
    );
    return result.rowCount || 0;
  }
}
