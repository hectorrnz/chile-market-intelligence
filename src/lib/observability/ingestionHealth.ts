// Phase 5D.1 — Pure ingestion health evaluation.
// No Supabase calls, no network, no secrets. Unit-testable in isolation.

export type HealthStatus = 'healthy' | 'warning' | 'stale' | 'failed' | 'unknown'

export interface IngestionRunInput {
  status: string | null
  startedAt: string | null
  rowsFailed: number | null
  rowsInserted?: number | null
}

export interface MacroObservationInput {
  indicatorId: string
  maxDate: string | null
  count?: number | null
}

export interface MacroHealthInput {
  latestRun: IngestionRunInput | null
  observations: MacroObservationInput[]
  today?: string  // YYYY-MM-DD; defaults to UTC today
}

export interface MarketHealthInput {
  latestRun: IngestionRunInput | null
  latestSnapshotDate: string | null
  latestSnapshotType: string | null
  stockCount?: number
  indexCount?: number
  sectorCount?: number
  today?: string  // YYYY-MM-DD; defaults to UTC today
}

export interface HealthAlert {
  severity: 'critical' | 'warning' | 'info'
  code: string
  message: string
  recommendedAction: string
}

export interface MacroHealthResult {
  status: HealthStatus
  latestRunAt: string | null
  latestRunStatus: string | null
  indicatorsHealthy: number
  indicatorsTotal: number
  rowsFailed: number
  staleIndicators: string[]
  alerts: HealthAlert[]
}

export interface MarketHealthResult {
  status: HealthStatus
  latestRunAt: string | null
  latestSnapshotDate: string | null
  latestSnapshotType: string | null
  stockCount: number
  indexCount: number
  sectorCount: number
  rowsFailed: number
  alerts: HealthAlert[]
}

