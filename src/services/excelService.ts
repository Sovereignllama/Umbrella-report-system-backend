import ExcelJS from 'exceljs';
import { Workbook, Cell } from 'exceljs';
import {
  DailyReport,
} from '../types/database';
import {
  ReportLaborLineRepository,
  ReportEquipmentLineRepository,
  ReportMaterialsRepository,
  EmployeeRepository,
  EquipmentRepository,
  ChargeOutRateRepository,
} from '../repositories';

/**
 * Excel styles and formatting
 */
const STYLES = {
  headerFill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF4472C4' } },
  headerFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  titleFont: { bold: true, size: 14 },
  boldFont: { bold: true },
  border: {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const },
  },
  centerAlign: { horizontal: 'center' as const, vertical: 'middle' as const },
  currencyFormat: '#,##0.00',
  timeFormat: '0.00',
};

/**
 * Apply header styling to row
 */
function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = STYLES.headerFill;
    cell.font = STYLES.headerFont;
    cell.alignment = STYLES.centerAlign;
    cell.border = STYLES.border;
  });
}

/**
 * Apply standard cell borders
 */
function styleCellBorders(cell: Cell): void {
  cell.border = STYLES.border;
}

/**
 * Generate Supervisor Report (no rates/pricing)
 */
export async function generateSupervisorReport(
  report: DailyReport,
  projectName: string,
  supervisorName: string
): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Daily Report');

  // Set column widths
  sheet.columns = [
    { width: 15 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 25 },
    { width: 15 },
    { width: 15 },
  ];

  // Title
  let currentRow = 1;
  const titleRow = sheet.getRow(currentRow);
  titleRow.getCell(1).value = 'DAILY PROJECT REPORT - SUPERVISOR VIEW';
  titleRow.getCell(1).font = STYLES.titleFont;
  sheet.mergeCells(currentRow, 1, currentRow, 7);
  currentRow += 2;

  // Project Info
  sheet.getRow(currentRow).getCell(1).value = 'Project:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  sheet.getRow(currentRow).getCell(2).value = projectName;
  sheet.mergeCells(currentRow, 2, currentRow, 3);
  currentRow++;

  sheet.getRow(currentRow).getCell(1).value = 'Date:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  sheet.getRow(currentRow).getCell(2).value = report.reportDate;
  sheet.getRow(currentRow).getCell(2).numFmt = 'mm/dd/yyyy';
  currentRow++;

  sheet.getRow(currentRow).getCell(1).value = 'Supervisor:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  sheet.getRow(currentRow).getCell(2).value = supervisorName;
  currentRow += 2;

  // Supervisor Notes
  sheet.getRow(currentRow).getCell(1).value = 'Notes:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  currentRow++;

  const notesCell = sheet.getRow(currentRow).getCell(1);
  notesCell.value = report.notes || '';
  notesCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  sheet.getRow(currentRow).height = 60;
  sheet.mergeCells(currentRow, 1, currentRow, 7);
  currentRow += 2;

  // Labor Section
  sheet.getRow(currentRow).getCell(1).value = 'LABOR';
  sheet.getRow(currentRow).getCell(1).font = STYLES.titleFont;
  currentRow++;

  const laborHeaderRow = sheet.getRow(currentRow);
  const laborHeaders = ['Employee', 'Regular Hours', 'OT Hours', 'DT Hours', 'Work Description'];
  laborHeaders.forEach((header, idx) => {
    laborHeaderRow.getCell(idx + 1).value = header;
  });
  styleHeaderRow(laborHeaderRow);
  currentRow++;

  // Add labor lines
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  for (const line of laborLines) {
    const employee = line.employeeId ? await EmployeeRepository.findById(line.employeeId) : null;
    const row = sheet.getRow(currentRow);

    row.getCell(1).value = employee?.name || 'Unknown';
    row.getCell(2).value = line.regularHours;
    row.getCell(2).numFmt = STYLES.timeFormat;
    row.getCell(3).value = line.otHours;
    row.getCell(3).numFmt = STYLES.timeFormat;
    row.getCell(4).value = line.dtHours;
    row.getCell(4).numFmt = STYLES.timeFormat;
    row.getCell(5).value = line.workDescription;

    for (let i = 1; i <= 5; i++) {
      styleCellBorders(row.getCell(i));
    }

    currentRow++;
  }

  currentRow++;

  // Equipment Section
  sheet.getRow(currentRow).getCell(1).value = 'EQUIPMENT';
  sheet.getRow(currentRow).getCell(1).font = STYLES.titleFont;
  currentRow++;

  const equipHeaderRow = sheet.getRow(currentRow);
  const equipHeaders = ['Equipment', 'Hours Used'];
  equipHeaders.forEach((header, idx) => {
    equipHeaderRow.getCell(idx + 1).value = header;
  });
  styleHeaderRow(equipHeaderRow);
  currentRow++;

  // Add equipment lines
  const equipmentLines = await ReportEquipmentLineRepository.findByReportId(report.id);
  for (const line of equipmentLines) {
    const equipment = await EquipmentRepository.findById(line.equipmentId);
    const row = sheet.getRow(currentRow);

    row.getCell(1).value = equipment?.name || 'Unknown';
    row.getCell(2).value = line.hoursUsed;
    row.getCell(2).numFmt = STYLES.timeFormat;

    for (let i = 1; i <= 2; i++) {
      styleCellBorders(row.getCell(i));
    }

    currentRow++;
  }

  currentRow++;

  // Materials Section
  sheet.getRow(currentRow).getCell(1).value = 'MATERIALS';
  sheet.getRow(currentRow).getCell(1).font = STYLES.titleFont;
  currentRow++;

  const materials = await ReportMaterialsRepository.findByReportId(report.id);
  const materialsCell = sheet.getRow(currentRow).getCell(1);
  materialsCell.value = materials?.freeTextNotes || '';
  materialsCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  sheet.getRow(currentRow).height = 60;
  sheet.mergeCells(currentRow, 1, currentRow, 7);

  // Generate buffer
  return workbook.xlsx.writeBuffer() as Promise<Buffer>;
}

