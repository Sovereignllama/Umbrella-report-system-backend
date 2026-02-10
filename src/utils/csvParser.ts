/**
 * Simple RFC 4180 compliant CSV parser
 * Handles quoted fields that may contain commas, newlines, and quotes
 */

/**
 * Parse a CSV string into an array of rows, where each row is an array of string values
 * @param csvText The CSV text to parse
 * @returns Array of rows, where each row is an array of cell values
 */
export function parseCSV(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];
    const nextChar = i + 1 < csvText.length ? csvText[i + 1] : null;

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" becomes "
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        // Regular character inside quotes
        currentCell += char;
        i++;
        continue;
      }
    } else {
      // Not in quotes
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentCell);
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r' && nextChar === '\n') {
        // CRLF line ending
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i += 2;
        continue;
      } else if (char === '\n' || char === '\r') {
        // LF or CR line ending
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
        continue;
      } else {
        // Regular character
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  // Handle last cell and row if any content remains
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Get a cell value from a parsed CSV row, handling empty leading column
 * @param row The CSV row array
 * @param index The column index (0-based)
 * @returns The cell value or empty string if out of bounds
 */
export function getCSVCell(row: string[], index: number): string {
  return row[index] || '';
}
