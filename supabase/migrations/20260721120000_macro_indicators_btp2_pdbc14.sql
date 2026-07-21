-- Production audit fix (2026-07-21): add the two macro_indicators rows the
-- daily BCCh cron has been FK-failing on since their series were promoted to
-- live on 2026-07-15 ("Home Page Follow-up 2" — BTP 2Y and PDBC 14d).
--
-- Root cause: bcchMacroIngestion writes macro_observations rows with
-- indicator_id = the series' fallbackStaticId ('btp10' / 'pdbc90'), but
-- neither id ever got a macro_indicators parent row — the 20260626 migration
-- only added btu5/swap2y/swap1y. Result: every weekday 12:30 UTC run logged
--   partial_success — pdbc-90d: insert or update on table "macro_observations"
--   violates foreign key constraint "macro_observations_indicator_id_fkey"
-- (PDBC 14d is a daily series so it always had rows in the 14-day window;
-- BTP 2 only escaped the error because its auction prints are infrequent —
-- neither could ever persist history.)
--
-- Names/labels match src/data/chileanRates.json ("BTP 2" / "PDBC 14d" — the
-- relabeled tenors actually live at BCCh, per bcchSeriesManualMap.ts notes).
-- Idempotent — safe to re-run.

-- 'eurclp' is included too: its Phase 8D.1 row was inserted directly into the
-- production DB and never committed to seed/migrations, so a FRESH environment
-- would reproduce the same FK failure for EUR/CLP ingestion. No-op in
-- production (row already exists); closes the gap for new environments.

insert into macro_indicators (id, region, name, short_name, category, unit, source_provider, live_enabled, metadata)
values
  ('btp10',  'CL', 'Bono Tesorería Pesos 2 años (nominal)',      'BTP 2',    'Rates', '%',   'bcch', false, '{"added_for_live_ingestion": true}'),
  ('pdbc90', 'CL', 'Pagaré Descontable Banco Central 14 días',   'PDBC 14d', 'Rates', '%',   'bcch', false, '{"added_for_live_ingestion": true}'),
  ('eurclp', 'CL', 'Tipo de Cambio EUR/CLP',                     'EUR/CLP',  'FX',    'CLP', 'bcch', false, '{"added_for_live_ingestion": true}')
on conflict (id) do nothing;
