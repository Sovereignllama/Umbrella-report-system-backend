import { DailyReport } from '../types/database';
import { ReportLaborLineRepository } from '../repositories';
import { 
  readFileByPath, 
  listFilesInFolder, 
  uploadFile, 
  getOrCreateFolder,
  getFileItemId,
  readExcelRange,
  batchUpdateExcelRanges
} from './sharepointService';



const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';
const MAX_CREW_ROWS = 12; // Maximum crew members per project block
const MAX_SHEET_ROWS = 200; // Safety limit for scanning rows
const PROJECT_BLOCK_SIZE = 18; // 16 rows for project + 2-row gap

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
 * Get day name for sheet selection
 */
function getDaySheetName(reportDate: Date): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const day = reportDate.getDay();
  // Convert JavaScript day (0=Sunday) to our index (0=Monday)
  const index = day === 0 ? 6 : day - 1;
  return days[index];
}

/**
 * Format week folder name for file naming (replace spaces with underscores)
 */
function formatWeekName(weekFolder: string): string {
  return weekFolder.replace(/\s+/g, '_');
}

/**
 * Format date as MM/DD/YYYY
 */
function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Find the next available project block in a sheet using Graph API
 * Returns the starting row number for the next project (where the date/header goes)
 */
async function findNextProjectBlock(itemId: string, sheetName: string): Promise<number> {
  // First project block starts at row 2
  // Each block is: header (2 rows) + project info (2 rows) + crew (12 rows) = 16 rows
  // Plus 2-row gap before next block
  // So blocks start at: 2, 20, 38, 56, etc.
  
  let currentRow = 2;
  
  while (currentRow <= MAX_SHEET_ROWS) {
    // Check if the project name cell (C + offset 2) is empty
    const checkCell = `C${currentRow + 2}`;
    
    try {
      const values = await readExcelRange(itemId, sheetName, checkCell);
      
      // Check if cell is empty
      if (!values || values.length === 0 || !values[0] || !values[0][0] || values[0][0] === '') {
        // Found an empty block
        return currentRow;
      }
    } catch (error) {
      // If we can't read the cell, assume it's empty
      console.warn(`Could not read cell ${checkCell}, assuming empty`);
      return currentRow;
    }
    
    // Move to next potential block
    currentRow += PROJECT_BLOCK_SIZE;
  }
  
  console.warn('Reached row limit while searching for empty project block');
  return currentRow;
}

/**
 * Build cell updates for tracker from report data
 */
function buildTrackerCellUpdates(
  report: DailyReport,
  supervisorName: string,
  laborLines: any[],
  sheetName: string,
  startRow: number
): Array<{ sheetName: string; rangeAddress: string; values: any[][] }> {
  const updates: Array<{ sheetName: string; rangeAddress: string; values: any[][] }> = [];
  
  // Format report date
  const reportDate = report.reportDate instanceof Date ? report.reportDate : new Date(report.reportDate);
  const formattedDate = formatDate(reportDate);
  
  // Header section updates
  updates.push({
    sheetName,
    rangeAddress: `C${startRow}`,
    values: [[formattedDate]]
  });
  
  updates.push({
    sheetName,
    rangeAddress: `F${startRow}`,
    values: [[supervisorName]]
  });
  
  updates.push({
    sheetName,
    rangeAddress: `C${startRow + 2}`,
    values: [[report.projectName || '']]
  });
  
  updates.push({
    sheetName,
    rangeAddress: `G${startRow + 2}`,
    values: [[supervisorName]]
  });
  
  // Crew section (rows startRow+4 to startRow+15)
  if (laborLines.length > 0) {
    const crewStartRow = startRow + 4;
    const crewData: any[][] = [];
    
    for (let i = 0; i < Math.min(laborLines.length, MAX_CREW_ROWS); i++) {
      const line = laborLines[i];
      const totalHours = parseFloat(String(line.regularHours || 0)) + 
                        parseFloat(String(line.otHours || 0)) + 
                        parseFloat(String(line.dtHours || 0));
      
      crewData.push([
        line.employeeName || '',       // Column B
        line.startTime || '',           // Column C
        line.endTime || '',             // Column D
        totalHours,                     // Column E
        line.skillName || '',           // Column F
        line.workDescription || ''      // Column G
      ]);
    }
    
    // Batch update crew section as a single range if there are crew members
    if (crewData.length > 0) {
      const endRow = crewStartRow + crewData.length - 1;
      updates.push({
        sheetName,
        rangeAddress: `B${crewStartRow}:G${endRow}`,
        values: crewData
      });
    }
  }
  
  return updates;
}

/**
 * Generate week folder name from report date (e.g., "Feb 9th - Feb 15th")
 * This should match the weekFolder format passed from frontend
 */
export function getWeekFolderName(reportDate: Date): string {
  // Get Monday of the week (create new Date to avoid mutation)
  const monday = new Date(reportDate);
  const day = monday.getDay();
  const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
  monday.setDate(diff);
  
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
 * Generate and upload tracker using Microsoft Graph Workbooks API
 * This function writes directly to cells without downloading/uploading the entire file
 */
export async function generateAndUploadTracker(
  report: DailyReport,
  supervisorName: string,
  weekFolder: string
): Promise<void> {
  console.log(`Starting tracker update for report ${report.id}, week: ${weekFolder}`);
  
  // 1. Determine tracker file path and name
  const trackerFileName = `Tracker_${formatWeekName(weekFolder)}.xlsx`;
  const trackerPath = `Track/${weekFolder}/${trackerFileName}`;
  
  // 2. Check if tracker already exists in SharePoint
  let itemId = await getFileItemId(trackerPath);
  
  // 3. If not, upload a fresh template
  if (!itemId) {
    console.log('Tracker does not exist, uploading fresh template...');
    const templateBuffer = await loadTrackerTemplateBuffer();
    const trackRoot = await getOrCreateFolder('root', 'Track');
    const weekFolderObj = await getOrCreateFolder(trackRoot.folderId, weekFolder);
    const uploadResult = await uploadFile(weekFolderObj.folderId, trackerFileName, templateBuffer);
    itemId = uploadResult.fileId;
    
    console.log(`Template uploaded with item ID: ${itemId}`);
    
    // Wait briefly for SharePoint to process the file before making Workbooks API calls
    await new Promise(resolve => setTimeout(resolve, 2000));
  } else {
    console.log(`Tracker already exists with item ID: ${itemId}`);
  }
  
  // 4. Get the correct sheet name for this day
  const reportDate = report.reportDate instanceof Date ? report.reportDate : new Date(report.reportDate);
  const sheetName = getDaySheetName(reportDate);
  console.log(`Using sheet: ${sheetName} for date: ${reportDate.toISOString()}`);
  
  // 5. Find next available project block by reading the sheet
  const startRow = await findNextProjectBlock(itemId, sheetName);
  console.log(`Next available project block starts at row ${startRow}`);
  
  // 6. Get labor lines
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  console.log(`Found ${laborLines.length} labor lines for report ${report.id}`);
  
  if (laborLines.length > MAX_CREW_ROWS) {
    console.warn(`Report has ${laborLines.length} labor lines, but only ${MAX_CREW_ROWS} can fit in one project block`);
  }
  
  // 7. Build cell updates
  const updates = buildTrackerCellUpdates(
    report,
    supervisorName,
    laborLines,
    sheetName,
    startRow
  );
  
  console.log(`Prepared ${updates.length} cell range updates`);
  
  // 8. Write cells via Graph Workbooks API (batched)
  await batchUpdateExcelRanges(itemId, updates);
  
  console.log(`Tracker updated successfully for week: ${weekFolder}`);
}
