/**
 * Overtime Calculation Service
 * Calculates Regular, OT, and DT hours based on client-specific rules loaded from Excel
 */

export interface OvertimeRules {
  // Daily thresholds
  regularHoursMax: number;      // e.g., 8
  overtimeHoursMax: number;     // e.g., 12 (DT kicks in after this)
  
  // Stat holidays (list of holiday names)
  statHolidays: string[];
  
  // Weekend rules
  weekendOvertimeAfterWeeklyHours: number; // e.g., 40
}

export interface HoursBreakdown {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
}

export interface CalculationContext {
  totalHours: number;
  date: Date;
  employeeWeeklyRegularHours: number; // RG hours already worked this week (Mon-Sat before this day)
  isStatHoliday: boolean;
}

// Default rules (fallback if no client-specific Excel found)
export const DEFAULT_RULES: OvertimeRules = {
  regularHoursMax: 8,
  overtimeHoursMax: 12,
  statHolidays: [
    'New Years Day',
    'BC Family Day', 
    'Good Friday',
    'Victoria Day',
    'Canada Day',
    'B.C Day',
    'Labour Day',
    'National Day for Truth and Reconciliation',
    'Thanksgiving Day',
    'Remembrance Day',
    'Christmas Day'
  ],
  weekendOvertimeAfterWeeklyHours: 40
};

// Cache for client rules (to avoid re-reading Excel on every call)
const clientRulesCache: Map<string, { rules: OvertimeRules; loadedAt: Date }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parse OT rules from Excel workbook
 * Expected format:
 * Row 3: RG, 8 (header labels)
 * Row 4: (value), 8 to 12, After 12 (OT range, DT threshold)
 * Rows 11-21: Stat holiday names in column A
 * Row 26-27: Weekend rules (Saturday/Sunday, OT, After 40)
 */
export function parseOvertimeRulesFromExcel(workbook: any): OvertimeRules {
  const rules: OvertimeRules = { ...DEFAULT_RULES };
  
  try {
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Parse daily thresholds from row 4
    // Column A: Regular hours (e.g., 8)
    const rgCell = worksheet['A4'];
    if (rgCell && rgCell.v) {
      const rgValue = parseInt(String(rgCell.v));
      if (!isNaN(rgValue)) {
        rules.regularHoursMax = rgValue;
      }
    }
    
    // Column B: OT range (e.g., "8 to 12")
    const otCell = worksheet['B4'];
    if (otCell && otCell.v) {
      const otValue = String(otCell.v);
      const match = otValue.match(/(\d+)\s*to\s*(\d+)/i);
      if (match) {
        rules.overtimeHoursMax = parseInt(match[2]);
      }
    }
    
    // Column C: DT threshold (e.g., "After 12")
    const dtCell = worksheet['C4'];
    if (dtCell && dtCell.v) {
      const dtValue = String(dtCell.v);
      const match = dtValue.match(/After\s*(\d+)/i);
      if (match) {
        rules.overtimeHoursMax = parseInt(match[1]);
      }
    }
    
    // Parse stat holidays from rows 11-21 (column A)
    const statHolidays: string[] = [];
    for (let row = 11; row <= 21; row++) {
      const cell = worksheet[`A${row}`];
      if (cell && cell.v) {
        const holidayName = String(cell.v).trim();
        if (holidayName && !holidayName.toLowerCase().includes('stat rules')) {
          statHolidays.push(holidayName);
        }
      }
    }
    if (statHolidays.length > 0) {
      rules.statHolidays = statHolidays;
    }
    
    // Parse weekend rules from rows 26-27
    // Looking for "After 40" in column C
    for (let row = 26; row <= 27; row++) {
      const cell = worksheet[`C${row}`];
      if (cell && cell.v) {
        const value = String(cell.v);
        const match = value.match(/After\s*(\d+)/i);
        if (match) {
          rules.weekendOvertimeAfterWeeklyHours = parseInt(match[1]);
          break;
        }
      }
    }
    
    console.log('Parsed OT rules from Excel:', rules);
  } catch (error) {
    console.error('Error parsing OT rules from Excel, using defaults:', error);
  }
  
  return rules;
}

/**
 * Get rules for a client (from cache or load from Excel)
 */
