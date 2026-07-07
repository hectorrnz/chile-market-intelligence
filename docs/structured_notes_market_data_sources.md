# Structured Notes — Free Market-Data Source Discovery (Phase 9E)

This document records the free-provider discovery performed for Phase 9E, mirroring the discovery-doc
convention already established for CMF/Hechos Esenciales (`docs/cmf_provider_discovery.md`) and
CMF/XBRL financials (`docs/cmf_xbrl_provider_discovery.md`): investigate real, no-key, free sources for
structured-note underlying levels before deciding whether a secondary provider belongs in the codebase.

**Verdict: no viable secondary free provider was found. Yahoo Finance (`yahoo-finance2`, already in use
since Phase 9A) remains the only active provider.** The provider abstraction built this phase is designed
so a second provider can be added later with zero changes to the orchestrator, but nothing found during
this discovery pass was safe/stable enough to ship now.

## Underlyings in scope

The current book uses only two index underlyings across every note (Citi/HSBC/Crédit Agricole/BNP/Barclays/
BBVA all issue the same worst-of SPX+RTY basket): `SPX Index` → `^GSPC`, `RTY Index` → `^RUT`. The
`underlyingSymbolMap.ts` module also carries three not-yet-observed-in-the-real-book entries (`NDX Index`,
`SX5E Index`, `SPY`/`IWM` ETFs) kept ready for a future note. Discovery targeted all six.

## Candidates investigated

### Stooq (`stooq.com`) — **reject**

Stooq's CSV endpoints (`/q/d/l/?s=<symbol>&i=d` for historical, `/q/l/?s=<symbol>&f=...&e=csv` for a last
quote) are widely documented in older tutorials as a simple, key-free CSV source. **Verified live on
2026-07-07: both endpoints now serve a client-side JavaScript proof-of-work challenge** (a SHA-256
mining puzzle gating access to `/__verify` before the real response is served) rather than the CSV body,
for every symbol tested (`^spx`, `^rut`, `spy.us`). This is functionally an anti-bot/anti-scraping wall,
not a stable public API — solving it programmatically would mean depending on and continuously
reverse-engineering an undocumented bot-detection mechanism, which is exactly the kind of fragile,
scraping-adjacent access this project's standing policy (`CLAUDE.md`: "No scraping... official API
only") already rules out for other modules (see the CMF Hechos Esenciales CAPTCHA-block precedent).
**Recommendation: `reject`** for implementation now. Revisit only if Stooq publishes a documented,
key-free API without a JS challenge, or if the team decides a server-side PoW solver is an acceptable
dependency (not recommended — it is inherently unstable and could be changed or hardened at any time
with no notice).

```
$ curl "https://stooq.com/q/d/l/?s=^spx&i=d"
<!DOCTYPE html>...
(async()=>{const c="...",d=4,t="0".repeat(d),e=new TextEncoder;let n=0;
while(1){const h=await crypto.subtle.digest("SHA-256",e.encode(c+n));...}
const r=await fetch("/__verify",...)})();
```

### Alpha Vantage, IEX Cloud, Polygon.io, Twelve Data (free tiers) — **reject (not investigated further)**

All require an API key even on their free tier. The phase's explicit rule is "do not require API keys
unless a free provider is clearly superior and safe" — none of these is clearly superior to the
already-working Yahoo path (all impose stricter rate limits than Yahoo's unofficial endpoint, and adding
a key introduces a new secret to manage for a marginal-at-best benefit). **Recommendation: `reject`** for
this phase; **`document_for_later`** if Yahoo's unofficial endpoint ever becomes unreliable enough to
justify a keyed free tier as a fallback.

### Official exchange/index-sponsor delayed-quote pages (S&P Dow Jones Indices, FTSE Russell) — **reject**

Both S&P DJI's and FTSE Russell's public index pages are JavaScript-rendered dashboards with no
documented public JSON/CSV endpoint discovered during a brief inspection; scraping their rendered HTML
would violate the "no scraping" policy and would be far more brittle than the current Yahoo integration.
**Recommendation: `reject`.**

### Yahoo Finance (`yahoo-finance2`) — **implement_now (already implemented; formalized into the new provider abstraction this phase)**

Already in production use since Phase 9A via the `yahoo-finance2` npm package (`fetchYahooPriceMap` /
`fetchUnderlyingPrices` in `structuredNoteMarketProvider.ts`). Confirmed reliable across every monitoring
run to date (Phase 9D's first production run and this phase's re-validation both returned 2/2 symbols
successfully). Remains the sole **primary and, for now, only** structured-notes market-data provider,
refactored this phase into the new `StructuredNoteMarketDataProvider` interface
(`yahooStructuredNoteProvider.ts`) without changing its externally observed behavior.

| Symbol | Asset class | Yahoo coverage | Notes |
|---|---|---|---|
| `SPX Index` → `^GSPC` | index | ✅ verified (live in production) | |
| `RTY Index` → `^RUT` | index | ✅ verified (live in production) | |
| `NDX Index` → `^NDX` | index | ✅ verified (was already `verified: true` pre-9E; not seen in the real book yet) | |
| `SX5E Index` → `^STOXX50E` | index | ⚠️ un-verified — carried as `verified: false` since Phase 9A; **still not verified this phase** (no real note uses it, so there was nothing live to confirm against) | remains `unsupported` until a real note requires it and a verification pass is done |
| `SPY US Equity` → `SPY` | etf | ✅ verified | |
| `IWM US Equity` → `IWM` | etf | ✅ verified | |

## Conclusion and architecture implication

Because no secondary provider passed discovery, `resolveStructuredNoteQuotes.ts` (the new fallback/
sanity-check orchestrator) runs with **exactly one registered provider** this phase. Its fallback and
cross-provider-disagreement logic is still fully implemented and tested (with a mocked second provider in
`tests/structuredNotesMarketDataProviders.test.ts`) — a real second provider can be registered later with
no orchestrator changes. Until then, "provider disagreement" and "fallback provider used" will always read
as inapplicable/absent in the API responses and UI — this is documented, not silently hidden, in both
`monitoring-status` and the dashboard.

## Future options (unchanged from Phase 9D, documented for completeness)

- An official index-close feed (S&P DJI or FTSE Russell licensed data) or a calculation-agent notice feed
  would be the only way to make final/maturity payoff determinations authoritative — out of scope for any
  free-data phase.
- A paid/vendor real-time or delayed quote API (e.g. a licensed Bolsa de Santiago or Bloomberg feed) remains
  explicitly out of scope per the project's standing "no paid/vendor data" policy for this module.
- Custodian statement ingestion (e.g. Santander/BBVA custody confirmations) could eventually corroborate
  coupon/autocall payments independently of any market-data provider — not investigated this phase.
