import ExcelJS from 'exceljs';
import { DailyReport } from '../types/database';
import { ReportLaborLineRepository, ReportEquipmentLineRepository } from '../repositories';
import { readFileByPath, listFilesInFolder, uploadFile, getOrCreateFolder, archiveFile } from './sharepointService';
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
async function loadDfaTemplate(clientName: string): Promise<ExcelJS.Workbook> {
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
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  console.log(`Workbook loaded, sheets: ${workbook.worksheets.map(s => s.name).join(', ')}`);
  
  return workbook;
}

/**
 * Generate DFA number
 */
function generateDfaNumber(clientName: string, reportDate: Date, reportId: string): string {
  const year = reportDate.getFullYear();
  const month = String(reportDate.getMonth() + 1).padStart(2, '0');
  const day = String(reportDate.getDate()).padStart(2, '0');
  const shortId = reportId.substring(0, 4).toUpperCase();
  return `${clientName}-${year}${month}${day}-${shortId}`;
}

/**
 * Generate filled DFA Excel from template
 */
export async function generateDfaExcel(
  report: DailyReport,
  _supervisorName: string
): Promise<{ buffer: Buffer; fileName: string; dfaNumber: string; totalCost: number }> {
  if (!report.clientName) {
    throw new Error('Report must have a client name');
  }
  
  // Load template and rates
  const [workbook, skillRates, equipmentRates] = await Promise.all([
    loadDfaTemplate(report.clientName),
    loadSkillRates(report.clientName),
    loadEquipmentRates(report.clientName),
  ]);
  
  // Get labor and equipment lines
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  const equipmentLines = await ReportEquipmentLineRepository.findByReportId(report.id);
  
  const sheet = workbook.worksheets[0];
  const dfaNumber = generateDfaNumber(report.clientName, new Date(report.reportDate), report.id);
  
  // Format date
  const reportDate = new Date(report.reportDate);
  const formattedDate = `${reportDate.getMonth() + 1}/${reportDate.getDate()}/${reportDate.getFullYear()}`;
  
  // Fill header cells (based on template layout)
  // Row 1: Date (H1), Job Name (H2), Client (H3), DFA Number (H5)
  sheet.getCell('H1').value = formattedDate;
  sheet.getCell('H2').value = report.projectName || '';
  sheet.getCell('H3').value = report.clientName;
  sheet.getCell('H5').value = dfaNumber;
  
  // Description of Work Completed (Row 9-17 merged area)
  sheet.getCell('A9').value = report.notes || '';
  
  // Calculate labor costs and fill Work Completed By section (starting row 20)
  let laborStartRow = 20;
  let totalLaborCost = 0;
  
  for (let i = 0; i < laborLines.length && i < 9; i++) {
    const line = laborLines[i];
    const rate = skillRates.get((line.skillName || '').toLowerCase());
    
    const rgCost = rate ? line.regularHours * rate.regularRate : 0;
    const otCost = rate ? line.otHours * rate.otRate : 0;
    const dtCost = rate ? line.dtHours * rate.dtRate : 0;
    const lineTotalCost = rgCost + otCost + dtCost;
    totalLaborCost += lineTotalCost;
    
    const row = laborStartRow + i;
    sheet.getCell(`A${row}`).value = line.employeeName || '';
    sheet.getCell(`B${row}`).value = line.skillName || '';
    sheet.getCell(`C${row}`).value = line.regularHours || 0;
    sheet.getCell(`D${row}`).value = line.otHours || 0;
    sheet.getCell(`E${row}`).value = line.dtHours || 0;
    sheet.getCell(`F${row}`).value = rgCost;
    sheet.getCell(`G${row}`).value = otCost;
    sheet.getCell(`H${row}`).value = dtCost;
    sheet.getCell(`I${row}`).value = lineTotalCost;
  }
  
  // Equipment section (starting row 32)
  let equipmentStartRow = 32;
  let totalEquipmentCost = 0;
  
  for (let i = 0; i < equipmentLines.length && i < 5; i++) {
    const line = equipmentLines[i];
    const rate = equipmentRates.get((line.equipmentName || '').toLowerCase());
    
    const cost = rate ? rate.regularRate : 0;
    const lineTotalCost = line.hoursUsed * cost;
    totalEquipmentCost += lineTotalCost;
    
    const row = equipmentStartRow + i;
    sheet.getCell(`B${row}`).value = line.equipmentName || '';
    sheet.getCell(`C${row}`).value = line.hoursUsed || 0;
    sheet.getCell(`D${row}`).value = cost;
    sheet.getCell(`E${row}`).value = lineTotalCost;
  }
  
  // Materials (Row 39-44 area)
  sheet.getCell('B39').value = report.materials || '';
  
  // Delays and Safety Concerns (Row 47-50 area)
  sheet.getCell('A47').value = report.delays || '';
  
  // DFA Total (cell near row 46)
  const totalCost = totalLaborCost + totalEquipmentCost;
  sheet.getCell('H46').value = totalCost;
  
  // Tomorrows Planned Activities (Row 52-56 area)
  sheet.getCell('A52').value = report.tomorrowsActivities || '';
  
  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `DFA_${dfaNumber}.xlsx`;
  
  return {
    buffer: Buffer.from(buffer),
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
  
  // Process each report
  for (const report of reports) {
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
    
    const dfaNumber = generateDfaNumber(clientName, new Date(report.reportDate), report.id);
    const reportDate = new Date(report.reportDate);
    
    sheet.addRow({
      dfaNumber,
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
 */
export async function archiveDfaToSharePoint(
  report: DailyReport
): Promise<void> {
  try {
    if (!report.clientName || !report.projectName || !report.weekFolder) {
      console.log('Report missing client/project/week info, skipping DFA archive');
      return;
    }
    
    // Generate the DFA filename to find it
    const dfaNumber = generateDfaNumber(report.clientName, new Date(report.reportDate), report.id);
    const dfaFileName = `DFA_${dfaNumber}.xlsx`;
    
    // Get the week folder and find the DFA file
    const weekFolderPath = `projects/${report.clientName}/${report.projectName}/${report.weekFolder}`;
    const files = await listFilesInFolder(weekFolderPath);
    
    const dfaFile = files.find(f => f.name === dfaFileName);
    
    if (!dfaFile) {
      console.log(`DFA file not found in SharePoint: ${dfaFileName}`);
      return;
    }
    
    // Get or create Archive folder under the project
    const projectsRoot = await getOrCreateFolder('root', 'projects');
    const clientFolder = await getOrCreateFolder(projectsRoot.folderId, report.clientName);
    const projectFolder = await getOrCreateFolder(clientFolder.folderId, report.projectName);
    const archiveFolder = await getOrCreateFolder(projectFolder.folderId, 'Archive');
    
    // Move the DFA to Archive folder
    await archiveFile(dfaFile.id, archiveFolder.folderId);
    
    console.log(`Archived DFA ${dfaFileName} to Archive folder`);
  } catch (error) {
    console.error('Error archiving DFA:', error);
    // Don't throw - we still want the report delete to succeed even if archive fails
  }
}
