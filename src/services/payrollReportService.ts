import ExcelJS from 'exceljs';
import { query } from './database';
import { PayPeriod } from '../types/database';

interface PayrollLaborEntry {
  employeeId: string;
  employeeName: string;
  classification: string;
  projectId: string;
  projectName: string;
  reportDate: Date;
  regularHours: number;
  otHours: number;
  dtHours: number;
}

interface EmployeePayrollData {
  employeeId: string;
  employeeName: string;
  classification: string;
  totalHours: number;
  dates: Map<string, DatePayrollData>;
}

interface DatePayrollData {
  date: Date;
  totalHours: number;
  projects: Map<string, ProjectHours>;
}

interface ProjectHours {
  projectId: string;
  projectName: string;
  regularHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
}

/**
 * Get all labor data for a pay period
 */
async function getPayrollData(startDate: Date, endDate: Date): Promise<PayrollLaborEntry[]> {
  const result = await query<PayrollLaborEntry>(
    `SELECT 
      e.id as employee_id,
      e.name as employee_name,
      e.skill_level as classification,
      p.id as project_id,
      p.name as project_name,
      dr.report_date,
      ll.regular_hours,
      ll.ot_hours,
      ll.dt_hours
    FROM report_labor_lines ll
    JOIN daily_reports dr ON ll.report_id = dr.id
    JOIN employees e ON ll.employee_id = e.id
    JOIN projects p ON dr.project_id = p.id
    WHERE dr.report_date BETWEEN $1 AND $2
    AND dr.status != 'archived'
    ORDER BY e.name, dr.report_date, p.name`,
    [startDate, endDate]
  );
  return result.rows;
}

/**
 * Aggregate raw labor entries into hierarchical structure
 * Employee -> Date -> Project
 */
function aggregatePayrollData(entries: PayrollLaborEntry[]): Map<string, EmployeePayrollData> {
  const employeeMap = new Map<string, EmployeePayrollData>();

  for (const entry of entries) {
    // Get or create employee
    if (!employeeMap.has(entry.employeeId)) {
      employeeMap.set(entry.employeeId, {
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        classification: entry.classification,
        totalHours: 0,
        dates: new Map(),
      });
    }
    const employee = employeeMap.get(entry.employeeId)!;

    // Get or create date entry
    const dateKey = new Date(entry.reportDate).toISOString().split('T')[0];
    if (!employee.dates.has(dateKey)) {
      employee.dates.set(dateKey, {
        date: new Date(entry.reportDate),
        totalHours: 0,
        projects: new Map(),
      });
    }
    const dateData = employee.dates.get(dateKey)!;

    // Get or create project entry
    if (!dateData.projects.has(entry.projectId)) {
      dateData.projects.set(entry.projectId, {
        projectId: entry.projectId,
        projectName: entry.projectName,
        regularHours: 0,
        otHours: 0,
        dtHours: 0,
        totalHours: 0,
      });
    }
    const projectData = dateData.projects.get(entry.projectId)!;

    // Accumulate hours
    const entryTotal = entry.regularHours + entry.otHours + entry.dtHours;
    projectData.regularHours += entry.regularHours;
    projectData.otHours += entry.otHours;
    projectData.dtHours += entry.dtHours;
    projectData.totalHours += entryTotal;
    dateData.totalHours += entryTotal;
    employee.totalHours += entryTotal;
  }

  return employeeMap;
}

/**
 * Format date as "Mon Jan 27"
 */
function formatDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format date range for header
 */
function formatDateRange(startDate: Date, endDate: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const start = `${months[startDate.getMonth()]} ${startDate.getDate()}`;
  const end = `${months[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`;
  return `${start} - ${end}`;
}

/**
 * Generate the payroll Excel report
 */
export async function generatePayrollReport(payPeriod: PayPeriod): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Umbrella Report System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Payroll Report', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
    },
  });

  // Define columns
  sheet.columns = [
    { key: 'col1', width: 30 },
    { key: 'col2', width: 20 },
    { key: 'col3', width: 30 },
    { key: 'col4', width: 12 },
  ];

  // Header
  const titleRow = sheet.addRow([
    `PAYROLL REPORT - Pay Period #${payPeriod.periodNumber} (${formatDateRange(payPeriod.startDate, payPeriod.endDate)})`,
  ]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 4);

  const generatedRow = sheet.addRow([`Generated: ${new Date().toLocaleDateString()}`]);
  generatedRow.font = { italic: true, size: 10 };
  sheet.mergeCells(generatedRow.number, 1, generatedRow.number, 4);

  sheet.addRow([]); // Empty row

  // Column headers
  const headerRow = sheet.addRow(['Employee', 'Classification', 'Project', 'Hours']);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = {
      bottom: { style: 'thin' },
    };
  });

  // Get and aggregate data
  const rawData = await getPayrollData(payPeriod.startDate, payPeriod.endDate);
  const aggregatedData = aggregatePayrollData(rawData);

  let grandTotal = 0;

  // Sort employees by name
  const sortedEmployees = Array.from(aggregatedData.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );

  for (const employee of sortedEmployees) {
    // Employee header row
    const empRow = sheet.addRow([
      employee.employeeName,
      employee.classification,
      '',
      employee.totalHours,
    ]);
    empRow.font = { bold: true };
    empRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E2F3' },
    };
    empRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
      };
    });

    grandTotal += employee.totalHours;

    // Sort dates chronologically
    const sortedDates = Array.from(employee.dates.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    for (const dateData of sortedDates) {
      // Date row
      const dateRow = sheet.addRow([
        `   └─ ${formatDate(dateData.date)}`,
        '',
        '',
        dateData.totalHours,
      ]);
      dateRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' },
      };

      // Sort projects by name
      const sortedProjects = Array.from(dateData.projects.values()).sort((a, b) =>
        a.projectName.localeCompare(b.projectName)
      );

      for (const project of sortedProjects) {
        // Project row
        sheet.addRow([
          '',
          '',
          project.projectName,
          project.totalHours,
        ]);
      }
    }

    // Add empty row between employees
    sheet.addRow([]);
  }

  // Grand total row
  const totalRow = sheet.addRow(['', '', 'TOTAL HOURS:', grandTotal]);
  totalRow.font = { bold: true, size: 12 };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  totalRow.eachCell((cell, colNumber) => {
    if (colNumber >= 3) {
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    }
  });

  // Format hours column
  sheet.getColumn(4).numFmt = '0.0';
  sheet.getColumn(4).alignment = { horizontal: 'right' };

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Get filename for payroll report
 */
export function getPayrollReportFilename(payPeriod: PayPeriod): string {
  return `Payroll_Report_PP${payPeriod.periodNumber}_${payPeriod.year}.xlsx`;
}
