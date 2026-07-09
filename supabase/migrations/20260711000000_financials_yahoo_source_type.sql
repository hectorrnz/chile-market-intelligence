-- Phase 8C.5 — allow source_type = 'yahoo_finance' on the financials tables.
--
-- Yahoo Finance is the universal fundamentals fallback (quarterly + annual for
-- all 25 app stocks, including the 4 banks that CMF/XBRL structurally can't
-- reach). It is an UNOFFICIAL third-party aggregator — the same status the app
-- already gives Yahoo prices — so its source_priority (set in
-- financialsRepository.ts DEFAULT_SOURCE_PRIORITY) is deliberately LOW (80):
-- below manual_csv (100) and every official/vendor source, above derived (50)
-- and static_seed (10). CMF/XBRL annual (210) therefore still supersedes Yahoo
-- annual for the same fiscal year; Yahoo quarterly coexists (different logical
-- period), which is what makes every stock's Charting/Compare/Earnings tabs work.
--
-- Purely additive + idempotent: drops each existing source_type CHECK (if
-- present) and re-adds it with 'yahoo_finance' appended. No data change.

do $$
declare
  t text;
  tables text[] := array['company_reporting_periods', 'financial_statement_items', 'financial_metrics', 'earnings_events'];
begin
  foreach t in array tables loop
    execute format('alter table %I drop constraint if exists %I', t, t || '_source_type_check');
    execute format(
      'alter table %I add constraint %I check (source_type in (''manual_csv'', ''cmf_fecu'', ''xbrl'', ''vendor_feed'', ''broker_feed'', ''document_ingestion'', ''static_seed'', ''derived'', ''yahoo_finance''))',
      t, t || '_source_type_check'
    );
  end loop;
end $$;