export async function getClientRules(
  clientName: string | undefined,
  loadExcelFn: (path: string) => Promise<Buffer | null>
): Promise<OvertimeRules> {
  if (!clientName) {
    return DEFAULT_RULES;
  }
  
  // Check cache
  const cached = clientRulesCache.get(clientName);
  if (cached && (Date.now() - cached.loadedAt.getTime()) < CACHE_TTL_MS) {
    console.log(`Using cached OT rules for client: ${clientName}`);
    return cached.rules;
  }
  
  // Try to load from SharePoint
  try {
    const XLSX = await import('xlsx');
    const path = `Umbrella Report Config/${clientName}/ot_rules.xlsx`;
    console.log(`Loading OT rules from: ${path}`);
    
    const buffer = await loadExcelFn(path);
    if (buffer) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const rules = parseOvertimeRulesFromExcel(workbook);
      
      // Cache the rules
      clientRulesCache.set(clientName, { rules, loadedAt: new Date() });
      
      return rules;
    }
  } catch (error) {
    console.log(`Could not load OT rules for ${clientName}, using defaults:`, error);
  }
  
  return DEFAULT_RULES;
}

/**
 * Clear cache for a client (call when Excel is updated)
 */
export function clearClientRulesCache(clientName?: string): void {
  if (clientName) {
    clientRulesCache.delete(clientName);
  } else {
    clientRulesCache.clear();
  }
}

/**
 * Get the day of week (0 = Sunday, 6 = Saturday)
 */
function getDayOfWeek(date: Date): number {
  return date.getDay();
}

/**
 * Check if a date is a weekend (Saturday = 6, Sunday = 0)
 */
function isWeekend(date: Date): boolean {
  const day = getDayOfWeek(date);
  return day === 0 || day === 6;
}

/**
 * Calculate hours breakdown for a regular weekday
 * First 8 = RG, 8-12 = OT, 12+ = DT
 */
function calculateWeekdayHours(totalHours: number, rules: OvertimeRules): HoursBreakdown {
  const { regularHoursMax, overtimeHoursMax } = rules;
  
  let regularHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  
  if (totalHours <= regularHoursMax) {
    // All regular
    regularHours = totalHours;
  } else if (totalHours <= overtimeHoursMax) {
    // Regular + OT
    regularHours = regularHoursMax;
    overtimeHours = totalHours - regularHoursMax;
  } else {
    // Regular + OT + DT
    regularHours = regularHoursMax;
    overtimeHours = overtimeHoursMax - regularHoursMax;
    doubleTimeHours = totalHours - overtimeHoursMax;
  }
  
  return { regularHours, overtimeHours, doubleTimeHours, totalHours };
}

/**
 * Calculate hours breakdown for a stat holiday
 * All hours start at OT, DT after 12
 */
function calculateStatHolidayHours(totalHours: number, rules: OvertimeRules): HoursBreakdown {
  const { overtimeHoursMax } = rules;
  
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  
  if (totalHours <= overtimeHoursMax) {
    // All OT
    overtimeHours = totalHours;
  } else {
    // OT + DT
    overtimeHours = overtimeHoursMax;
    doubleTimeHours = totalHours - overtimeHoursMax;
  }
  
  return { regularHours: 0, overtimeHours, doubleTimeHours, totalHours };
}

/**
 * Calculate hours breakdown for a weekend
 * If employee has < 40 RG hours this week: weekend hours are RG until 40, then OT
 * If employee has >= 40 RG hours this week: all weekend hours are OT
 * DT still applies after 12 hours in a day
 */
function calculateWeekendHours(
  totalHours: number, 
  weeklyRegularHours: number,
  rules: OvertimeRules
): HoursBreakdown {
  const { weekendOvertimeAfterWeeklyHours, overtimeHoursMax } = rules;
  
  let regularHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  
  // How many RG hours can this employee still earn before hitting weekly threshold?
  const remainingRegularAllowance = Math.max(0, weekendOvertimeAfterWeeklyHours - weeklyRegularHours);
  
  // First, calculate DT (anything over 12 hours in a day is always DT)
  if (totalHours > overtimeHoursMax) {
    doubleTimeHours = totalHours - overtimeHoursMax;
  }
  
  // Hours before DT threshold
  const hoursBeforeDT = Math.min(totalHours, overtimeHoursMax);
  
  if (remainingRegularAllowance > 0) {
    // Employee hasn't hit 40 weekly RG yet
    if (hoursBeforeDT <= remainingRegularAllowance) {
      // All non-DT hours are regular
      regularHours = hoursBeforeDT;
    } else {
      // Some regular, rest is OT
      regularHours = remainingRegularAllowance;
      overtimeHours = hoursBeforeDT - remainingRegularAllowance;
    }
  } else {
    // Employee already has 40+ RG this week - all non-DT hours are OT
    overtimeHours = hoursBeforeDT;
  }
  
  return { regularHours, overtimeHours, doubleTimeHours, totalHours };
}

/**
 * Main calculation function
 * Determines which calculation method to use based on context
 */
