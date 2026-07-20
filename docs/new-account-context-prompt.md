# Context prompt — paste into the first message of a new Claude Code chat

Copy everything inside the fence below into your first message on the new account.

---

```
I'm resuming an existing project called "Chile Market Intelligence" (deployed as
"Nevada Market Intelligence"). This is a continuation from another Claude account —
all the code, docs, and history already exist in this repository. Please start by
reading CLAUDE.md in the project root: it is the authoritative, detailed instruction
set and phase-by-phase history for this project. Also read docs/data_source_status.md
(the canonical data-source matrix) and docs/implementation_plan.md.

PROJECT SUMMARY
- Internal buyside web terminal for a Chilean family office: tracks Chilean listed
  equities, macro indicators, CMF filings (Hechos Esenciales), earnings, structured
  notes, and market news.
- Stack: Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 (configured in
  src/app/globals.css via @theme — there is NO tailwind.config.ts) · Supabase (auth +
  Postgres persistence) · Vercel hosting. GitHub repo: hectorrnz/chile-market-intelligence.
- Design: Goldman-style institutional terminal. Light mode default, dark mode toggle.
  EN default with ES toggle (src/lib/i18n.ts). Semantic CSS tokens only — never
  hardcoded hex, never purple. Full rules in docs/design_principles.md and CLAUDE.md.
- Data philosophy: no visible module may be a static dead-end. Every field is classified
  live / persisted / derived / static_fallback / temporary_static / blocked / unavailable
  in docs/data_source_status.md. Never fabricate data (esp. news, financials); never
  guess a series/RUT/identifier; official/free sources only, no scraping unless authorized.

WHAT'S LIVE RIGHT NOW
- Macro: BCCh (Chile) + FRED (US) live/persisted via Supabase, daily cron ingestion.
- Market: Yahoo Finance overlay + Supabase snapshots.
- Financials: CMF/XBRL (21 non-bank issuers) + CMF bank feed (4 banks) + Yahoo universal
  fallback, all persisted.
- Auth + Watchlist + Portfolio (positions, transactions, cash ledger): Supabase, user-scoped.
- Structured Notes: PDF term-sheet auto-extraction (6 issuer families) + shared-book
  dashboard + scheduled monitoring cron.
- News (most recently worked on): live source-backed only, NO static/sample fallback.
  Two live sources — Diario Financiero (df.cl RSS) and La Tercera (Arc "Pulso" RSS).
  Compact Bloomberg-NH-style feed: color-coded source-code column, strict newest-first
  sort, 7-day rolling window, NH alert-bar highlight for high-impact items. Emol is
  deferred (no viable feed). See the "News Module Rule" section in CLAUDE.md.

MOST RECENT PHASE (per CLAUDE.md "Current Phase")
Phase 8D.3 — Economic Calendar Actual/Previous enrichment from FRED. Full suite was
passing: build 0 errors, lint 0, ~1540 tests green.

POSSIBLE NEXT STEPS (pick with me before starting)
- Mobile-responsive foundation (explicitly deferred; the primary user wants a phone
  experience — this is the top standing "next project").
- First-run guided tour (deferred, wanted eventually).
- Add a 3rd news source (CMF "Comunicados de Prensa" or Diario Estrategia via Google News).
- Structured Notes: Santander / older-2024 Citi parser templates.
- Continue CMF/XBRL or macro/calendar source work.

HOW I WORK
- I'm the primary user: a Chilean family-office investor and market domain expert, but a
  beginner web developer — explain things clearly. Build incrementally, one task at a time,
  and ask before making decisions. After each phase: list files changed, one sentence each,
  state the next task, and pause for my confirmation.
- IMPORTANT deploy gotcha: pushing to master only deploys to Vercel PREVIEW. To reach
  production you must run a production deploy (npx vercel deploy --prod --yes). See the
  memory note / CLAUDE.md.

Please confirm you've read CLAUDE.md and give me a short status readout of where the
project stands, then wait for me to choose the next task.
```

---

## Notes for the human (do not paste)

- The big context is **already in `CLAUDE.md`** in the repo — the new session will read it.
  This prompt just orients Claude and points at the right files.
- If you also copied your **memory folder** (see migration steps), the new account will also
  auto-load `MEMORY.md` and the individual memory files, which reinforce your profile,
  design feedback, and the Vercel-prod deploy gotcha.
