/**
 * Robustly parse a date value from an ExcelJS cell.
 * Handles: native Dates, day-name prefixed strings ("Saturday, December 13, 2025"),
 * ExcelJS rich text objects, Excel serial date numbers, formula cells.
 */
export function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  
  // ExcelJS formula cell: { result: ..., formula: ... }
  if (typeof val === 'object' && val.result !== undefined) {
    return parseDate(val.result);
  }
  
  // ExcelJS rich text: { richText: [{ text: '...' }] }
  if (typeof val === 'object' && val.richText) {
    val = val.richText.map((r: any) => r.text).join('');
  }
  
  // Excel serial date number (e.g., 45639 = some date)
  if (typeof val === 'number' && val > 25569) {
    return new Date((val - 25569) * 86400 * 1000);
  }
  
  const str = String(val).trim();
  if (!str) return null;
  
  // Try standard parsing first
  const direct = new Date(str);
  if (!isNaN(direct.getTime())) return direct;
  
  // Strip day-of-week prefix: "Saturday, December 13, 2025" → "December 13, 2025"
  const stripped = str.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, '');
  if (stripped !== str) {
    const parsed = new Date(stripped);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  
  return null;
}
