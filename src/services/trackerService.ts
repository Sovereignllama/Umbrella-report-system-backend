import XlsxPopulate from 'xlsx-populate';
import { DailyReport } from '../types/database';
import { ReportLaborLineRepository } from '../repositories';
import { readFileByPath, listFilesInFolder, uploadFile, getOrCreateFolder } from './sharepointService';

const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';

/**
 * Load tracker template from SharePoint (root config folder, not client-specific)
 */
async function loadTrackerTemplateBuffer(): Promise<Buffer> {
  console.log(`Looking for Tracker template in: ${DEFAULT_CONFIG_BASE_PATH}`);
  
  const files = await listFilesInFolder(DEFAULT_CONFIG_BASE_PATH);
  console.log(`Found ${files.length} files:`, files.map(f => f.name));
  
  const templateFile = files.find(f => 
    f.name.toLowerCase().includes('tracker') && 
    (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
  );
  
  if (!templateFile) {
    throw new Error(`No Tracker template found in ${DEFAULT_CONFIG_BASE_PATH}. Files found: ${files.map(f => f.name).join(', ')}`);
  }
  
  console.log(`Loading Tracker template: ${templateFile.name}`);
  const buffer = await readFileByPath(`${DEFAULT_CONFIG_BASE_PATH}/${templateFile.name}`);
  console.log(`Tracker template loaded, size: ${buffer.length} bytes`);
  
  return buffer;
}

/**
 * Get day of week index (0 = Monday, 6 = Sunday)
 */
function getDaySheetIndex(reportDate: Date): number {
  const day = reportDate.getDay();
  // Convert JavaScript day (0=Sunday) to our index (0=Monday)
  return day === 0 ? 6 : day - 1;
}

/**
 * Get day name for sheet selection
 */
function getDayName(reportDate: Date): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return days[getDaySheetIndex(reportDate)];
}

/**
 * Find the next available project block row in a sheet
 * Returns the starting row number for the next project (where the date/header goes)
 */
function findNextProjectBlock(sheet: any): number {
  // First project block starts at row 2
  // Each block is: header (2 rows) + project info (2 rows) + crew (12 rows) = 16 rows
  // Plus 2-row gap before next block
  // So blocks start at: 2, 20, 38, 56, etc.
  
  let currentRow = 2;
  
  while (true) {
    // Check if the project name cell (C + offset 2) is empty
    const projectCell = sheet.cell(`C${currentRow + 2}`);
    const projectValue = projectCell.value();
    
    if (!projectValue || projectValue === null || projectValue === '') {
      // Found an empty block
      return currentRow;
    }
    
    // Move to next potential block (16 rows for current block + 2 row gap)
    currentRow += 18;
    
    // Safety check - don't go beyond row 200
    if (currentRow > 200) {
      console.warn('Reached row limit while searching for empty project block');
      return currentRow;
    }
  }
}

/**
 * Format date as MM/DD/YYYY
 */
