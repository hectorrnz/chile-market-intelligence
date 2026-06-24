// CSV export utilities — no dependencies. Used by every data table so an analyst
// can pull a grid straight into Excel. Values are formatted exactly as shown.

/** Escape a single CSV cell per RFC 4180 (quote if it contains , " or newline). */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build a CSV string from a header row and data rows. */
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))]
  return lines.join('\r\n')
}

/**
 * Trigger a client-side download of a CSV file. A UTF-8 BOM is prepended so
 * Excel renders accented characters (á, ñ) and the "MM CLP" suffix correctly.
 */
export function downloadCSV(filename: string, csv: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Convenience: build + download in one call. */
export function exportCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  downloadCSV(filename, toCSV(headers, rows))
}
