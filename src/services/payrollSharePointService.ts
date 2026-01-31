import { getOrCreateFolder, uploadFile } from './sharepointService';
import { PayPeriodRepository } from '../repositories';
import { generatePayrollReport, getPayrollReportFilename } from './payrollReportService';
import { PayPeriod } from '../types/database';

/**
 * Get or create the payroll folder structure
 * Accounting/Payroll/Payroll {year}/PP#{periodNumber}/
 */
export async function ensurePayrollFolders(
  year: number,
  periodNumber: number
): Promise<string> {
  // Get or create Accounting folder
  const accountingFolder = await getOrCreateFolder(':root:', 'Accounting');
  
  // Get or create Payroll folder
  const payrollFolder = await getOrCreateFolder(accountingFolder.folderId, 'Payroll');
  
  // Get or create year folder (e.g., "Payroll 2026")
  const yearFolder = await getOrCreateFolder(payrollFolder.folderId, `Payroll ${year}`);
  
  // Get or create period folder (e.g., "PP#1")
  const periodFolder = await getOrCreateFolder(yearFolder.folderId, `PP#${periodNumber}`);
  
  return periodFolder.folderId;
}

/**
 * Upload a payroll report to SharePoint
 */
export async function uploadPayrollReport(
  payPeriod: PayPeriod,
  reportBuffer: Buffer
): Promise<string> {
  const folderId = await ensurePayrollFolders(payPeriod.year, payPeriod.periodNumber);
  const filename = getPayrollReportFilename(payPeriod);
  
  const result = await uploadFile(folderId, filename, reportBuffer);
  return result.webUrl;
}

/**
 * Generate and upload payroll report for a specific pay period
 */
export async function generateAndUploadPayrollReport(payPeriod: PayPeriod): Promise<string> {
  console.log(`Generating payroll report for PP#${payPeriod.periodNumber} ${payPeriod.year}...`);
  
  // Generate Excel report
  const reportBuffer = await generatePayrollReport(payPeriod);
  
  // Upload to SharePoint
  const webUrl = await uploadPayrollReport(payPeriod, reportBuffer);
  
  // Mark as generated in database
  await PayPeriodRepository.markReportGenerated(payPeriod.id);
  
  console.log(`Payroll report uploaded: ${webUrl}`);
  return webUrl;
}

/**
 * Check for pending payroll reports and generate them
 * Called daily by scheduler
 */
export async function processPendingPayrollReports(): Promise<void> {
  console.log('Checking for pending payroll reports...');
  
  try {
    const pendingPeriods = await PayPeriodRepository.findPendingReportGeneration();
    
    if (pendingPeriods.length === 0) {
      console.log('No pending payroll reports to generate.');
      return;
    }
    
    for (const period of pendingPeriods) {
      try {
        await generateAndUploadPayrollReport(period);
      } catch (error) {
        console.error(`Failed to generate payroll report for PP#${period.periodNumber}:`, error);
      }
    }
  } catch (error) {
    console.error('Error processing pending payroll reports:', error);
  }
}
