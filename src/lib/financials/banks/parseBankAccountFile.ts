// Phase 8C.7 — dependency-free parser for CMF's monthly bank regulatory TXT
// files ("Balance y Estado de Situación Bancos"). NOT an XBRL parser — this is
// a tab-delimited, fixed-format file: a bank-name header line, then one row
// per 9-digit account code.
//
// Format (verified against a real May-2026 release, official documentation
// bundled in the same ZIP — see bankConceptMap.ts header):
//   line 1: "<3-digit bank code>\t<bank legal name>"
//   line N: "<9-digit account code>\t<col2>[\t<col3>\t<col4>\t<col5>]"
// Balance-sheet files (b1/b2) carry 4 amount columns (CLP nominal / UF-indexed
// / FX-indexed / FX-translated-to-CLP — all already expressed in pesos).
// Income-statement/complementary files (r1/c1/c2) carry a single "Monto
// Total" column. Negative values are prefixed with '-' in the source text.

export interface BankAccountRow {
  accountCode: string
  /** Raw columns exactly as parsed (1 for income-type files, 4 for balance-type files). */
  columns: number[]
  /** Sum of all columns — the headline peso figure for a balance-sheet row; equals columns[0] for a single-column row. */
  total: number
}

export interface ParsedBankAccountFile {
  bankCode: string
  bankName: string
  rows: BankAccountRow[]
}

export type BankFileParseError =
  | { code: 'empty_file'; reason: string }
  | { code: 'malformed_header'; reason: string }
  | { code: 'malformed_row'; reason: string; line: number }

export type BankFileParseResult = { ok: true; value: ParsedBankAccountFile } | { ok: false; error: BankFileParseError }

/**
 * Parses one bank's TXT file (already extracted from the monthly ZIP).
 * Never throws — malformed input returns a structured error. Never coerces
 * an unparseable numeric field to 0; the whole row (and thus the file, since
 * a single corrupt row cannot be silently dropped from a regulatory filing)
 * is rejected instead.
 */
export function parseBankAccountFile(text: string): BankFileParseResult {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { ok: false, error: { code: 'empty_file', reason: 'file has no non-blank lines' } }

  const header = lines[0].split('\t')
  if (header.length < 2 || !/^\d{1,3}$/.test(header[0].trim())) {
    return { ok: false, error: { code: 'malformed_header', reason: `expected "<bank code>\\t<bank name>", got "${lines[0].slice(0, 80)}"` } }
  }
  const bankCode = header[0].trim().padStart(3, '0')
  const bankName = header[1].trim()

  const rows: BankAccountRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1
    const cells = lines[i].split('\t')
    if (cells.length < 2) return { ok: false, error: { code: 'malformed_row', reason: `expected at least 2 tab-separated fields, got "${lines[i].slice(0, 80)}"`, line: lineNo } }
    const accountCode = cells[0].trim()
    if (!/^\d{9}$/.test(accountCode)) return { ok: false, error: { code: 'malformed_row', reason: `account code "${accountCode}" is not 9 digits`, line: lineNo } }

    const columns: number[] = []
    for (const raw of cells.slice(1)) {
      const trimmed = raw.trim()
      if (trimmed === '') continue
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, error: { code: 'malformed_row', reason: `non-numeric amount "${trimmed}" for account ${accountCode}`, line: lineNo } }
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return { ok: false, error: { code: 'malformed_row', reason: `non-finite amount for account ${accountCode}`, line: lineNo } }
      columns.push(n)
    }
    if (columns.length === 0) return { ok: false, error: { code: 'malformed_row', reason: `account ${accountCode} has no amount columns`, line: lineNo } }

    rows.push({ accountCode, columns, total: columns.reduce((a, b) => a + b, 0) })
  }

  return { ok: true, value: { bankCode, bankName, rows } }
}

/** Looks up one account code's row in an already-parsed file. Returns null if the code was not reported this period — never fabricated as zero. */
export function findAccountRow(parsed: ParsedBankAccountFile, accountCode: string): BankAccountRow | null {
  return parsed.rows.find((r) => r.accountCode === accountCode) ?? null
}

/** Expected release filename for one bank/file-type/period, per the official `XXAAAAMMIFI.TXT` naming convention. */
export function bankFileName(fileType: 'b1' | 'b2' | 'r1' | 'c1' | 'c2', year: number, month: number, bankCode: string): string {
  const yyyymm = `${year}${String(month).padStart(2, '0')}`
  return `${fileType}${yyyymm}${bankCode.padStart(3, '0')}.txt`
}
