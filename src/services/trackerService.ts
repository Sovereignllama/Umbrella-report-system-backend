import { DailyReport, ReportLaborLine, ReportEquipmentLine } from '../types/database';
import { ReportLaborLineRepository, ReportEquipmentLineRepository } from '../repositories';
import { 
  readFileByPath, 
  listFilesInFolder, 
  uploadFile, 
  getOrCreateFolder,
  getFileItemId,
  readExcelRange,
  batchUpdateExcelRanges
} from './sharepointService';

// Main drive ID for tracker files (uploaded to Shared Documents)
const SHAREPOINT_MAIN_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;



const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';
const MAX_CREW_ROWS = 12; // Maximum crew members per project block
const MAX_EQUIPMENT_ROWS = 12; // Maximum equipment items per project block
const MAX_SHEET_ROWS = 200; // Safety limit for scanning rows
const PROJECT_BLOCK_SIZE = 18; // 16 rows for project + 2-row gap
const CREW_COLUMN_COUNT = 6; // Columns B-G for crew data
const EQUIPMENT_COLUMN_COUNT = 2; // Columns K-L for equipment data
// SharePoint file processing delay to ensure Workbooks API readiness after template upload
// This delay allows SharePoint to fully index and process the Excel file before making Workbooks API calls
const SHAREPOINT_PROCESSING_DELAY_MS = 2000; // 2 seconds based on empirical testing

/**
 * Calculate total hours from regular, OT, and DT hours
 */
function calculateTotalHours(line: ReportLaborLine): number {
  return (Number(line.regularHours) || 0) + 
         (Number(line.otHours) || 0) + 
         (Number(line.dtHours) || 0);
}

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
 * Format date as MM/DD/YYYY (with zero-padding)
 */
function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Find an existing project block in a sheet by project name (case-insensitive)
 * Returns the starting row number if found, null otherwise
 */
async function findExistingProjectBlock(
  itemId: string, 
  sheetName: string, 
  projectName: string
): Promise<number | null> {
  // Normalize project name for case-insensitive comparison
  const normalizedProjectName = projectName.toLowerCase().trim();
  
  let currentRow = 2;
  
  while (currentRow <= MAX_SHEET_ROWS) {
    // Check the project name cell (C + offset 2)
    const checkCell = `C${currentRow + 2}`;
    
    try {
      const values = await readExcelRange(itemId, sheetName, checkCell, SHAREPOINT_MAIN_DRIVE_ID!);
      
      // Check if cell has a value
      if (values && values.length > 0 && values[0] && values[0][0]) {
        const cellValue = String(values[0][0]).toLowerCase().trim();
        
        // If project name matches, return this row
        if (cellValue === normalizedProjectName) {
          console.log(`Found existing project "${projectName}" at row ${currentRow}`);
          return currentRow;
        }
      } else {
        // Hit an empty block, stop searching
        break;
      }
    } catch (error: any) {
      // Treat 404 errors as end of data
      if (error.response?.status === 404) {
        break;
      }
      // For other errors, log and propagate
      console.error(`Error reading cell ${checkCell}:`, error);
      throw error;
    }
    
    // Move to next potential block
    currentRow += PROJECT_BLOCK_SIZE;
  }
  
  console.log(`No existing project block found for "${projectName}"`);
  return null;
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
      const values = await readExcelRange(itemId, sheetName, checkCell, SHAREPOINT_MAIN_DRIVE_ID!);
      
      // Check if cell is empty
      if (!values || values.length === 0 || !values[0] || !values[0][0] || values[0][0] === '') {
        // Found an empty block
        return currentRow;
      }
    } catch (error: any) {
      // Only treat 404 errors as empty cells; propagate other errors
      if (error.response?.status === 404) {
        console.log(`No existing project at row ${currentRow}, using as next available block`);
        return currentRow;
      }
      // For other errors (network, permission, etc.), log and propagate
      console.error(`Error reading cell ${checkCell}:`, error);
      throw error;
    }
    
    // Move to next potential block
    currentRow += PROJECT_BLOCK_SIZE;
  }
  
  console.warn('Reached row limit while searching for empty project block');
  return currentRow;
}

/**
 * Clear all data cells in a project block
 * This is needed when overwriting a report that may have fewer lines than before
 */
