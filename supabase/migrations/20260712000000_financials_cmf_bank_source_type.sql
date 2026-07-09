-- Phase 8C.8 — allow source_type = 'cmf_bank' on the financials tables.
--
-- cmf_bank is the OFFICIAL CMF bank regulatory source discovered in Phase
-- 8C.7 ("Balance y Estado de Situación Bancos" — a monthly, non-XBRL,
-- tab-delimited regulatory feed under the Compendio de Normas Contables para
-- Bancos chart of accounts) for the 4 bank tickers CMF/XBRL structurally
-- cannot reach (BSANTANDER, CHILE, BCI, ITAUCL). It is official CMF data —
-- unlike yahoo_finance (an unofficial free aggregator) — so its
-- source_priority (set in financialsRepository.ts DEFAULT_SOURCE_PRIORITY) is
-- deliberately ABOVE yahoo_finance (80) and manual_csv (100), but below the
-- non-bank xbrl (210) and cmf_fecu (200) — it is a lower-detail regulatory
-- report (14 mapped fields), not a full audited IFRS statement. Yahoo Finance
-- remains active for bank quarterly/TTM/earlier-year/unmapped-field data;
-- cmf_bank only supersedes Yahoo's matching annual period for the 14 mapped
-- fields.
--
-- Purely additive + idempotent: drops each existing source_type CHECK (if
-- present) and re-adds it with 'cmf_bank' appended. No data change.

do $$
declare
  t text;
  tables text[] := array['company_reporting_periods', 'financial_statement_items', 'financial_metrics', 'earnings_events'];
begin
  foreach t in array tables loop
    execute format('alter table %I drop constraint if exists %I', t, t || '_source_type_check');
    execute format(
      'alter table %I add constraint %I check (source_type in (''manual_csv'', ''cmf_fecu'', ''xbrl'', ''vendor_feed'', ''broker_feed'', ''document_ingestion'', ''static_seed'', ''derived'', ''yahoo_finance'', ''cmf_bank''))',
      t, t || '_source_type_check'
    );
  end loop;
end $$;
