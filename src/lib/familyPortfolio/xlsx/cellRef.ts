// R13.3 — A1-notation helpers for the RESUMEN reader.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// Column letters are base-26 bijective ("A"..."Z", "AA"..., "CZ", "DE"), which
// is NOT ordinary base-26: there is no zero digit. Getting this wrong silently
// shifts every column, which is exactly the class of error doc 02 warns about,
// so it is isolated here and tested directly.

/** Parsed A1 reference. Both indices are 1-based, matching the file format. */
export interface CellRef {
  column: number
  row: number
}

const A1 = /^([A-Z]+)([0-9]+)$/

/** `"CZ87"` → `{ column: 104, row: 87 }`. Returns null for anything malformed. */
export function parseCellRef(ref: string): CellRef | null {
  const m = A1.exec(ref.trim().toUpperCase())
  if (!m) return null
  const column = columnToIndex(m[1])
  const row = Number(m[2])
  if (!Number.isInteger(row) || row < 1) return null
  return { column, row }
}

/** `"A"` → 1, `"Z"` → 26, `"AA"` → 27, `"CZ"` → 104. */
export function columnToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) {
    const d = ch.charCodeAt(0) - 64 // 'A' → 1
    if (d < 1 || d > 26) return 0
    n = n * 26 + d
  }
  return n
}

/** 1 → `"A"`, 27 → `"AA"`, 104 → `"CZ"`. */
export function indexToColumn(index: number): string {
  if (!Number.isInteger(index) || index < 1) return ''
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Builds the canonical provenance string doc 05 § 5.2 stores, e.g. `RESUMEN!CZ13`. */
export function sourceCell(sheet: string, column: number, row: number): string {
  return `${sheet}!${indexToColumn(column)}${row}`
}
