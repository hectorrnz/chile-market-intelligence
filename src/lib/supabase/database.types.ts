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
      portfolio_transactions: {
        Row: {
          id: string
          portfolio_id: string
          user_id: string
          ticker: string
          transaction_type: string
          trade_date: string
          settlement_date: string | null
          quantity: number
          price: number
          gross_amount: number | null
          fees: number
          taxes: number
          net_amount: number | null
          currency: string
          realized_pnl: number | null
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
          transaction_type: string
          trade_date: string
          settlement_date?: string | null
          quantity: number
          price: number
          gross_amount?: number | null
          fees?: number
          taxes?: number
          net_amount?: number | null
          currency?: string
          realized_pnl?: number | null
          notes?: string | null
          tags?: string[]
          metadata?: Record<string, unknown>
        }
        Update: {
          transaction_type?: string
          trade_date?: string
          settlement_date?: string | null
          quantity?: number
          price?: number
          gross_amount?: number | null
          fees?: number
          taxes?: number
          net_amount?: number | null
          realized_pnl?: number | null
          notes?: string | null
          tags?: string[]
          metadata?: Record<string, unknown>
        }
      }
      portfolio_cash_ledger: {
        Row: {
          id: string
          portfolio_id: string
          user_id: string
          transaction_id: string | null
          ledger_date: string
          currency: string
          entry_type: string
          amount: number
          description: string | null
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          portfolio_id: string
          user_id?: string
          transaction_id?: string | null
          ledger_date: string
          currency?: string
          entry_type: string
          amount: number
          description?: string | null
          metadata?: Record<string, unknown>
        }
        Update: {
          ledger_date?: string
          currency?: string
          entry_type?: string
          amount?: number
          description?: string | null
          metadata?: Record<string, unknown>
        }
      }
      company_reporting_periods: {
        Row: {
          id: string
          ticker: string
          fiscal_year: number
          fiscal_period: string
          period_type: string
          period_end_date: string
          report_date: string | null
          currency: string
          source_type: string
          source_name: string | null
          source_url: string | null
          source_file: string | null
          source_as_of: string | null
          ingestion_run_id: string | null
          source_priority: number
          is_superseded: boolean
          superseded_by: string | null
          filing_id: string | null
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticker: string
          fiscal_year: number
          fiscal_period: string
          period_type: string
          period_end_date: string
          report_date?: string | null
          currency?: string
          source_type: string
          source_name?: string | null
          source_url?: string | null
          source_file?: string | null
          source_as_of?: string | null
          ingestion_run_id?: string | null
          source_priority?: number
          is_superseded?: boolean
          superseded_by?: string | null
          filing_id?: string | null
          metadata?: Record<string, unknown>
        }
        Update: {
          fiscal_year?: number
          fiscal_period?: string
          period_type?: string
          period_end_date?: string
          report_date?: string | null
          currency?: string
          source_name?: string | null
          source_url?: string | null
          source_file?: string | null
          source_as_of?: string | null
          ingestion_run_id?: string | null
          source_priority?: number
          is_superseded?: boolean
          superseded_by?: string | null
          filing_id?: string | null
          metadata?: Record<string, unknown>
        }
      }
      financial_statement_items: {
        Row: {
          id: string
          reporting_period_id: string
          ticker: string
          statement_type: string
          line_item_code: string
          line_item_name: string
          value: number | null
          unit: string
          scale: string | null
          source_type: string
          source_name: string | null
          source_url: string | null
          source_file: string | null
          source_as_of: string | null
          ingestion_run_id: string | null
          source_priority: number
          is_superseded: boolean
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          reporting_period_id: string
          ticker: string
          statement_type: string
          line_item_code: string
          line_item_name: string
          value?: number | null
          unit?: string
          scale?: string | null
          source_type: string
          source_name?: string | null
          source_url?: string | null
          source_file?: string | null
          source_as_of?: string | null
          ingestion_run_id?: string | null
          source_priority?: number
          is_superseded?: boolean
          metadata?: Record<string, unknown>
        }
        Update: {
          value?: number | null
          unit?: string
          scale?: string | null
          is_superseded?: boolean
          metadata?: Record<string, unknown>
        }
      }
      financial_metrics: {
        Row: {
          id: string
          reporting_period_id: string
          ticker: string
          metric_code: string
          metric_name: string
          value: number | null
          unit: string | null
          source_type: string
          source_name: string | null
          source_url: string | null
          source_file: string | null
          source_as_of: string | null
          ingestion_run_id: string | null
          calculation_method: string | null
          source_priority: number
          is_superseded: boolean
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          reporting_period_id: string
          ticker: string
          metric_code: string
          metric_name: string
          value?: number | null
          unit?: string | null
          source_type: string
          source_name?: string | null
          source_url?: string | null
          source_file?: string | null
          source_as_of?: string | null
          ingestion_run_id?: string | null
          calculation_method?: string | null
          source_priority?: number
          is_superseded?: boolean
          metadata?: Record<string, unknown>
        }
        Update: {
          value?: number | null
          unit?: string | null
          calculation_method?: string | null
          is_superseded?: boolean
          metadata?: Record<string, unknown>
        }
      }
      earnings_events: {
        Row: {
          id: string
          ticker: string
          fiscal_year: number | null
          fiscal_period: string | null
          period_type: string | null
          report_date: string | null
          event_date: string | null
          status: string
          revenue: number | null
          ebitda: number | null
          net_income: number | null
          eps: number | null
          currency: string | null
          source_type: string
          source_name: string | null
          source_url: string | null
          source_file: string | null
          source_as_of: string | null
          ingestion_run_id: string | null
          source_priority: number
          is_superseded: boolean
          superseded_by: string | null
          reporting_period_id: string | null
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticker: string
          fiscal_year?: number | null
          fiscal_period?: string | null
          period_type?: string | null
          report_date?: string | null
          event_date?: string | null
          status?: string
          revenue?: number | null
          ebitda?: number | null
          net_income?: number | null
          eps?: number | null
          currency?: string | null
          source_type: string
          source_name?: string | null
          source_url?: string | null
          source_file?: string | null
          source_as_of?: string | null
          ingestion_run_id?: string | null
          source_priority?: number
          is_superseded?: boolean
          superseded_by?: string | null
          reporting_period_id?: string | null
          metadata?: Record<string, unknown>
        }
        Update: {
          fiscal_year?: number | null
          fiscal_period?: string | null
          period_type?: string | null
          report_date?: string | null
          event_date?: string | null
          status?: string
          revenue?: number | null
          ebitda?: number | null
          net_income?: number | null
          eps?: number | null
          source_name?: string | null
          source_url?: string | null
          source_file?: string | null
          source_as_of?: string | null
          ingestion_run_id?: string | null
          source_priority?: number
          is_superseded?: boolean
          superseded_by?: string | null
          reporting_period_id?: string | null
          metadata?: Record<string, unknown>
        }
      }
      structured_notes: {
        Row: {
          id: string
          user_id: string
          isin: string | null
          product_name: string
          issuer_name: string | null
          issuer_display_name: string | null
          guarantor_name: string | null
          structure_type: string
          payoff_type: string | null
          currency: string
          issue_size: number | null
          denomination: number | null
          issue_price_pct: number | null
          trade_date: string | null
          issue_date: string | null
          initial_valuation_date: string | null
          final_valuation_date: string | null
          maturity_date: string | null
          redemption_date: string | null
          coupon_frequency: string | null
          coupon_rate_periodic: number | null
          coupon_rate_annualized: number | null
          memory_coupon: boolean
          principal_protection: boolean
          knock_in_barrier_pct: number | null
          coupon_barrier_pct: number | null
          autocall_barrier_pct: number | null
          status: string
          source_type: string
          source_name: string | null
          source_file_name: string | null
          source_file_hash: string | null
          source_url: string | null
          extraction_run_id: string | null
          confidence_score: number | null
          metadata: Record<string, unknown>
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_underlyings: {
        Row: {
          id: string
          note_id: string
          user_id: string
          underlying_order: number
          underlying_name: string
          source_ticker: string | null
          bloomberg_ticker: string | null
          yahoo_symbol: string | null
          asset_class: string
          initial_level: number | null
          strike_level: number | null
          knock_in_barrier_level: number | null
          coupon_barrier_level: number | null
          autocall_barrier_level: number | null
          knock_in_barrier_pct: number | null
          coupon_barrier_pct: number | null
          autocall_barrier_pct: number | null
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_observations: {
        Row: {
          id: string
          note_id: string
          user_id: string
          observation_number: number
          observation_type: string
          valuation_date: string
          payment_date: string | null
          redemption_date: string | null
          coupon_due_pct: number | null
          autocall_barrier_pct: number | null
          coupon_barrier_pct: number | null
          status: string
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
          // Phase 9D — populated by the scheduled monitoring cron, distinct from
          // the extraction-time terms above.
          observed_at: string | null
          observed_source: string | null
          observed_source_symbol: string | null
          observed_levels: Record<string, unknown> | null
          worst_performer_ticker: string | null
          worst_performer_return: number | null
          coupon_eligible: boolean | null
          autocall_eligible: boolean | null
          final_barrier_breached: boolean | null
          review_required: boolean
          review_reason: string | null
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_allocations: {
        Row: {
          id: string
          note_id: string
          user_id: string
          entity_name: string
          custodian: string | null
          notional_amount: number
          currency: string
          active: boolean
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_price_snapshots: {
        Row: {
          id: string
          note_id: string
          underlying_id: string
          // Phase 9D — nullable: the scheduled monitoring cron writes via the
          // service-role admin client with no authenticated session, so
          // `default auth.uid()` can no longer be relied on to populate this.
          user_id: string | null
          price_date: string
          price: number | null
          source: string
          source_symbol: string | null
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_monitoring_runs: {
        Row: {
          id: string
          run_type: string
          status: string
          started_at: string
          completed_at: string | null
          active_note_count: number | null
          underlying_count: number | null
          prices_requested: number | null
          prices_succeeded: number | null
          prices_failed: number | null
          observations_checked: number | null
          observations_updated: number | null
          notes_updated: number | null
          warnings: unknown[]
          errors: unknown[]
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_extraction_runs: {
        Row: {
          id: string
          user_id: string
          file_name: string | null
          file_hash: string | null
          parser_version: string | null
          status: string
          extracted_note_id: string | null
          confidence_score: number | null
          fields_seen: number | null
          fields_extracted: number | null
          fields_low_confidence: number | null
          warnings: unknown[]
          errors: unknown[]
          extracted_payload: Record<string, unknown> | null
          provenance: Record<string, unknown>
          created_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      structured_note_extracted_fields: {
        Row: {
          id: string
          extraction_run_id: string
          note_id: string | null
          user_id: string
          field_path: string
          extracted_value: string | null
          normalized_value: string | null
          confidence: number | null
          source_page: number | null
          source_section: string | null
          raw_excerpt: string | null
          warning: string | null
          created_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

// ─── Phase 8C convenience aliases ─────────────────────────────────────────────
export type CompanyReportingPeriodRow = Database['public']['Tables']['company_reporting_periods']['Row']
export type FinancialStatementItemRow = Database['public']['Tables']['financial_statement_items']['Row']
export type FinancialMetricRow = Database['public']['Tables']['financial_metrics']['Row']
export type EarningsEventRow = Database['public']['Tables']['earnings_events']['Row']

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
export type PortfolioTransactionRow = Database['public']['Tables']['portfolio_transactions']['Row']
export type PortfolioCashLedgerRow = Database['public']['Tables']['portfolio_cash_ledger']['Row']

// ─── Phase 9A structured-notes aliases ────────────────────────────────────────
export type StructuredNoteRow = Database['public']['Tables']['structured_notes']['Row']
export type StructuredNoteUnderlyingRow = Database['public']['Tables']['structured_note_underlyings']['Row']
export type StructuredNoteObservationRow = Database['public']['Tables']['structured_note_observations']['Row']
export type StructuredNoteAllocationRow = Database['public']['Tables']['structured_note_allocations']['Row']
export type StructuredNotePriceSnapshotRow = Database['public']['Tables']['structured_note_price_snapshots']['Row']
export type StructuredNoteMonitoringRunRow = Database['public']['Tables']['structured_note_monitoring_runs']['Row']
export type StructuredNoteExtractionRunRow = Database['public']['Tables']['structured_note_extraction_runs']['Row']
export type StructuredNoteExtractedFieldRow = Database['public']['Tables']['structured_note_extracted_fields']['Row']
