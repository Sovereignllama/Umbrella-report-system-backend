import cron from 'node-cron';
import { processPendingPayrollReports } from './payrollSharePointService';

let payrollJob: cron.ScheduledTask | null = null;

/**
 * Start the payroll report scheduler
 * Runs daily at 6:00 AM to check if any pay periods ended yesterday
 */
export function startPayrollScheduler(): void {
  // Run daily at 6:00 AM
  payrollJob = cron.schedule('0 6 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running payroll report scheduler...`);
    await processPendingPayrollReports();
  }, {
    scheduled: true,
    timezone: 'America/Edmonton' // Alberta timezone
  });

  console.log('✅ Payroll report scheduler started (runs daily at 6:00 AM MT)');
}

/**
 * Stop the payroll scheduler
 */
export function stopPayrollScheduler(): void {
  if (payrollJob) {
    payrollJob.stop();
    payrollJob = null;
    console.log('Payroll scheduler stopped');
  }
}

/**
 * Manually trigger payroll report generation
 * Useful for testing or manual runs
 */
export async function triggerPayrollReportGeneration(): Promise<void> {
  console.log('Manually triggering payroll report generation...');
  await processPendingPayrollReports();
}