export function calculateHoursBreakdown(
  context: CalculationContext,
  rules: OvertimeRules = DEFAULT_RULES
): HoursBreakdown {
  const { totalHours, date, employeeWeeklyRegularHours, isStatHoliday } = context;
  
  // Stat holiday takes priority
  if (isStatHoliday) {
    console.log(`Calculating stat holiday hours for ${totalHours} hours`);
    return calculateStatHolidayHours(totalHours, rules);
  }
  
  // Check if weekend
  if (isWeekend(date)) {
    console.log(`Calculating weekend hours: ${totalHours} hours, weekly RG so far: ${employeeWeeklyRegularHours}`);
    return calculateWeekendHours(totalHours, employeeWeeklyRegularHours, rules);
  }
  
  // Regular weekday
  console.log(`Calculating weekday hours for ${totalHours} hours`);
  return calculateWeekdayHours(totalHours, rules);
}

/**
 * Get stat holiday dates for a given year
 * Returns actual dates for the listed holidays
 * @param year The year to get holiday dates for
 * @param holidayNames Optional list of holiday names to include (uses defaults if not provided)
 */
export function getStatHolidayDates(year: number, holidayNames?: string[]): Map<string, Date> {
  const holidays = new Map<string, Date>();
  const names = holidayNames || DEFAULT_RULES.statHolidays;
  
  // Map of holiday names to their date calculation
  const holidayCalculations: Record<string, () => Date> = {
    'new years day': () => new Date(year, 0, 1),
    'canada day': () => new Date(year, 6, 1),
    'remembrance day': () => new Date(year, 10, 11),
    'christmas day': () => new Date(year, 11, 25),
    'bc family day': () => getNthWeekdayOfMonth(year, 1, 1, 3),
    'good friday': () => getGoodFriday(year),
    'victoria day': () => getVictoriaDay(year),
    'b.c day': () => getNthWeekdayOfMonth(year, 7, 1, 1),
    'bc day': () => getNthWeekdayOfMonth(year, 7, 1, 1),
    'labour day': () => getNthWeekdayOfMonth(year, 8, 1, 1),
    'labor day': () => getNthWeekdayOfMonth(year, 8, 1, 1),
    'national day for truth and reconciliation': () => new Date(year, 8, 30),
    'thanksgiving day': () => getNthWeekdayOfMonth(year, 9, 1, 2),
    'thanksgiving': () => getNthWeekdayOfMonth(year, 9, 1, 2),
  };
  
  // Only include holidays that are in the names list
  for (const name of names) {
    const lowerName = name.toLowerCase().trim();
    const calculation = holidayCalculations[lowerName];
    if (calculation) {
      holidays.set(name, calculation());
    }
  }
  
  return holidays;
}

/**
 * Get the nth weekday of a month
 * @param year 
 * @param month 0-indexed
 * @param weekday 0 = Sunday, 1 = Monday, etc.
 * @param n which occurrence (1 = first, 2 = second, etc.)
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  
  // Calculate days until first occurrence of the weekday
  let daysUntilWeekday = weekday - firstWeekday;
  if (daysUntilWeekday < 0) daysUntilWeekday += 7;
  
  // Add weeks for nth occurrence
  const dayOfMonth = 1 + daysUntilWeekday + (n - 1) * 7;
  
  return new Date(year, month, dayOfMonth);
}

/**
 * Calculate Good Friday (Friday before Easter)
 * Uses the Anonymous Gregorian algorithm
 */
function getGoodFriday(year: number): Date {
  const easter = getEasterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  return goodFriday;
}

/**
 * Calculate Easter Sunday using Anonymous Gregorian algorithm
 */
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  
  return new Date(year, month, day);
}

/**
 * Calculate Victoria Day (Monday before May 25)
 */
function getVictoriaDay(year: number): Date {
  const may25 = new Date(year, 4, 25);
  const dayOfWeek = may25.getDay();
  
  // If May 25 is Monday, that's Victoria Day
  if (dayOfWeek === 1) return may25;
  
  // Otherwise, find the Monday before
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const victoriaDay = new Date(year, 4, 25 - daysToSubtract);
  
  return victoriaDay;
}

/**
 * Check if a specific date is a stat holiday
 * Uses the stat holidays defined in the rules
 */
export function isStatHoliday(date: Date, rules: OvertimeRules = DEFAULT_RULES): boolean {
  const year = date.getFullYear();
  const holidays = getStatHolidayDates(year, rules.statHolidays);
  
  const dateStr = date.toISOString().split('T')[0];
  
  for (const [, holidayDate] of holidays) {
    if (holidayDate.toISOString().split('T')[0] === dateStr) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the start of the week (Monday) for a given date
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

/**
 * Get the end of the week (Sunday) for a given date
 */
export function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return weekEnd;
}

export default {
  calculateHoursBreakdown,
  getStatHolidayDates,
  isStatHoliday,
  getWeekStart,
  getWeekEnd,
  DEFAULT_RULES
};
