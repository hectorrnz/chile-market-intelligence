// Phase 5D.1 — Ingestion health status endpoint.
// Public read-only — no auth required.
//
// GET /api/health/ingestion
//
// Returns a sanitized JSON summary of BCCh macro and Yahoo Finance market
// ingestion health. Never exposes credentials, DB URLs, or stack traces.

import { NextResponse } from 'next/server'
import { getMacroObservationSummary, getMacroIngestionStatus } from '@/lib/db/repositories/macroRepository'
import { getMarketSnapshotSummary, getLatestMarketIngestionRun } from '@/lib/db/repositories/marketRepository'
import {
  evaluateMacroIngestionHealth,
  evaluateMarketIngestionHealth,
  evaluateOverallIngestionHealth,
} from '@/lib/observability/ingestionHealth'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const [macroSummary, macroRuns, marketSummary, marketRun] = await Promise.all([
      getMacroObservationSummary(),
      getMacroIngestionStatus(5),
      getMarketSnapshotSummary(),
      getLatestMarketIngestionRun(),
    ])

    // Latest BCCh run (first in descending list, BCCh provider only)
    const macroLatestRun = macroRuns.data.find(r => r.provider === 'BCCh BDE') ?? macroRuns.data[0] ?? null

    const macroHealth = evaluateMacroIngestionHealth({
      latestRun: macroLatestRun
        ? {
            status:      macroLatestRun.status,
            startedAt:   macroLatestRun.startedAt,
            rowsFailed:  0,  // IngestionRunRecord has no rowsFailed field — use 0
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

    const overall = evaluateOverallIngestionHealth(macroHealth, marketHealth)

    // Sanitize: strip any internal alerts field from per-section (already
    // aggregated into overall.alerts). Return flat, readable structure.
    return NextResponse.json(
      {
        overallStatus: overall.overallStatus,
        generatedAt:   overall.generatedAt,
        macro: {
          status:             macroHealth.status,
          latestRunAt:        macroHealth.latestRunAt,
          latestRunStatus:    macroHealth.latestRunStatus,
          indicatorsHealthy:  macroHealth.indicatorsHealthy,
          indicatorsTotal:    macroHealth.indicatorsTotal,
          rowsFailed:         macroHealth.rowsFailed,
          staleIndicators:    macroHealth.staleIndicators,
        },
        market: {
          status:             marketHealth.status,
          latestRunAt:        marketHealth.latestRunAt,
          latestSnapshotDate: marketHealth.latestSnapshotDate,
          latestSnapshotType: marketHealth.latestSnapshotType,
          stockCount:         marketHealth.stockCount,
          indexCount:         marketHealth.indexCount,
          sectorCount:        marketHealth.sectorCount,
          rowsFailed:         marketHealth.rowsFailed,
        },
        alerts: overall.alerts,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'Unknown error'
    return NextResponse.json(
      { overallStatus: 'unknown', error: 'Health check failed', detail: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