function formatDate(date: Date): string {
  const dateStr = String(date).split('T')[0];
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${month}/${day}/${year}`;
}

/**
 * Generate week folder name from report date (e.g., "Feb 9th - Feb 15th")
 * This should match the weekFolder format passed from frontend
 */
export function getWeekFolderName(reportDate: Date): string {
  // Get Monday of the week
  const d = new Date(reportDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  
  // Get Sunday of the week
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  
  // Format with ordinal suffixes
  const getOrdinal = (n: number): string => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startMonth = monthNames[monday.getMonth()];
  const endMonth = monthNames[sunday.getMonth()];
  
  // If same month, use "Feb 9th - Feb 15th"
  // If different months, use "Jan 30th - Feb 5th"
  return `${startMonth} ${getOrdinal(monday.getDate())} - ${endMonth} ${getOrdinal(sunday.getDate())}`;
}

/**
 * Download existing tracker for a week if it exists
 */
export async function downloadExistingTracker(weekFolder: string): Promise<Buffer | null> {
  try {
    const trackFolderPath = `Track/${weekFolder}`;
    const files = await listFilesInFolder(trackFolderPath);
    
    // Find the tracker file (should have "tracker" in name and be .xlsx)
    const trackerFile = files.find(f => 
      f.name.toLowerCase().includes('tracker') && 
      (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
    );
    
    if (!trackerFile) {
      console.log(`No existing tracker found in ${trackFolderPath}`);
      return null;
    }
    
    console.log(`Downloading existing tracker: ${trackerFile.name}`);
    const buffer = await readFileByPath(`${trackFolderPath}/${trackerFile.name}`);
    console.log(`Existing tracker downloaded, size: ${buffer.length} bytes`);
    
    return buffer;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`Track folder not found for week: ${weekFolder}`);
      return null;
    }
    console.error('Error downloading existing tracker:', error);
    return null;
  }
}

/**
 * Generate or update tracker Excel workbook
 */
export async function generateOrUpdateTrackerExcel(
  report: DailyReport,
  supervisorName: string,
  existingBuffer?: Buffer | null
): Promise<{ buffer: Buffer; fileName: string }> {
  // Load workbook (either existing or from template)
  let workbook: any;
  
  if (existingBuffer) {
    console.log('Loading existing tracker workbook...');
    workbook = await XlsxPopulate.fromDataAsync(existingBuffer);
  } else {
    console.log('Loading tracker template...');
    const templateBuffer = await loadTrackerTemplateBuffer();
    workbook = await XlsxPopulate.fromDataAsync(templateBuffer);
  }
  
  // Get labor lines for this report
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  console.log(`Found ${laborLines.length} labor lines for report ${report.id}`);
  
  // Determine which sheet to use based on day of week
  const dayName = getDayName(new Date(report.reportDate));
  console.log(`Report date: ${report.reportDate}, Day: ${dayName}`);
  
  // Find the sheet for this day
  let sheet = null;
  for (const s of workbook.sheets()) {
    if (s.name().toLowerCase() === dayName.toLowerCase()) {
      sheet = s;
      break;
    }
  }
  
  if (!sheet) {
    throw new Error(`Sheet for day "${dayName}" not found in tracker workbook`);
  }
  
  console.log(`Using sheet: "${sheet.name()}"`);
  
  // Find next available project block in this sheet
  const blockStartRow = findNextProjectBlock(sheet);
  console.log(`Next available project block starts at row ${blockStartRow}`);
  
  // Parse report date for display
  const reportDate = new Date(report.reportDate);
  const formattedDate = formatDate(reportDate);
  
  // Fill header section
  sheet.cell(`C${blockStartRow}`).value(formattedDate); // Date at C{startRow}
  sheet.cell(`F${blockStartRow}`).value(supervisorName); // Person entering at F{startRow}
  sheet.cell(`C${blockStartRow + 2}`).value(report.projectName || ''); // Project name at C{startRow+2}
  sheet.cell(`G${blockStartRow + 2}`).value(supervisorName); // RTA Rep at G{startRow+2}
  
  console.log(`Header written - Date: ${formattedDate}, Project: ${report.projectName}, Supervisor: ${supervisorName}`);
  
  // Fill crew section (rows startRow+4 to startRow+15, which is 12 rows for crew)
  const crewStartRow = blockStartRow + 4;
  
  for (let i = 0; i < Math.min(laborLines.length, 12); i++) {
    const line = laborLines[i];
    const row = crewStartRow + i;
    
    const totalHours = (line.regularHours || 0) + (line.otHours || 0) + (line.dtHours || 0);
    
    sheet.cell(`B${row}`).value(line.employeeName || ''); // Employee name
    sheet.cell(`C${row}`).value(line.startTime || ''); // Start time
    sheet.cell(`D${row}`).value(line.endTime || ''); // End time
    sheet.cell(`E${row}`).value(totalHours); // Total hours
    sheet.cell(`F${row}`).value(line.skillName || ''); // Skill
    sheet.cell(`G${row}`).value(line.workDescription || ''); // Work description
    
    console.log(`Crew row ${row}: ${line.employeeName}, ${line.startTime}-${line.endTime}, ${totalHours}hrs`);
  }
  
  if (laborLines.length > 12) {
    console.warn(`Report has ${laborLines.length} labor lines, but only 12 can fit in one project block`);
  }
  
  // Generate output buffer
  const outputBuffer = await workbook.outputAsync() as Buffer;
  console.log(`Tracker buffer generated, size: ${outputBuffer.length} bytes`);
  
  // Generate filename based on week folder
  const weekFolder = report.weekFolder || getWeekFolderName(reportDate);
  const fileName = `Tracker_${weekFolder.replace(/\s+/g, '_')}.xlsx`;
  
  return {
    buffer: outputBuffer,
    fileName,
  };
}

/**
 * Upload tracker to SharePoint Track folder
 */
export async function uploadTrackerToSharePoint(
  weekFolder: string,
  trackerBuffer: Buffer,
  fileName: string
): Promise<{ fileId: string; webUrl: string }> {
  // Get or create Track folder structure
  const trackRoot = await getOrCreateFolder('root', 'Track');
  const weekFolderObj = await getOrCreateFolder(trackRoot.folderId, weekFolder);
  
  // Upload the tracker
  const result = await uploadFile(weekFolderObj.folderId, fileName, trackerBuffer);
  console.log(`Uploaded Tracker to: ${result.webUrl}`);
  
  return result;
}
