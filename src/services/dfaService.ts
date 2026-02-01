import XlsxTemplate from 'xlsx-template';
import ExcelJS from 'exceljs';
import { DailyReport } from '../types/database';
import { ReportLaborLineRepository, ReportEquipmentLineRepository, DailyReportRepository } from '../repositories';
import { readFileByPath, listFilesInFolder, uploadFile, getOrCreateFolder, archiveFile, renameFile } from './sharepointService';
import * as XLSX from 'xlsx';

const DEFAULT_CONFIG_BASE_PATH = 'Umbrella Report Config';

interface SkillRate {
  name: string;
  regularRate: number;
  otRate: number;
  dtRate: number;
}

interface EquipmentRate {
  name: string;
  regularRate: number;
  otRate: number;
  dtRate: number;
}

/**
 * Load skill rates from SharePoint
 */
async function loadSkillRates(clientName: string): Promise<Map<string, SkillRate>> {
  const ratesMap = new Map<string, SkillRate>();
  
  try {
    const configFolder = `${DEFAULT_CONFIG_BASE_PATH}/${clientName}`;
    const files = await listFilesInFolder(configFolder);
    
    const excelFile = files.find(f => 
      f.name.toLowerCase().includes('skills') && 
      (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
    );
    
    if (!excelFile) {
      console.log(`No skills_rates file found for client: ${clientName}`);
      return ratesMap;
    }
    
    const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    let rowIndex = 2;
    while (true) {
      const nameCell = worksheet[`A${rowIndex}`];
      if (!nameCell || !nameCell.v) break;
      
      const name = String(nameCell.v).trim();
      const parseRate = (cell: any): number => {
        if (!cell || !cell.v) return 0;
        return parseFloat(String(cell.v).replace(/[$,]/g, '')) || 0;
      };
      
      ratesMap.set(name.toLowerCase(), {
        name,
        regularRate: parseRate(worksheet[`B${rowIndex}`]),
        otRate: parseRate(worksheet[`C${rowIndex}`]),
        dtRate: parseRate(worksheet[`D${rowIndex}`]),
      });
      rowIndex++;
    }
    
    console.log(`Loaded ${ratesMap.size} skill rates for ${clientName}`);
  } catch (error) {
    console.error('Error loading skill rates:', error);
  }
  
  return ratesMap;
}

/**
 * Load equipment rates from SharePoint
 */
async function loadEquipmentRates(clientName: string): Promise<Map<string, EquipmentRate>> {
  const ratesMap = new Map<string, EquipmentRate>();
  
  try {
    const configFolder = `${DEFAULT_CONFIG_BASE_PATH}/${clientName}`;
    const files = await listFilesInFolder(configFolder);
    
    const excelFile = files.find(f => 
      f.name.toLowerCase().includes('equipment') && 
      f.name.toLowerCase().includes('rate') &&
      (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
    );
    
    if (!excelFile) {
      console.log(`No equipment_rates file found for client: ${clientName}`);
      return ratesMap;
    }
    
    const buffer = await readFileByPath(`${configFolder}/${excelFile.name}`);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    let rowIndex = 2;
    while (true) {
      const nameCell = worksheet[`A${rowIndex}`];
      if (!nameCell || !nameCell.v) break;
      
      const name = String(nameCell.v).trim();
      const parseRate = (cell: any): number => {
        if (!cell || !cell.v) return 0;
        return parseFloat(String(cell.v).replace(/[$,]/g, '')) || 0;
      };
      
      ratesMap.set(name.toLowerCase(), {
        name,
        regularRate: parseRate(worksheet[`B${rowIndex}`]),
        otRate: parseRate(worksheet[`C${rowIndex}`]),
        dtRate: parseRate(worksheet[`D${rowIndex}`]),
      });
      rowIndex++;
    }
    
    console.log(`Loaded ${ratesMap.size} equipment rates for ${clientName}`);
  } catch (error) {
    console.error('Error loading equipment rates:', error);
  }
  
  return ratesMap;
}

/**
 * Load DFA template from SharePoint
 */
async function loadDfaTemplateBuffer(clientName: string): Promise<Buffer> {
  const configFolder = `${DEFAULT_CONFIG_BASE_PATH}/${clientName}`;
  console.log(`Looking for DFA template in: ${configFolder}`);
  
  const files = await listFilesInFolder(configFolder);
  console.log(`Found ${files.length} files:`, files.map(f => f.name));
  
  const templateFile = files.find(f => 
    f.name.toLowerCase().includes('dfa') && 
    f.name.toLowerCase().includes('template') &&
    (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
  );
  
  if (!templateFile) {
    throw new Error(`No DFA template found for client: ${clientName}. Files found: ${files.map(f => f.name).join(', ')}`);
  }
  
  console.log(`Loading DFA template: ${templateFile.name}`);
  const buffer = await readFileByPath(`${configFolder}/${templateFile.name}`);
  console.log(`Template loaded, size: ${buffer.length} bytes`);
  
  return buffer;
}

/**
 * Generate DFA number
 */
/**
 * Get sequential DFA number for a project
 * Counts existing reports for the client/project and returns next number
 */
async function getSequentialDfaNumber(clientName: string, projectName: string): Promise<number> {
  const existingReports = await DailyReportRepository.findByClientProject(clientName, projectName);
  return existingReports.length;
}

/**
 * Format date as "Jan 31, 2026"
 */
function formatDateForDfa(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Generate filled DFA Excel from template using xlsx-template
 */
export async function generateDfaExcel(
  report: DailyReport,
  _supervisorName: string
): Promise<{ buffer: Buffer; fileName: string; dfaNumber: string; totalCost: number }> {
  if (!report.clientName || !report.projectName) {
    throw new Error('Report must have a client name and project name');
  }
  
  // Get sequential DFA number for this project
  const sequentialNumber = await getSequentialDfaNumber(report.clientName, report.projectName);
  const dfaNumber = `DFA-${sequentialNumber}`;
  
  // Load template and rates
  const [templateBuffer, skillRates, equipmentRates] = await Promise.all([
    loadDfaTemplateBuffer(report.clientName),
    loadSkillRates(report.clientName),
    loadEquipmentRates(report.clientName),
  ]);
  
  // Get labor and equipment lines
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  const equipmentLines = await ReportEquipmentLineRepository.findByReportId(report.id);
  
  // Format date for display in Excel (MM/DD/YYYY) - use Pacific timezone
  const reportDate = new Date(report.reportDate);
  const pacificDate = new Date(reportDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const formattedDate = `${pacificDate.getMonth() + 1}/${pacificDate.getDate()}/${pacificDate.getFullYear()}`;
  
  // Format date for filename (Jan 31, 2026)
  const formattedDateForFilename = formatDateForDfa(pacificDate);
  
  // Calculate labor data with costs
  let totalLaborCost = 0;
  const labor = laborLines.slice(0, 9).map(line => {
    const rate = skillRates.get((line.skillName || '').toLowerCase());
    const rgCost = rate ? line.regularHours * rate.regularRate : 0;
    const otCost = rate ? line.otHours * rate.otRate : 0;
    const dtCost = rate ? line.dtHours * rate.dtRate : 0;
    const lineTotalCost = rgCost + otCost + dtCost;
    totalLaborCost += lineTotalCost;
    
    return {
      employeeName: line.employeeName || '',
      skillName: line.skillName || '',
      regularHours: line.regularHours || 0,
      otHours: line.otHours || 0,
      dtHours: line.dtHours || 0,
      rgCost,
      otCost,
      dtCost,
      totalCost: lineTotalCost,
    };
  });
  
  // Pad labor array to 9 rows for template
  while (labor.length < 9) {
    labor.push({
      employeeName: '',
      skillName: '',
      regularHours: 0,
      otHours: 0,
      dtHours: 0,
      rgCost: 0,
      otCost: 0,
      dtCost: 0,
      totalCost: 0,
    });
  }
  
  // Calculate equipment data with costs
  let totalEquipmentCost = 0;
  const equipment = equipmentLines.slice(0, 5).map(line => {
    const rate = equipmentRates.get((line.equipmentName || '').toLowerCase());
    const cost = rate ? rate.regularRate : 0;
    const lineTotalCost = line.hoursUsed * cost;
    totalEquipmentCost += lineTotalCost;
    
    return {
      equipmentName: line.equipmentName || '',
      hoursUsed: line.hoursUsed || 0,
      rate: cost,
      totalCost: lineTotalCost,
    };
  });
  
  // Pad equipment array to 5 rows for template
  while (equipment.length < 5) {
    equipment.push({
      equipmentName: '',
      hoursUsed: 0,
      rate: 0,
      totalCost: 0,
    });
  }
  
  const totalCost = totalLaborCost + totalEquipmentCost;
  
  // Create template and substitute values
  const template = new XlsxTemplate(templateBuffer);
  
  // Substitute all placeholders
  template.substitute(1, {
    date: formattedDate,
    projectName: report.projectName || '',
    clientName: report.clientName,
    dfaNumber: dfaNumber,
    notes: report.notes || '',
    materials: report.materials || '',
    delays: report.delays || '',
    tomorrowsActivities: report.tomorrowsActivities || '',
    totalLaborCost: totalLaborCost,
    totalEquipmentCost: totalEquipmentCost,
    totalCost: totalCost,
    // Labor rows (individual placeholders for each row)
    labor: labor,
    // Equipment rows
    equipment: equipment,
  });
  
  // Generate the output buffer
  const outputBuffer = template.generate({ type: 'nodebuffer' }) as Buffer;
  
  console.log(`DFA buffer generated, size: ${outputBuffer.length} bytes`);
  
  // Filename format: "Jan 31, 2026 - Anode Hauling - DFA-1.xlsx"
  const fileName = `${formattedDateForFilename} - ${report.projectName} - ${dfaNumber}.xlsx`;
  
  return {
    buffer: outputBuffer,
    fileName,
    dfaNumber,
    totalCost,
  };
}

/**
 * Upload DFA to SharePoint week folder
 */
export async function uploadDfaToSharePoint(
  clientName: string,
  projectName: string,
  weekFolder: string,
  dfaBuffer: Buffer,
  fileName: string
): Promise<{ fileId: string; webUrl: string }> {
  // Get or create the folder structure
  const projectsRoot = await getOrCreateFolder('root', 'projects');
  const clientFolder = await getOrCreateFolder(projectsRoot.folderId, clientName);
  const projectFolder = await getOrCreateFolder(clientFolder.folderId, projectName);
  const weekFolderObj = await getOrCreateFolder(projectFolder.folderId, weekFolder);
  
  // Upload the DFA
  const result = await uploadFile(weekFolderObj.folderId, fileName, dfaBuffer);
  console.log(`Uploaded DFA to: ${result.webUrl}`);
  
  return result;
}

/**
 * Generate aggregate report for a project (all DFAs)
 */
export async function generateAggregateReport(
  clientName: string,
  projectName: string,
  reports: DailyReport[]
): Promise<{ buffer: Buffer; fileName: string }> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DFA Summary');
  
  // Load rates
  const [skillRates, equipmentRates] = await Promise.all([
    loadSkillRates(clientName),
    loadEquipmentRates(clientName),
  ]);
  
  // Set up columns
  sheet.columns = [
    { header: 'DFA #', key: 'dfaNumber', width: 20 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Project', key: 'project', width: 25 },
    { header: 'Labor Cost', key: 'laborCost', width: 15 },
    { header: 'Equipment Cost', key: 'equipmentCost', width: 15 },
    { header: 'Total Cost', key: 'totalCost', width: 15 },
  ];
  
  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  let grandTotalLabor = 0;
  let grandTotalEquipment = 0;
  
  // Sort reports by date to ensure consistent DFA numbering
  const sortedReports = [...reports].sort((a, b) => 
    new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime()
  );
  
  // Process each report
  for (let idx = 0; idx < sortedReports.length; idx++) {
    const report = sortedReports[idx];
    const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
    const equipmentLines = await ReportEquipmentLineRepository.findByReportId(report.id);
    
    // Calculate labor costs
    let laborCost = 0;
    for (const line of laborLines) {
      const rate = skillRates.get((line.skillName || '').toLowerCase());
      if (rate) {
        laborCost += line.regularHours * rate.regularRate;
        laborCost += line.otHours * rate.otRate;
        laborCost += line.dtHours * rate.dtRate;
      }
    }
    
    // Calculate equipment costs
    let equipmentCost = 0;
    for (const line of equipmentLines) {
      const rate = equipmentRates.get((line.equipmentName || '').toLowerCase());
      if (rate) {
        equipmentCost += line.hoursUsed * rate.regularRate;
      }
    }
    
    // Use sequential DFA number (1-based index)
    const dfaNumber = `DFA-${idx + 1}`;
    const reportDate = new Date(report.reportDate);
    const formattedDate = formatDateForDfa(reportDate);
    
    sheet.addRow({
      dfaNumber: `${formattedDate} - ${report.projectName} - ${dfaNumber}`,
      date: `${reportDate.getMonth() + 1}/${reportDate.getDate()}/${reportDate.getFullYear()}`,
      project: report.projectName,
      laborCost,
      equipmentCost,
      totalCost: laborCost + equipmentCost,
    });
    
    grandTotalLabor += laborCost;
    grandTotalEquipment += equipmentCost;
  }
  
  // Add totals row
  const totalsRow = sheet.addRow({
    dfaNumber: 'TOTALS',
    date: '',
    project: '',
    laborCost: grandTotalLabor,
    equipmentCost: grandTotalEquipment,
    totalCost: grandTotalLabor + grandTotalEquipment,
  });
  totalsRow.font = { bold: true };
  totalsRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFCCCCCC' },
  };
  
  // Format currency columns
  sheet.getColumn('laborCost').numFmt = '$#,##0.00';
  sheet.getColumn('equipmentCost').numFmt = '$#,##0.00';
  sheet.getColumn('totalCost').numFmt = '$#,##0.00';
  
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `${clientName}_${projectName}_DFA_Aggregate.xlsx`;
  
  return {
    buffer: Buffer.from(buffer),
    fileName,
  };
}

/**
 * Upload aggregate report to project folder (not week folder)
 */
export async function uploadAggregateToSharePoint(
  clientName: string,
  projectName: string,
  aggregateBuffer: Buffer,
  fileName: string
): Promise<{ fileId: string; webUrl: string }> {
  // Get or create the folder structure - upload to project folder, not week
  const projectsRoot = await getOrCreateFolder('root', 'projects');
  const clientFolder = await getOrCreateFolder(projectsRoot.folderId, clientName);
  const projectFolder = await getOrCreateFolder(clientFolder.folderId, projectName);
  
  // Upload the aggregate to project folder
  const result = await uploadFile(projectFolder.folderId, fileName, aggregateBuffer);
  console.log(`Uploaded aggregate report to: ${result.webUrl}`);
  
  return result;
}

/**
 * Archive a DFA when report is deleted
 * Moves the DFA from the week folder to Archive folder under the project
 * Adds "(Old)" to the filename and renumbers remaining DFAs
 */
export async function archiveDfaToSharePoint(
  report: DailyReport
): Promise<void> {
  try {
    if (!report.clientName || !report.projectName || !report.weekFolder) {
      console.log('Report missing client/project/week info, skipping DFA archive');
      return;
    }
    
    // Format date to match the filename format used when uploading
    const reportDate = new Date(report.reportDate);
    const formattedDate = formatDateForDfa(reportDate);
    
    // The DFA filename starts with "Jan 31, 2026 - ProjectName - DFA-"
    const filePrefix = `${formattedDate} - ${report.projectName} - DFA-`;
    
    // Get the week folder and find the DFA file
    const weekFolderPath = `projects/${report.clientName}/${report.projectName}/${report.weekFolder}`;
    const files = await listFilesInFolder(weekFolderPath);
    
    // Find files that match this report's date and project
    const dfaFile = files.find(f => f.name.startsWith(filePrefix) && f.name.endsWith('.xlsx'));
    
    if (!dfaFile) {
      console.log(`DFA file not found in SharePoint with prefix: ${filePrefix}`);
      return;
    }
    
    // Get or create Archive folder under the project
    const projectsRoot = await getOrCreateFolder('root', 'projects');
    const clientFolder = await getOrCreateFolder(projectsRoot.folderId, report.clientName);
    const projectFolder = await getOrCreateFolder(clientFolder.folderId, report.projectName);
    const archiveFolder = await getOrCreateFolder(projectFolder.folderId, 'Archive');
    
    // Create new filename with "(Old)" suffix
    // "Jan 31, 2026 - Anode Hauling - DFA-1.xlsx" -> "Jan 31, 2026 - Anode Hauling - DFA-1 (Old).xlsx"
    const newFileName = dfaFile.name.replace('.xlsx', ' (Old).xlsx');
    
    // Move the DFA to Archive folder with "(Old)" suffix
    await archiveFile(dfaFile.id, archiveFolder.folderId, newFileName);
    
    console.log(`Archived DFA ${dfaFile.name} as ${newFileName}`);
    
    // Now renumber all remaining DFAs for this project
    await renumberProjectDfas(report.clientName, report.projectName);
    
  } catch (error: any) {
    // Re-throw FILE_LOCKED error so it can be handled by the route
    if (error.message === 'FILE_LOCKED') {
      throw error;
    }
    console.error('Error archiving DFA:', error);
    // Don't throw for other errors - we still want the report delete to succeed
  }
}

/**
 * Renumber all DFAs in a project after one is deleted
 * Finds all DFA files across all week folders and renumbers them sequentially by date
 */
async function renumberProjectDfas(
  clientName: string,
  projectName: string
): Promise<void> {
  try {
    // Get all remaining reports for this project (sorted by date)
    const reports = await DailyReportRepository.findByClientProject(clientName, projectName);
    const sortedReports = reports.sort((a, b) => 
      new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime()
    );
    
    console.log(`Renumbering ${sortedReports.length} DFAs for ${clientName}/${projectName}`);
    
    // For each report, find and rename its DFA
    for (let i = 0; i < sortedReports.length; i++) {
      const report = sortedReports[i];
      if (!report.weekFolder) continue;
      
      const reportDate = new Date(report.reportDate);
      const formattedDate = formatDateForDfa(reportDate);
      const expectedNumber = i + 1; // 1-based
      
      // Find the DFA file in the week folder
      const weekFolderPath = `projects/${clientName}/${projectName}/${report.weekFolder}`;
      const files = await listFilesInFolder(weekFolderPath);
      
      // Look for a DFA file matching this date and project
      const filePrefix = `${formattedDate} - ${projectName} - DFA-`;
      const dfaFile = files.find(f => f.name.startsWith(filePrefix) && f.name.endsWith('.xlsx') && !f.name.includes('(Old)'));
      
      if (!dfaFile) {
        console.log(`DFA file not found for report ${report.id} in ${weekFolderPath}`);
        continue;
      }
      
      // Extract current DFA number from filename
      const match = dfaFile.name.match(/DFA-(\d+)\.xlsx$/);
      if (!match) continue;
      
      const currentNumber = parseInt(match[1], 10);
      
      // Only rename if number needs to change
      if (currentNumber !== expectedNumber) {
        const newFileName = `${formattedDate} - ${projectName} - DFA-${expectedNumber}.xlsx`;
        await renameFile(dfaFile.id, newFileName);
        console.log(`Renamed ${dfaFile.name} to ${newFileName}`);
      }
    }
    
    console.log('DFA renumbering complete');
  } catch (error) {
    console.error('Error renumbering DFAs:', error);
    // Don't throw - this is a best-effort operation
  }
}
