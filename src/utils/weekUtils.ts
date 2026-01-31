/**
 * Utility functions for working with week folders
 */

export interface WeekRange {
  startDate: Date;
  endDate: Date;
  folderName: string; // "Jan 1-7"
  year: number;
  month: number;
  weekNumber: number;
}

/**
 * Get week range for a given date
 * Week starts on Monday, ends on Sunday
 */
export function getWeekRangeForDate(date: Date): WeekRange {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday

  const startDate = new Date(d.setDate(diff));
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  const monthName = startDate.toLocaleString('default', { month: 'short' });
  const folderName = `${monthName} ${startDate.getDate()}-${endDate.getDate()}`;

  return {
    startDate,
    endDate,
    folderName,
    year: startDate.getFullYear(),
    month: startDate.getMonth() + 1,
    weekNumber: getWeekNumber(startDate),
  };
}

/**
 * Get ISO week number for a date
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate report filename
 */
export function generateReportFileName(
  projectName: string,
  reportDate: Date,
  reportType: 'supervisor' | 'boss'
): string {
  const dateStr = formatDateISO(reportDate);
  const typeLabel = reportType === 'supervisor' ? 'Supervisor' : 'Boss';
  const projectSafe = projectName.replace(/[/\\?*:|"<>]/g, '-');
  
  return `Daily_Report_${projectSafe}_${dateStr}_${typeLabel}.xlsx`;
}

/**
 * Generate photo filename
 */
export function generatePhotoFileName(reportDate: Date, photoIndex: number): string {
  const dateStr = formatDateISO(reportDate);
  return `${dateStr}_photo_${String(photoIndex).padStart(3, '0')}`;
}

/**
 * Check if two dates are in the same week
 */
export function isSameWeek(date1: Date, date2: Date): boolean {
  const week1 = getWeekRangeForDate(date1);
  const week2 = getWeekRangeForDate(date2);
  
  return (
    week1.year === week2.year &&
    week1.weekNumber === week2.weekNumber
  );
}

/**
 * Get all dates in a week for a given date
 */
export function getWeekDates(date: Date): Date[] {
  const weekRange = getWeekRangeForDate(date);
  const dates: Date[] = [];
  const current = new Date(weekRange.startDate);
  
  while (current <= weekRange.endDate) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}