/**
 * Generate Boss Report (with rates and pricing)
 */
export async function generateBossReport(
  report: DailyReport,
  projectName: string,
  supervisorName: string
): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Daily Report');

  // Set column widths
  sheet.columns = [
    { width: 15 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 15 },
  ];

  // Title
  let currentRow = 1;
  const titleRow = sheet.getRow(currentRow);
  titleRow.getCell(1).value = 'DAILY PROJECT REPORT - BOSS VIEW (PRICED)';
  titleRow.getCell(1).font = STYLES.titleFont;
  sheet.mergeCells(currentRow, 1, currentRow, 8);
  currentRow += 2;

  // Project Info
  sheet.getRow(currentRow).getCell(1).value = 'Project:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  sheet.getRow(currentRow).getCell(2).value = projectName;
  currentRow++;

  sheet.getRow(currentRow).getCell(1).value = 'Date:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  sheet.getRow(currentRow).getCell(2).value = report.reportDate;
  sheet.getRow(currentRow).getCell(2).numFmt = 'mm/dd/yyyy';
  currentRow++;

  sheet.getRow(currentRow).getCell(1).value = 'Supervisor:';
  sheet.getRow(currentRow).getCell(1).font = STYLES.boldFont;
  sheet.getRow(currentRow).getCell(2).value = supervisorName;
  currentRow += 2;

  // Labor Section with Rates
  sheet.getRow(currentRow).getCell(1).value = 'LABOR (COSTED)';
  sheet.getRow(currentRow).getCell(1).font = STYLES.titleFont;
  currentRow++;

  const laborHeaderRow = sheet.getRow(currentRow);
  const laborHeaders = [
    'Employee',
    'Skill',
    'Regular Hrs',
    'Reg Rate',
    'Reg Cost',
    'OT Hrs',
    'OT Rate',
    'OT Cost',
  ];
  laborHeaders.forEach((header, idx) => {
    laborHeaderRow.getCell(idx + 1).value = header;
  });
  styleHeaderRow(laborHeaderRow);
  currentRow++;

  // Add labor lines with rates
  const laborLines = await ReportLaborLineRepository.findByReportId(report.id);
  let totalLaborCost = 0;

  for (const line of laborLines) {
    const employee = line.employeeId ? await EmployeeRepository.findById(line.employeeId) : null;
    const rates = await ChargeOutRateRepository.findBySkillLevel(
      employee?.skillLevel || 'Regular'
    );

    const row = sheet.getRow(currentRow);

    row.getCell(1).value = employee?.name || 'Unknown';
    row.getCell(2).value = employee?.skillLevel || 'Regular';

    // Regular hours
    row.getCell(3).value = line.regularHours;
    row.getCell(3).numFmt = STYLES.timeFormat;
    row.getCell(4).value = rates?.regularRate || 0;
    row.getCell(4).numFmt = STYLES.currencyFormat;
    row.getCell(5).value = line.regularHours * (rates?.regularRate || 0);
    row.getCell(5).numFmt = STYLES.currencyFormat;

    // OT hours
    row.getCell(6).value = line.otHours;
    row.getCell(6).numFmt = STYLES.timeFormat;
    row.getCell(7).value = rates?.otRate || 0;
    row.getCell(7).numFmt = STYLES.currencyFormat;
    row.getCell(8).value = line.otHours * (rates?.otRate || 0);
    row.getCell(8).numFmt = STYLES.currencyFormat;

    totalLaborCost +=
      line.regularHours * (rates?.regularRate || 0) +
      line.otHours * (rates?.otRate || 0) +
      line.dtHours * (rates?.dtRate || 0);

    for (let i = 1; i <= 8; i++) {
      styleCellBorders(row.getCell(i));
    }

    currentRow++;
  }

  // Labor total
  const totalRow = sheet.getRow(currentRow);
  totalRow.getCell(1).value = 'TOTAL LABOR COST';
  totalRow.getCell(1).font = STYLES.boldFont;
  totalRow.getCell(5).value = totalLaborCost;
  totalRow.getCell(5).numFmt = STYLES.currencyFormat;
  totalRow.getCell(5).font = STYLES.boldFont;
  currentRow += 2;

  // Equipment Section
  sheet.getRow(currentRow).getCell(1).value = 'EQUIPMENT';
  sheet.getRow(currentRow).getCell(1).font = STYLES.titleFont;
  currentRow++;

  const equipHeaderRow = sheet.getRow(currentRow);
  const equipHeaders = ['Equipment', 'Hours Used'];
  equipHeaders.forEach((header, idx) => {
    equipHeaderRow.getCell(idx + 1).value = header;
  });
  styleHeaderRow(equipHeaderRow);
  currentRow++;

  // Add equipment lines
  const equipmentLines2 = await ReportEquipmentLineRepository.findByReportId(report.id);
  for (const line of equipmentLines2) {
    const equipment = await EquipmentRepository.findById(line.equipmentId);
    const row = sheet.getRow(currentRow);

    row.getCell(1).value = equipment?.name || 'Unknown';
    row.getCell(2).value = line.hoursUsed;
    row.getCell(2).numFmt = STYLES.timeFormat;

    for (let i = 1; i <= 2; i++) {
      styleCellBorders(row.getCell(i));
    }

    currentRow++;
  }

  // Generate buffer
  return workbook.xlsx.writeBuffer() as Promise<Buffer>;
}
