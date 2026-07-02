// Phase 6C — Portfolio repository.
// All operations are user-scoped; Supabase RLS enforces this at the DB layer.
// Route handlers must pass a user-session client (getSupabaseUserClient()) — the
// same pattern as watchlistRepository.ts. We never accept a client-supplied
// user_id: the row default (`default auth.uid()`) plus the RLS policy
// (`auth.uid() = user_id`) are the only source of truth for ownership.
//
// Note: Supabase JS type inference for user-scoped (auth) tables can be unreliable;
// results are cast via `as unknown as RowType` following the pattern in
// watchlistRepository.ts / macroRepository.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  Database,
  PortfolioRow as DbPortfolioRow,
  PortfolioPositionRow as DbPositionRow,
} from '../../supabase/database.types.ts'

type Client = SupabaseClient<Database>

// Read the static JSON directly (not via the '@/lib/data/companies' alias
// helper): the '@/*' path alias is resolved by Next.js/webpack at build time
// but not by Node's native test runner, which imports this file directly.
function loadCoveredTickers(): Set<string> {
  const jsonPath = fileURLToPath(new URL('../../../data/companies.json', import.meta.url))
  const companies = JSON.parse(readFileSync(jsonPath, 'utf8')) as { ticker: string }[]
  return new Set(companies.map((c) => c.ticker.toUpperCase()))
}

const VALID_TICKERS = loadCoveredTickers()

// ─── Repository-layer row types (camelCase, no db prefix) ─────────────────────

export interface PortfolioRow {
  id: string
  userId: string
  name: string
  baseCurrency: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface PortfolioPositionRow {
  id: string
  portfolioId: string
  userId: string
  ticker: string
  quantity: number
  averageCost: number | null
  costCurrency: string
  openedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** 'transactions' once Phase 6D has derived this position from a lot history; 'manual' otherwise (including all pre-6D rows, which have no positionSource key). */
  positionSource: 'manual' | 'transactions'
}

export type PositionMutationError =
  | 'invalid_ticker'
  | 'invalid_quantity'
  | 'invalid_average_cost'
  | 'duplicate'
  | 'not_found'
  | 'insert_failed'
  | 'update_failed'
  | 'delete_failed'

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapPortfolio(r: DbPortfolioRow): PortfolioRow {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    baseCurrency: r.base_currency,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Reads metadata.positionSource, defaulting to 'manual' for rows written before Phase 6D. */
export function getPositionSource(metadata: unknown): 'manual' | 'transactions' {
  if (
    metadata &&
    typeof metadata === 'object' &&
    (metadata as Record<string, unknown>).positionSource === 'transactions'
  ) {
    return 'transactions'
  }
  return 'manual'
}

function mapPosition(r: DbPositionRow): PortfolioPositionRow {
  return {
    id: r.id,
    portfolioId: r.portfolio_id,
    userId: r.user_id,
    ticker: r.ticker,
    quantity: Number(r.quantity),
    averageCost: r.average_cost === null ? null : Number(r.average_cost),
    costCurrency: r.cost_currency,
    openedAt: r.opened_at ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    positionSource: getPositionSource(r.metadata),
  }
}

const POSITION_SELECT =
  'id, portfolio_id, user_id, ticker, quantity, average_cost, cost_currency, opened_at, notes, metadata, created_at, updated_at'

// ─── Portfolio helpers ────────────────────────────────────────────────────────

export async function getUserPortfolios(client: Client): Promise<PortfolioRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolios')
    .select('id, user_id, name, base_currency, is_default, created_at, updated_at')
    .order('created_at', { ascending: true })

  const data = res.data as DbPortfolioRow[] | null
  if (res.error || !data) return []
  return data.map(mapPortfolio)
}

export async function getDefaultPortfolio(client: Client): Promise<PortfolioRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolios')
    .select('id, user_id, name, base_currency, is_default, created_at, updated_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  const data = res.data as DbPortfolioRow | null
  if (res.error || !data) return null
  return mapPortfolio(data)
}

export async function createPortfolio(
  client: Client,
  name: string,
  baseCurrency = 'CLP',
): Promise<PortfolioRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolios')
    .insert({ name, base_currency: baseCurrency, is_default: false })
    .select('id, user_id, name, base_currency, is_default, created_at, updated_at')
    .single()

  const data = res.data as DbPortfolioRow | null
  if (res.error || !data) return null
  return mapPortfolio(data)
}

