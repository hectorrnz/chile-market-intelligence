// Phase 5B — Provisional Supabase database types.
//
// These are manually authored to match the migration SQL in
// supabase/migrations/20260625000000_create_market_intelligence_core.sql
// and the auth/watchlist tables from 20260701000000_auth_watchlist_foundation.sql
//
// Once a Supabase project is linked, replace with generated output from:
//   npx supabase gen types typescript --project-id <your-ref> > src/lib/supabase/database.types.ts
//
// Phase 6A note: Use explicit field types (not Omit<Database[...]>) for all
// Insert/Update types — Omit with self-referential Database types exceeds
// TypeScript 5.9's recursion depth limit when the Tables object grows.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      data_sources: {
        Row: {
          id: string
          provider: string
          source_type: string
          display_name: string
          base_url: string | null
          status: string
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          provider: string
          source_type: string
          display_name: string
          base_url?: string | null
          status?: string
          metadata?: Json
        }
        Update: {
          provider?: string
          source_type?: string
          display_name?: string
          base_url?: string | null
          status?: string
          metadata?: Json
        }
      }
      companies: {
        Row: {
          id: string
          ticker: string
          name: string
          legal_name: string | null
          sector: string | null
          industry: string | null
          exchange: string | null
          currency: string | null
          country: string
          website: string | null
          cmf_rut: string | null
          cmf_entity_url: string | null
          active: boolean
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticker: string
          name: string
          legal_name?: string | null
          sector?: string | null
          industry?: string | null
          exchange?: string | null
          currency?: string | null
          country?: string
          website?: string | null
          cmf_rut?: string | null
          cmf_entity_url?: string | null
          active?: boolean
          metadata?: Json
        }
        Update: {
          ticker?: string
          name?: string
          legal_name?: string | null
          sector?: string | null
          industry?: string | null
          exchange?: string | null
          currency?: string | null
          country?: string
          website?: string | null
          cmf_rut?: string | null
          cmf_entity_url?: string | null
          active?: boolean
          metadata?: Json
        }
      }
      macro_indicators: {
        Row: {
          id: string
          region: string
          name: string
          short_name: string | null
          category: string | null
          unit: string | null
          source_provider: string | null
          provider_series_code: string | null
          transformation: string | null
          live_enabled: boolean
          metadata: Json
          updated_at: string
        }
        Insert: {
          id?: string
          region?: string
          name: string
          short_name?: string | null
          category?: string | null
          unit?: string | null
          source_provider?: string | null
          provider_series_code?: string | null
          transformation?: string | null
          live_enabled?: boolean
          metadata?: Json
        }
        Update: {
          region?: string
          name?: string
          short_name?: string | null
          category?: string | null
          unit?: string | null
          source_provider?: string | null
          provider_series_code?: string | null
          transformation?: string | null
          live_enabled?: boolean
          metadata?: Json
        }
      }
      macro_observations: {
        Row: {
          id: string
          indicator_id: string
          observation_date: string
          value: number | null
          source_provider: string | null
          source_series_code: string
          fetched_at: string
          metadata: Json
        }
        Insert: {
          id?: string
          indicator_id: string
          observation_date: string
          value?: number | null
          source_provider?: string | null
          source_series_code: string
          fetched_at?: string
          metadata?: Json
        }
        Update: {
          indicator_id?: string
          observation_date?: string
          value?: number | null
          source_provider?: string | null
          source_series_code?: string
          fetched_at?: string
          metadata?: Json
        }
      }
      stock_snapshots: {
        Row: {
          id: string
          ticker: string
          price: number | null
          currency: string | null
          day_change: number | null
          day_change_pct: number | null
          volume: number | null
          avg_volume_30d: number | null
          market_cap: number | null
          last_updated: string | null
          provider: string | null
          status: string | null
          metadata: Json
          snapshot_date: string | null
          snapshot_type: string | null
          ytd_change_pct: number | null
          source: string | null
        }
        Insert: {
          id?: string
          ticker: string
          price?: number | null
          currency?: string | null
          day_change?: number | null
          day_change_pct?: number | null
          volume?: number | null
          avg_volume_30d?: number | null
          market_cap?: number | null
          last_updated?: string | null
          provider?: string | null
          status?: string | null
          metadata?: Json
          snapshot_date?: string | null
          snapshot_type?: string | null
          ytd_change_pct?: number | null
          source?: string | null
        }
        Update: {
          ticker?: string
          price?: number | null
          currency?: string | null
          day_change?: number | null
          day_change_pct?: number | null
          volume?: number | null
          avg_volume_30d?: number | null
          market_cap?: number | null
          last_updated?: string | null
          provider?: string | null
          status?: string | null
          metadata?: Json
          snapshot_date?: string | null
          snapshot_type?: string | null
          ytd_change_pct?: number | null
          source?: string | null
        }
      }
      stock_ohlcv: {
        Row: {
          id: string
          ticker: string
          timestamp: string
          open: number | null
          high: number | null
          low: number | null
          close: number | null
          volume: number | null
          provider: string | null
          metadata: Json
        }
        Insert: {
          id?: string
          ticker: string
          timestamp: string
          open?: number | null
          high?: number | null
          low?: number | null
          close?: number | null
          volume?: number | null
          provider?: string | null
          metadata?: Json
        }
        Update: {
          ticker?: string
          timestamp?: string
          open?: number | null
          high?: number | null
          low?: number | null
          close?: number | null
          volume?: number | null
          provider?: string | null
          metadata?: Json
        }
      }
      index_snapshots: {
        Row: {
          id: string
          index_id: string
          name: string
          country: string | null
          value: number | null
          day_change: number | null
          day_change_pct: number | null
          ytd_change_pct: number | null
          last_updated: string | null
          provider: string | null
          metadata: Json
          snapshot_date: string | null
          snapshot_type: string | null
          currency: string | null
          proxy_of: string | null
        }
        Insert: {
          id?: string
          index_id: string
          name: string
          country?: string | null
          value?: number | null
          day_change?: number | null
          day_change_pct?: number | null
          ytd_change_pct?: number | null
          last_updated?: string | null
          provider?: string | null
          metadata?: Json
          snapshot_date?: string | null
          snapshot_type?: string | null
          currency?: string | null
          proxy_of?: string | null
        }
        Update: {
          index_id?: string
          name?: string
          country?: string | null
          value?: number | null
          day_change?: number | null
          day_change_pct?: number | null
          ytd_change_pct?: number | null
          last_updated?: string | null
          provider?: string | null
          metadata?: Json
          snapshot_date?: string | null
          snapshot_type?: string | null
          currency?: string | null
          proxy_of?: string | null
        }
      }
      sector_performance: {
        Row: {
          id: string
          sector: string
          day_change_pct: number | null
          ytd_change_pct: number | null
          number_of_stocks: number | null
          top_contributor: string | null
          worst_contributor: string | null
          last_updated: string | null
          provider: string | null
          metadata: Json
          snapshot_date: string | null
          snapshot_type: string | null
          top_contributor_pct: number | null
          worst_contributor_pct: number | null
        }
        Insert: {
          id?: string
          sector: string
          day_change_pct?: number | null
          ytd_change_pct?: number | null
          number_of_stocks?: number | null
          top_contributor?: string | null
          worst_contributor?: string | null
          last_updated?: string | null
          provider?: string | null
          metadata?: Json
          snapshot_date?: string | null
          snapshot_type?: string | null
          top_contributor_pct?: number | null
          worst_contributor_pct?: number | null
        }
        Update: {
          sector?: string
          day_change_pct?: number | null
          ytd_change_pct?: number | null
          number_of_stocks?: number | null
          top_contributor?: string | null
          worst_contributor?: string | null
          last_updated?: string | null
          provider?: string | null
          metadata?: Json
          snapshot_date?: string | null
          snapshot_type?: string | null
          top_contributor_pct?: number | null
          worst_contributor_pct?: number | null
        }
      }
      cmf_filings: {
        Row: {
          id: string
          document_number: string | null
          filing_type: string | null
          entity_name: string | null
          ticker: string | null
          rut: string | null
          filing_date: string | null
          filing_time: string | null
          filing_datetime: string | null
          subject: string | null
          category: string | null
          title: string | null
          summary: string | null
          materiality: string | null
          source_url: string | null
          document_url: string | null
          provider: string | null
          status: string | null
          fetched_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          document_number?: string | null
          filing_type?: string | null
          entity_name?: string | null
          ticker?: string | null
          rut?: string | null
          filing_date?: string | null
          filing_time?: string | null
          filing_datetime?: string | null
          subject?: string | null
          category?: string | null
          title?: string | null
          summary?: string | null
          materiality?: string | null
          source_url?: string | null
          document_url?: string | null
          provider?: string | null
          status?: string | null
          fetched_at?: string | null
          metadata?: Json
        }
        Update: {
          document_number?: string | null
          filing_type?: string | null
          entity_name?: string | null
          ticker?: string | null
          rut?: string | null
          filing_date?: string | null
          filing_time?: string | null
          filing_datetime?: string | null
          subject?: string | null
          category?: string | null
          title?: string | null
          summary?: string | null
          materiality?: string | null
          source_url?: string | null
          document_url?: string | null
          provider?: string | null
          status?: string | null
          fetched_at?: string | null
          metadata?: Json
        }
      }
      documents: {
        Row: {
          id: string
          external_id: string | null
          related_type: string | null
          related_id: string | null
          ticker: string | null
          company_name: string | null
          title: string
          document_type: string | null
          source: string | null
          source_url: string | null
          document_url: string | null
          file_type: string | null
          local_status: string | null
          text_status: string | null
          ai_summary_status: string | null
          ai_summary: string | null
          key_points: Json
          published_at: string | null
          fetched_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          external_id?: string | null
          related_type?: string | null
          related_id?: string | null
          ticker?: string | null
          company_name?: string | null
          title: string
          document_type?: string | null
          source?: string | null
          source_url?: string | null
          document_url?: string | null
          file_type?: string | null
          local_status?: string | null
          text_status?: string | null
          ai_summary_status?: string | null
          ai_summary?: string | null
          key_points?: Json
          published_at?: string | null
          fetched_at?: string | null
          metadata?: Json
        }
        Update: {
          external_id?: string | null
          related_type?: string | null
          related_id?: string | null
          ticker?: string | null
          company_name?: string | null
          title?: string
          document_type?: string | null
          source?: string | null
          source_url?: string | null
          document_url?: string | null
          file_type?: string | null
          local_status?: string | null
          text_status?: string | null
          ai_summary_status?: string | null
          ai_summary?: string | null
          key_points?: Json
          published_at?: string | null
          fetched_at?: string | null
          metadata?: Json
        }
      }
      ingestion_runs: {
        Row: {
          id: string
          provider: string
          job_type: string
          status: string
          started_at: string
          finished_at: string | null
          rows_seen: number | null
          rows_inserted: number | null
          rows_updated: number | null
          rows_failed: number | null
          error_message: string | null
          metadata: Json
        }
        Insert: {
          id?: string
          provider: string
          job_type: string
          status?: string
          started_at?: string
          finished_at?: string | null
          rows_seen?: number | null
          rows_inserted?: number | null
          rows_updated?: number | null
          rows_failed?: number | null
          error_message?: string | null
          metadata?: Json
        }
        Update: {
          provider?: string
          job_type?: string
          status?: string
          finished_at?: string | null
          rows_seen?: number | null
          rows_inserted?: number | null
          rows_updated?: number | null
          rows_failed?: number | null
          error_message?: string | null
          metadata?: Json
        }
      }
      user_profiles: {
        Row: {
          id: string
          username: string | null
          email: string | null
          display_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username?: string | null
          email?: string | null
          display_name?: string | null
          avatar_url?: string | null
        }
        Update: {
          username?: string | null
          email?: string | null
          display_name?: string | null
          avatar_url?: string | null
        }
      }
      watchlists: {
        Row: {
          id: string
          user_id: string
          name: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          name: string
        }
        Update: {
          name?: string
        }
      }
      watchlist_items: {
        Row: {
          id: string
          watchlist_id: string
          user_id: string
          ticker: string
          notes: string | null
          added_at: string
        }
        Insert: {
          id?: string
          watchlist_id: string
          user_id?: string
          ticker: string
          notes?: string | null
        }
        Update: {
          notes?: string | null
        }
      }
      portfolios: {
        Row: {
          id: string
          user_id: string
          name: string
          base_currency: string
          is_default: boolean
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          name: string
          base_currency?: string
          is_default?: boolean
          metadata?: Record<string, unknown>
        }
        Update: {
          name?: string
          base_currency?: string
          is_default?: boolean
          metadata?: Record<string, unknown>
        }
      }
      portfolio_positions: {
        Row: {
          id: string
          portfolio_id: string
          user_id: string
          ticker: string
          quantity: number
          average_cost: number | null
          cost_currency: string
          opened_at: string | null
          notes: string | null
          tags: string[]
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          portfolio_id: string
          user_id?: string
          ticker: string
          quantity: number
          average_cost?: number | null
          cost_currency?: string
          opened_at?: string | null
          notes?: string | null
          tags?: string[]
          metadata?: Record<string, unknown>
        }
        Update: {
          quantity?: number
          average_cost?: number | null
          cost_currency?: string
          opened_at?: string | null
          notes?: string | null
          tags?: string[]
          metadata?: Record<string, unknown>
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

// Convenience row types
export type DataSourceRow = Database['public']['Tables']['data_sources']['Row']
export type CompanyRow = Database['public']['Tables']['companies']['Row']
export type MacroIndicatorRow = Database['public']['Tables']['macro_indicators']['Row']
export type MacroObservationRow = Database['public']['Tables']['macro_observations']['Row']
export type StockSnapshotRow = Database['public']['Tables']['stock_snapshots']['Row']
export type StockOhlcvRow = Database['public']['Tables']['stock_ohlcv']['Row']
export type IndexSnapshotRow = Database['public']['Tables']['index_snapshots']['Row']
export type SectorPerformanceRow = Database['public']['Tables']['sector_performance']['Row']
export type CmfFilingRow = Database['public']['Tables']['cmf_filings']['Row']
export type DocumentRow = Database['public']['Tables']['documents']['Row']
export type IngestionRunRow = Database['public']['Tables']['ingestion_runs']['Row']
export type UserProfileRow = Database['public']['Tables']['user_profiles']['Row']
export type WatchlistRow = Database['public']['Tables']['watchlists']['Row']
export type WatchlistItemRow = Database['public']['Tables']['watchlist_items']['Row']
export type PortfolioRow = Database['public']['Tables']['portfolios']['Row']
export type PortfolioPositionRow = Database['public']['Tables']['portfolio_positions']['Row']
