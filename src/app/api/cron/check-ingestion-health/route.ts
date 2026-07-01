// Phase 5D.1 — Vercel Cron route: evaluate ingestion health and send alerts.
//
// Vercel Cron invokes this via GET with:
//   Authorization: Bearer <CRON_SECRET>
//
// Manual trigger (curl):
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://nevada-market-intelligence.vercel.app/api/cron/check-ingestion-health
//
// Local dev:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     http://localhost:3000/api/cron/check-ingestion-health
//
// Optional query params:
//   ?dryRun=true   — evaluate health but do not send webhook
//   ?force=true    — send alert even if status is healthy (for testing)
//
// Response: JSON with health summary and alert delivery outcome.
// Credentials never appear in responses.

import { NextRequest, NextResponse } from 'next/server'
import { getMacroObservationSummary, getMacroIngestionStatus } from '@/lib/db/repositories/macroRepository'
import { getMarketSnapshotSummary, getLatestMarketIngestionRun } from '@/lib/db/repositories/marketRepository'
import {
  evaluateMacroIngestionHealth,
  evaluateMarketIngestionHealth,
  evaluateOverallIngestionHealth,
} from '@/lib/observability/ingestionHealth'
import { deliverAlertIfNeeded } from '@/lib/observability/alertDelivery'

export const dynamic    = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { error: 'Cron not configured — CRON_SECRET missing' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Options ───────────────────────────────────────────────────────────────
  const url    = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const force  = url.searchParams.get('force')  === 'true'

  // ── Gather ingestion data ─────────────────────────────────────────────────
  try {
    const [macroSummary, macroRuns, marketSummary, marketRun] = await Promise.all([
      getMacroObservationSummary(),
      getMacroIngestionStatus(5),
      getMarketSnapshotSummary(),
      getLatestMarketIngestionRun(),
    ])

    const macroLatestRun = macroRuns.data.find(r => r.provider === 'BCCh BDE') ?? macroRuns.data[0] ?? null

    const macroHealth = evaluateMacroIngestionHealth({
      latestRun: macroLatestRun
        ? {
            status:      macroLatestRun.status,
            startedAt:   macroLatestRun.startedAt,
            rowsFailed:  0,
            rowsInserted: macroLatestRun.rowsInserted,
          }
        : null,
      observations: macroSummary.data.map(obs => ({
        indicatorId: obs.indicatorId,
        maxDate:     obs.maxDate,
        count:       obs.count,
      })),
    })

    const marketHealth = evaluateMarketIngestionHealth({
      latestRun: marketRun
        ? {
            status:      marketRun.status,
            startedAt:   marketRun.startedAt,
            rowsFailed:  marketRun.rowsFailed ?? 0,
            rowsInserted: marketRun.rowsInserted,
          }
        : null,
      latestSnapshotDate: marketSummary.latestSnapshotDate,
      latestSnapshotType: marketSummary.latestSnapshotType,
      stockCount:  marketSummary.stockCount,
      indexCount:  marketSummary.indexCount,
      sectorCount: marketSummary.sectorCount,
    })

    const overall  = evaluateOverallIngestionHealth(macroHealth, marketHealth)
    const delivery = await deliverAlertIfNeeded(overall, { dryRun, force })

    return NextResponse.json({
      success:       true,
      overallStatus: overall.overallStatus,
      generatedAt:   overall.generatedAt,
      macro: {
        status:          macroHealth.status,
        latestRunAt:     macroHealth.latestRunAt,
        latestRunStatus: macroHealth.latestRunStatus,
        indicatorsHealthy: macroHealth.indicatorsHealthy,
        indicatorsTotal:   macroHealth.indicatorsTotal,
        staleIndicators:   macroHealth.staleIndicators,
      },
      market: {
        status:             marketHealth.status,
        latestRunAt:        marketHealth.latestRunAt,
        latestSnapshotDate: marketHealth.latestSnapshotDate,
        latestSnapshotType: marketHealth.latestSnapshotType,
        stockCount:         marketHealth.stockCount,
      },
      alerts:         overall.alerts,
      alertDelivery: {
        sent:       delivery.sent,
        suppressed: delivery.suppressed,
        ...(delivery.reason ? { reason: delivery.reason } : {}),
      },
      alertSuppressed: delivery.suppressed,
      dryRun,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'Unknown error'
    return NextResponse.json(
      { success: false, error: 'Health check failed', detail: msg },
      { status: 500 },
    )
  }
}