export interface OverallHealthResult {
  overallStatus: HealthStatus
  generatedAt: string
  macro: MacroHealthResult
  market: MarketHealthResult
  alerts: HealthAlert[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Indicators that publish monthly or less frequently — don't flag stale
// just because the latest observation is from last month.
const MONTHLY_INDICATORS = new Set([
  'ipc-mensual', 'ipc-anual', 'imacec-anual', 'desempleo',
  // Phase 8D: copper (BCCh, monthly) + 3 monthly FRED series (Fed Funds is a
  // monthly average; CPI m/m and y/y derive from the same monthly index level).
  'cobre-lme', 'fed-funds', 'us-cpi-mensual', 'us-cpi-anual', 'us-unemployment',
])
const MONTHLY_STALE_DAYS = 100  // ~3.5 months: IPC lags 1m, IMACEC/Desempleo 2m — alert only if genuinely missing

// Macro BCCh thresholds (business days since last successful run)
const MACRO_HEALTHY_DAYS  = 2
const MACRO_WARNING_DAYS  = 4

// Market Yahoo thresholds (calendar days since latest snapshot)
const MARKET_HEALTHY_DAYS = 2
const MARKET_WARNING_DAYS = 4

// ─── Business day helpers ─────────────────────────────────────────────────────

export function businessDaysBetween(from: Date, to: Date): number {
  let count = 0
  const cur = new Date(from)
  cur.setUTCHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setUTCHours(0, 0, 0, 0)
  while (cur < end) {
    const day = cur.getUTCDay()
    if (day !== 0 && day !== 6) count++  // skip Sun(0) and Sat(6)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return count
}

export function calendarDaysBetween(from: Date, to: Date): number {
  const msPerDay = 86_400_000
  const f = new Date(from); f.setUTCHours(0, 0, 0, 0)
  const t = new Date(to);   t.setUTCHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((t.getTime() - f.getTime()) / msPerDay))
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Macro health ─────────────────────────────────────────────────────────────

export function evaluateMacroIngestionHealth(input: MacroHealthInput): MacroHealthResult {
  const today = input.today ?? utcToday()
  const todayDate = new Date(today + 'T00:00:00Z')
  const alerts: HealthAlert[] = []

  const run = input.latestRun
  const runAt   = run?.startedAt ?? null
  const runStat = run?.status    ?? null
  const rowsFailed = run?.rowsFailed ?? 0

  // ── Evaluate run age ───────────────────────────────────────────────────────
  let runAgeDays = Infinity
  if (runAt) {
    const runDate = new Date(runAt)
    if (!isNaN(runDate.getTime())) {
      runAgeDays = businessDaysBetween(runDate, todayDate)
    }
  }

  // ── Overall run status ─────────────────────────────────────────────────────
  let runStatus: HealthStatus = 'unknown'
  if (!run || runStat === null) {
    runStatus = 'unknown'
  } else if (runStat === 'failed') {
    runStatus = 'failed'
  } else if (runStat === 'success' || runStat === 'partial_success') {
    if (runAgeDays <= MACRO_HEALTHY_DAYS)  runStatus = 'healthy'
    else if (runAgeDays <= MACRO_WARNING_DAYS) runStatus = 'warning'
    else                                   runStatus = 'stale'
  }

  if (runStatus === 'failed') {
    alerts.push({
      severity: 'critical',
      code: `MACRO_RUN_FAILED_${today}`,
      message: `BCCh macro ingestion run failed at ${runAt ?? 'unknown'}`,
      recommendedAction: 'Check Vercel logs for /api/cron/ingest-bcch-macro. Verify BCCh credentials.',
    })
  } else if (runStatus === 'stale') {
    alerts.push({
      severity: 'critical',
      code: `MACRO_RUN_STALE_${today}`,
      message: `BCCh macro ingestion has not run successfully in ${runAgeDays} business days (last: ${runAt ?? 'never'})`,
      recommendedAction: 'Trigger /api/cron/ingest-bcch-macro manually with CRON_SECRET. Check cron schedule in vercel.json.',
    })
  } else if (runStatus === 'warning') {
    alerts.push({
      severity: 'warning',
      code: `MACRO_RUN_AGING_${today}`,
      message: `BCCh macro ingestion last ran ${runAgeDays} business days ago (last: ${runAt ?? 'never'})`,
      recommendedAction: 'Monitor. If cron missed a weekday, trigger manually.',
    })
  } else if (runStatus === 'unknown') {
    alerts.push({
      severity: 'warning',
      code: `MACRO_RUN_UNKNOWN_${today}`,
      message: 'No macro ingestion run found — DB may not be configured or reachable',
      recommendedAction: 'Check DB_MODE and Supabase credentials. Run npm run supabase:check-macro.',
    })
  }

  if (rowsFailed > 0 && runStatus !== 'failed') {
    alerts.push({
      severity: 'warning',
      code: `MACRO_ROWS_FAILED_${today}`,
      message: `${rowsFailed} macro observation rows failed in latest run`,
      recommendedAction: 'Check Vercel function logs for BCCh API errors.',
    })
  }

  // ── Per-indicator staleness ────────────────────────────────────────────────
  const staleIndicators: string[] = []
  for (const obs of input.observations) {
    if (!obs.maxDate) { staleIndicators.push(obs.indicatorId); continue }
    const obsDate = new Date(obs.maxDate + 'T00:00:00Z')
    if (isNaN(obsDate.getTime())) { staleIndicators.push(obs.indicatorId); continue }
    const calDays = calendarDaysBetween(obsDate, todayDate)
    const threshold = MONTHLY_INDICATORS.has(obs.indicatorId) ? MONTHLY_STALE_DAYS : MACRO_WARNING_DAYS * 1.5 * 7 / 5  // ~5.6 cal days
    if (calDays > Math.max(threshold, 7)) {
      staleIndicators.push(obs.indicatorId)
    }
  }

  const indicatorsTotal   = input.observations.length
  const indicatorsHealthy = indicatorsTotal - staleIndicators.length

  if (staleIndicators.length > 0 && runStatus === 'healthy') {
    alerts.push({
      severity: 'warning',
      code: `MACRO_OBS_STALE_${today}`,
      message: `${staleIndicators.length} indicator(s) have stale observations: ${staleIndicators.join(', ')}`,
      recommendedAction: 'Run full BCCh backfill: npm run ingest:bcch-macro -- --all --write',
    })
  }

  return {
    status:            statusWinner([runStatus, staleIndicators.length > 0 ? 'warning' : 'healthy']),
    latestRunAt:       runAt,
    latestRunStatus:   runStat,
    indicatorsHealthy,
    indicatorsTotal,
    rowsFailed,
    staleIndicators,
    alerts,
  }
}

// ─── Market health ────────────────────────────────────────────────────────────

export function evaluateMarketIngestionHealth(input: MarketHealthInput): MarketHealthResult {
  const today = input.today ?? utcToday()
  const todayDate = new Date(today + 'T00:00:00Z')
  const alerts: HealthAlert[] = []

  const run = input.latestRun
  const runAt    = run?.startedAt ?? null
  const runStat  = run?.status    ?? null
  const rowsFailed = run?.rowsFailed ?? 0

  // ── Snapshot age (calendar days, snapshots are daily market data) ──────────
  let snapAgeDays = Infinity
  const snapDate = input.latestSnapshotDate
  if (snapDate) {
    const sd = new Date(snapDate + 'T00:00:00Z')
    if (!isNaN(sd.getTime())) snapAgeDays = calendarDaysBetween(sd, todayDate)
  }

  // ── Evaluate status ────────────────────────────────────────────────────────
  let status: HealthStatus = 'unknown'
  if (!run || runStat === null) {
    status = 'unknown'
  } else if (runStat === 'failed') {
    status = 'failed'
  } else if (runStat === 'success' || runStat === 'partial_success') {
    if (snapAgeDays <= MARKET_HEALTHY_DAYS)  status = 'healthy'
    else if (snapAgeDays <= MARKET_WARNING_DAYS) status = 'warning'
    else                                      status = 'stale'

    // partial_success with failed rows → at least warning
    if (runStat === 'partial_success' && rowsFailed > 0 && status === 'healthy') {
      status = 'warning'
    }
  }

  if (status === 'failed') {
    alerts.push({
      severity: 'critical',
      code: `MARKET_RUN_FAILED_${today}`,
      message: `Yahoo Finance market ingestion run failed at ${runAt ?? 'unknown'}`,
      recommendedAction: 'Check GitHub Actions refresh-market-data workflow. Manually trigger POST /api/cron/ingest-market-snapshot with MARKET_INGEST_SECRET.',
    })
  } else if (status === 'stale') {
    alerts.push({
      severity: 'critical',
      code: `MARKET_SNAPSHOT_STALE_${today}`,
      message: `Market snapshot is ${snapAgeDays} calendar days old (last snapshot: ${snapDate ?? 'never'})`,
      recommendedAction: 'Trigger GitHub Actions refresh-market-data workflow_dispatch or POST /api/cron/ingest-market-snapshot manually.',
    })
  } else if (status === 'warning') {
    if (runStat === 'partial_success' && rowsFailed > 0) {
      alerts.push({
        severity: 'warning',
        code: `MARKET_PARTIAL_${today}`,
        message: `Yahoo Finance ingestion was partial — ${rowsFailed} symbols failed`,
        recommendedAction: 'Check /api/market/live-snapshot to see which symbols are unavailable. Verify Yahoo Finance ticker mapping.',
      })
    } else {
      alerts.push({
        severity: 'warning',
        code: `MARKET_SNAPSHOT_AGING_${today}`,
        message: `Market snapshot is ${snapAgeDays} calendar days old (last: ${snapDate ?? 'never'})`,
        recommendedAction: 'Monitor. Weekends expected; check if a weekday refresh was missed.',
      })
    }
  } else if (status === 'unknown') {
    alerts.push({
      severity: 'warning',
      code: `MARKET_RUN_UNKNOWN_${today}`,
      message: 'No market ingestion run found — Supabase may not be configured or reachable',
      recommendedAction: 'Check MARKET_DATA_MODE and Supabase credentials.',
    })
  }

  return {
    status,
    latestRunAt:       runAt,
    latestSnapshotDate: snapDate,
    latestSnapshotType: input.latestSnapshotType,
    stockCount:  input.stockCount  ?? 0,
    indexCount:  input.indexCount  ?? 0,
    sectorCount: input.sectorCount ?? 0,
    rowsFailed,
    alerts,
  }
}

// ─── Overall health ───────────────────────────────────────────────────────────

export function evaluateOverallIngestionHealth(
  macro: MacroHealthResult,
  market: MarketHealthResult,
): OverallHealthResult {
  const allAlerts = [...macro.alerts, ...market.alerts]
  const overallStatus = statusWinner([macro.status, market.status])

  return {
    overallStatus,
    generatedAt: new Date().toISOString(),
    macro,
    market,
    alerts: allAlerts,
  }
}

// ─── Text summary for webhook payloads ───────────────────────────────────────

export function formatHealthSummary(result: OverallHealthResult): string {
  const icon = statusIcon(result.overallStatus)
  const lines: string[] = [
    `${icon} Ingestion Health: ${result.overallStatus.toUpperCase()}`,
    `Generated: ${result.generatedAt}`,
    '',
    `Macro BCCh: ${result.macro.status} | Last run: ${result.macro.latestRunAt ?? 'never'} | Indicators: ${result.macro.indicatorsHealthy}/${result.macro.indicatorsTotal}`,
    `Market Yahoo: ${result.market.status} | Last snapshot: ${result.market.latestSnapshotDate ?? 'never'} | Stocks: ${result.market.stockCount}`,
  ]
  if (result.alerts.length > 0) {
    lines.push('')
    lines.push('Alerts:')
    for (const a of result.alerts) {
      lines.push(`  [${a.severity.toUpperCase()}] ${a.message}`)
      lines.push(`    → ${a.recommendedAction}`)
    }
  }
  return lines.join('\n')
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const STATUS_RANK: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  stale: 3,
  failed: 4,
}

function statusWinner(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), 'healthy' as HealthStatus)
}

function statusIcon(s: HealthStatus): string {
  return { healthy: '✅', warning: '⚠️', stale: '🕐', failed: '❌', unknown: '❓' }[s] ?? '❓'
}