async function clearProjectBlock(
  itemId: string,
  sheetName: string,
  startRow: number
): Promise<void> {
  const updates: Array<{ sheetName: string; rangeAddress: string; values: any[][] }> = [];
  
  // Clear crew data (B to G, 12 rows starting at startRow+4)
  const crewStartRow = startRow + 4;
  const crewEndRow = crewStartRow + MAX_CREW_ROWS - 1;
  const emptyCrewData: any[][] = [];
  for (let i = 0; i < MAX_CREW_ROWS; i++) {
    emptyCrewData.push(new Array(CREW_COLUMN_COUNT).fill('')); // 6 columns: B, C, D, E, F, G
  }
  updates.push({
    sheetName,
    rangeAddress: `B${crewStartRow}:G${crewEndRow}`,
    values: emptyCrewData
  });
  
  // Clear equipment data (K to L, 12 rows starting at startRow+4)
  const equipmentStartRow = startRow + 4;
  const equipmentEndRow = equipmentStartRow + MAX_EQUIPMENT_ROWS - 1;
  const emptyEquipmentData: any[][] = [];
  for (let i = 0; i < MAX_EQUIPMENT_ROWS; i++) {
    emptyEquipmentData.push(new Array(EQUIPMENT_COLUMN_COUNT).fill('')); // 2 columns: K, L
  }
  updates.push({
    sheetName,
    rangeAddress: `K${equipmentStartRow}:L${equipmentEndRow}`,
    values: emptyEquipmentData
  });
  
  console.log(`Clearing project block at row ${startRow}`);
  await batchUpdateExcelRanges(itemId, updates, SHAREPOINT_MAIN_DRIVE_ID!);
}

/**
 * Build cell updates for tracker from report data
 */
function buildTrackerCellUpdates(
  report: DailyReport,
  supervisorName: string,
  laborLines: ReportLaborLine[],
  equipmentLines: ReportEquipmentLine[],
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
  
  // Crew section (rows startRow+4 to startRow+15)
  if (laborLines.length > 0) {
    const crewStartRow = startRow + 4;
    const crewData: any[][] = [];
    
    for (let i = 0; i < Math.min(laborLines.length, MAX_CREW_ROWS); i++) {
      const line = laborLines[i];
      const totalHours = calculateTotalHours(line);
      
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
  
  // Equipment section (rows startRow+4 to startRow+15, columns K and L)
  if (equipmentLines.length > 0) {
    const equipmentStartRow = startRow + 4;
    const equipmentData: any[][] = [];
    
    for (let i = 0; i < Math.min(equipmentLines.length, MAX_EQUIPMENT_ROWS); i++) {
      const line = equipmentLines[i];
      
      equipmentData.push([
        line.equipmentName || '',       // Column K
        line.hoursUsed || 0             // Column L
      ]);
    }
    
    // Batch update equipment section as a single range if there are equipment items
    if (equipmentData.length > 0) {
      const endRow = equipmentStartRow + equipmentData.length - 1;
      updates.push({
        sheetName,
        rangeAddress: `K${equipmentStartRow}:L${endRow}`,
        values: equipmentData
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
  let itemId = await getFileItemId(trackerPath, SHAREPOINT_MAIN_DRIVE_ID!);
  
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
    await new Promise(resolve => setTimeout(resolve, SHAREPOINT_PROCESSING_DELAY_MS));
  } else {
    console.log(`Tracker already exists with item ID: ${itemId}`);
  }
  
  // 4. Get the correct sheet name for this day
  const reportDate = report.reportDate instanceof Date ? report.reportDate : new Date(report.reportDate);
  const sheetName = getDaySheetName(reportDate);
  console.log(`Using sheet: ${sheetName} for date: ${reportDate.toISOString()}`);
  
  // 5. Check for existing project block first, then find next available if not found
  let startRow: number;
  const existingRow = await findExistingProjectBlock(itemId, sheetName, report.projectName || '');
  
  if (existingRow !== null) {
    // Found existing project block - clear it before writing new data
    console.log(`Overwriting existing project block at row ${existingRow}`);
    await clearProjectBlock(itemId, sheetName, existingRow);
    startRow = existingRow;
  } else {
    // No existing block found - use next available empty block
    startRow = await findNextProjectBlock(itemId, sheetName);
    console.log(`Using next available project block at row ${startRow}`);
  }
  
  // 6. Get labor lines
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  console.log(`Found ${laborLines.length} labor lines for report ${report.id}`);
  
  if (laborLines.length > MAX_CREW_ROWS) {
    console.warn(`Report has ${laborLines.length} labor lines, but only ${MAX_CREW_ROWS} can fit in one project block`);
  }
  
  // 7. Get equipment lines
  const equipmentLines = await ReportEquipmentLineRepository.findByReportId(report.id);
  console.log(`Found ${equipmentLines.length} equipment lines for report ${report.id}`);
  
  if (equipmentLines.length > MAX_EQUIPMENT_ROWS) {
    console.warn(`Report has ${equipmentLines.length} equipment lines, but only ${MAX_EQUIPMENT_ROWS} can fit in one project block`);
  }
  
  // 8. Build cell updates
  const updates = buildTrackerCellUpdates(
    report,
    supervisorName,
    laborLines,
    equipmentLines,
    sheetName,
    startRow
  );
  
  console.log(`Prepared ${updates.length} cell range updates`);
  
  // 9. Write cells via Graph Workbooks API (batched)
  await batchUpdateExcelRanges(itemId, updates, SHAREPOINT_MAIN_DRIVE_ID!);
  
  console.log(`Tracker updated successfully for week: ${weekFolder}`);
}
