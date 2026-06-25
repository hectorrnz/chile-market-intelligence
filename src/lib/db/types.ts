// Phase 5B — DB layer types (repository-facing, provider-agnostic).

export type DbMode = 'static' | 'supabase' | 'hybrid'

export interface DbResult<T> {
  data: T
  source: 'static' | 'supabase'
  error?: string
}

export interface DbListResult<T> extends DbResult<T[]> {
  count?: number
}

export interface DbConfig {
  mode: DbMode
  supabaseConfigured: boolean
}