/** Ensures the current user has a default portfolio, creating one ('Default', CLP) if missing. */
export async function ensureDefaultPortfolio(client: Client): Promise<PortfolioRow | null> {
  const existing = await getDefaultPortfolio(client)
  if (existing) return existing

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolios')
    .insert({ name: 'Default', base_currency: 'CLP', is_default: true })
    .select('id, user_id, name, base_currency, is_default, created_at, updated_at')
    .single()

  const data = res.data as DbPortfolioRow | null
  if (res.error || !data) return null
  return mapPortfolio(data)
}

// ─── Position helpers ─────────────────────────────────────────────────────────

export async function getPortfolioPositions(
  client: Client,
  portfolioId: string,
): Promise<PortfolioPositionRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_positions')
    .select(POSITION_SELECT)
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: true })

  const data = res.data as DbPositionRow[] | null
  if (res.error || !data) return []
  return data.map(mapPosition)
}

export interface AddPositionInput {
  ticker: string
  quantity: number
  averageCost?: number | null
  notes?: string | null
}

function validatePositionInput(
  input: AddPositionInput,
): PositionMutationError | null {
  const ticker = input.ticker.trim().toUpperCase()
  if (!ticker || !VALID_TICKERS.has(ticker)) return 'invalid_ticker'
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return 'invalid_quantity'
  if (
    input.averageCost !== undefined &&
    input.averageCost !== null &&
    (!Number.isFinite(input.averageCost) || input.averageCost < 0)
  ) {
    return 'invalid_average_cost'
  }
  return null
}

export async function addPosition(
  client: Client,
  portfolioId: string,
  input: AddPositionInput,
): Promise<{ ok: boolean; error?: PositionMutationError; position?: PortfolioPositionRow }> {
  const validationError = validatePositionInput(input)
  if (validationError) return { ok: false, error: validationError }

  const ticker = input.ticker.trim().toUpperCase()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_positions')
    .insert({
      portfolio_id: portfolioId,
      ticker,
      quantity: input.quantity,
      average_cost: input.averageCost ?? null,
      notes: input.notes?.trim() || null,
      metadata: { positionSource: 'manual' },
    })
    .select(POSITION_SELECT)
    .single()

  if (res.error) {
    // PostgreSQL unique violation code — ticker already in this portfolio.
    if ((res.error as { code?: string }).code === '23505') return { ok: false, error: 'duplicate' }
    return { ok: false, error: 'insert_failed' }
  }

  const data = res.data as DbPositionRow | null
  if (!data) return { ok: false, error: 'insert_failed' }
  return { ok: true, position: mapPosition(data) }
}

export interface UpdatePositionInput {
  quantity?: number
  averageCost?: number | null
  notes?: string | null
}

export async function updatePosition(
  client: Client,
  portfolioId: string,
  ticker: string,
  input: UpdatePositionInput,
): Promise<{ ok: boolean; error?: PositionMutationError; position?: PortfolioPositionRow }> {
  if (input.quantity !== undefined && (!Number.isFinite(input.quantity) || input.quantity <= 0)) {
    return { ok: false, error: 'invalid_quantity' }
  }
  if (
    input.averageCost !== undefined &&
    input.averageCost !== null &&
    (!Number.isFinite(input.averageCost) || input.averageCost < 0)
  ) {
    return { ok: false, error: 'invalid_average_cost' }
  }

  const patch: Record<string, unknown> = {}
  if (input.quantity !== undefined) patch.quantity = input.quantity
  if (input.averageCost !== undefined) patch.average_cost = input.averageCost
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_positions')
    .update(patch)
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker.toUpperCase())
    .select(POSITION_SELECT)
    .single()

  if (res.error) return { ok: false, error: 'update_failed' }
  const data = res.data as DbPositionRow | null
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, position: mapPosition(data) }
}

export async function removePosition(
  client: Client,
  portfolioId: string,
  ticker: string,
): Promise<{ ok: boolean; error?: PositionMutationError }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_positions')
    .delete()
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker.toUpperCase())

  if (res.error) return { ok: false, error: 'delete_failed' }
  return { ok: true }
}

/** Positions for a portfolio, joined with each ticker's sector/company name for display. */
export async function getPortfolioSummary(
  client: Client,
  portfolioId: string,
): Promise<{ positions: PortfolioPositionRow[] }> {
  const positions = await getPortfolioPositions(client, portfolioId)
  return { positions }
}
