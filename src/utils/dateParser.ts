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
  
  // Strip day-of-week prefix first: "Saturday, December 13, 2025" → "December 13, 2025"
  // This prevents timezone-related parsing issues when the day name is present
  const stripped = str.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, '');
  if (stripped !== str) {
    const parsed = new Date(stripped);
    if (!isNaN(parsed.getTime())) {
      parsed.setUTCHours(12, 0, 0, 0);
      return parsed;
    }
  }
  
  // Try standard parsing as fallback
  const direct = new Date(str);
  if (!isNaN(direct.getTime())) {
    direct.setUTCHours(12, 0, 0, 0);
    return direct;
  }
  
  return null;
}
