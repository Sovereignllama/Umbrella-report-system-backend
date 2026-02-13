/**
 * Map month names (full and abbreviated) to zero-indexed month numbers.
 * JavaScript's Date constructor uses 0-11 for January-December.
 */
const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date string using explicit regex-based parsing and Date.UTC() construction.
 * This eliminates timezone ambiguity that occurs with new Date(string) parsing.
 * Returns null if the string doesn't match any supported format.
 */
function parseDateString(str: string): Date | null {
  // Strip day-of-week prefix first: "Saturday, December 13, 2025" → "December 13, 2025"
  const cleaned = str.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, '').trim();
  
  // Try "Month Day, Year" format (e.g., "December 13, 2025")
  const mdyMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdyMatch) {
    const month = MONTH_MAP[mdyMatch[1].toLowerCase()];
    if (month !== undefined) {
      return new Date(Date.UTC(parseInt(mdyMatch[3]), month, parseInt(mdyMatch[2]), 12, 0, 0));
    }
  }
  
  // Try "YYYY-MM-DD" format
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Date.UTC(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]), 12, 0, 0));
  }
  
  // Try "MM/DD/YYYY" format
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return new Date(Date.UTC(parseInt(slashMatch[3]), parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]), 12, 0, 0));
  }
  
  return null;
}

/**
 * Robustly parse a date value from an ExcelJS cell.
 * Handles: native Dates, day-name prefixed strings ("Saturday, December 13, 2025"),
 * ExcelJS rich text objects, Excel serial date numbers, formula cells.
 */
export function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) {
    // Set to noon UTC to prevent timezone shifts
    const date = new Date(val);
    date.setUTCHours(12, 0, 0, 0);
    return date;
  }
  
  // Excel epoch offset: Excel's date system started on December 30, 1899,
  // while Unix epoch started on January 1, 1970 (difference of 25569 days)
  const EXCEL_EPOCH_OFFSET = 25569;
  // Number of seconds in a day
  const SECONDS_PER_DAY = 86400;
  
  // ExcelJS formula cell: { result: ..., formula: ... }
  if (typeof val === 'object' && val.result !== undefined) {
    return parseDate(val.result);
  }
  
  // ExcelJS rich text: { richText: [{ text: '...' }] }
  if (typeof val === 'object' && val.richText) {
    val = val.richText.map((r: any) => r.text).join('');
  }
  
  // Handle hyperlink objects: { text: '...', hyperlink: '...' }
  if (typeof val === 'object' && val.text !== undefined) {
    val = val.text;
  }
  
  // Excel serial date number (e.g., 45639 = some date)
  if (typeof val === 'number' && val > EXCEL_EPOCH_OFFSET) {
    const date = new Date((val - EXCEL_EPOCH_OFFSET) * SECONDS_PER_DAY * 1000);
    date.setUTCHours(12, 0, 0, 0);
    return date;
  }
  
  const str = String(val).trim();
  if (!str) return null;
  
  // Try explicit regex-based parsing first (eliminates timezone ambiguity)
  const parsed = parseDateString(str);
  if (parsed) return parsed;
  
  // Fall back to standard Date constructor as last resort
  const direct = new Date(str);
  if (!isNaN(direct.getTime())) {
    direct.setUTCHours(12, 0, 0, 0);
    return direct;
  }
  
  return null;
}

/**
 * Parse flexible SMS date formats and default to current year
 * Supports formats like:
 * - "Feb 16" → 2026-02-16
 * - "feb 16" → 2026-02-16
 * - "February 16" → 2026-02-16
 * - "feb16" → 2026-02-16
 * - "2/16" → 2026-02-16
 * 
 * Returns Date object set to noon UTC, or null if parsing fails
 */
export function parseSmsDate(str: string): Date | null {
  if (!str) return null;
  
  const cleaned = str.trim();
  const currentYear = new Date().getUTCFullYear();
  
  // Try "Month Day" format (e.g., "Feb 16", "February 16")
  const monthDayMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})$/i);
  if (monthDayMatch) {
    const month = MONTH_MAP[monthDayMatch[1].toLowerCase()];
    if (month !== undefined) {
      const day = parseInt(monthDayMatch[2]);
      if (day >= 1 && day <= 31) {
        return new Date(Date.UTC(currentYear, month, day, 12, 0, 0));
      }
    }
  }
  
  // Try "MonthDay" format without space (e.g., "feb16")
  const monthDayNoSpaceMatch = cleaned.match(/^([A-Za-z]+)(\d{1,2})$/i);
  if (monthDayNoSpaceMatch) {
    const month = MONTH_MAP[monthDayNoSpaceMatch[1].toLowerCase()];
    if (month !== undefined) {
      const day = parseInt(monthDayNoSpaceMatch[2]);
      if (day >= 1 && day <= 31) {
        return new Date(Date.UTC(currentYear, month, day, 12, 0, 0));
      }
    }
  }
  
  // Try "M/D" or "MM/DD" format (e.g., "2/16", "02/16")
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1]) - 1; // 0-indexed
    const day = parseInt(slashMatch[2]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(currentYear, month, day, 12, 0, 0));
    }
  }
  
  return null;
}
