// Committed-data branch drift — the guard for a real failure found on
// 2026-08-05.
//
// SYMPTOM: a feature branch rendered "21-July" dates across Home while both
// refresh pipelines were running green, which read as a data-ingestion bug.
//
// ROOT CAUSE: `refresh-market-data.yml` and `refresh-earnings-calendar.yml`
// check out the default branch, commit the refreshed src/data/*.json snapshot
// and push — to `master` only. A branch that forks and never merges master
// keeps its original baseline, and that baseline is exactly what every YTD
// column and every pre-live-overlay render falls back to. Nothing was broken;
// the branch was simply 36 commits behind.
//
// FIX: `sync-data-to-branches.yml` merges each data refresh into every
// `feat/**` branch, conservatively (data-only merges, abort on conflict).
//
// These are structural source-scan checks with NO wall-clock dependency — a
// staleness assertion based on "now" would become a time bomb the moment
// anyone checks out an older commit, which is precisely the failure mode the
// three known date-dependent newsModule tests already demonstrate.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const SYNC = read('.github/workflows/sync-data-to-branches.yml')
const MARKET = read('.github/workflows/refresh-market-data.yml')
const CALENDAR = read('.github/workflows/refresh-earnings-calendar.yml')

describe('data branch sync — the refresh reaches feature branches, not just master', () => {
  test('the sync workflow exists and fires on every data refresh landing on master', () => {
    assert.ok(existsSync(join(ROOT, '.github/workflows/sync-data-to-branches.yml')))
    assert.match(SYNC, /branches:\s*\[master\]/)
    assert.match(SYNC, /paths:\s*\n\s*- 'src\/data\/\*\*'/)
    // Manually runnable too, so a drifted branch can be rescued on demand.
    assert.match(SYNC, /workflow_dispatch/)
  })

  test('it can push, and checks out enough history to merge', () => {
    assert.match(SYNC, /permissions:\s*\n\s*contents: write/)
    assert.match(SYNC, /fetch-depth: 0/)
  })

  test('it targets feature branches by pattern, never a hardcoded branch name', () => {
    assert.match(SYNC, /refs\/remotes\/origin\/feat\/\*\*/)
    assert.doesNotMatch(SYNC, /feat\/fable-frontend-integration/)
  })

  test('it merges ONLY data-only changes — source changes stay a human decision', () => {
    // The load-bearing guard: anything master carries outside src/data/ makes
    // the branch skip rather than silently absorb code.
    assert.match(SYNC, /grep -qv '\^src\/data\/'/)
    assert.match(SYNC, /skipping \(needs a human merge\)/)
  })

  test('a conflicting merge is aborted and the branch left untouched — never forced', () => {
    assert.match(SYNC, /git merge --abort/)
    assert.match(SYNC, /::warning title=Data sync conflict::/)
    // No history rewriting of any kind.
    assert.doesNotMatch(SYNC, /--force|force-with-lease|reset --hard|push origin \+/)
  })

  test('it cannot loop — it only ever triggers on master, and pushes only to feature branches', () => {
    const on = SYNC.slice(SYNC.indexOf('\non:'), SYNC.indexOf('jobs:'))
    assert.doesNotMatch(on, /feat/)
    assert.match(SYNC, /git push origin "\$BRANCH"/)
    assert.doesNotMatch(SYNC, /git push origin master/)
  })

  test('an up-to-date branch is a no-op, not a redundant empty merge commit', () => {
    assert.match(SYNC, /git merge-base --is-ancestor origin\/master "origin\/\$BRANCH"/)
  })
})

describe('the refresh pipelines still write exactly what the sync path filter covers', () => {
  // If a refresh workflow ever starts committing a file outside src/data/, the
  // sync workflow's `paths:` filter would silently stop firing for it. This
  // ties the two together so that can't happen quietly.
  // Tolerates both staging styles in use: the market workflow's multi-line
  // `git add \` continuation list and the calendar workflow's inline form.
  const stagedFiles = (yaml: string) =>
    [...new Set([...yaml.matchAll(/(src\/[^\s"'\\]+\.json)/g)].map((m) => m[1]))]

  test('refresh-market-data commits only src/data files', () => {
    const files = stagedFiles(MARKET)
    assert.ok(files.length >= 4, `expected the 4 market snapshots, saw ${files.length}`)
    for (const f of files) assert.ok(f.startsWith('src/data/'), `${f} is outside the synced path`)
    assert.ok(files.includes('src/data/marketMeta.json'))
  })

  test('refresh-earnings-calendar commits only src/data files', () => {
    const files = stagedFiles(CALENDAR)
    assert.deepEqual(files, ['src/data/earningsCalendar.json'])
  })

  test('both refresh workflows still push (the sync workflow has something to react to)', () => {
    for (const [name, yaml] of [['market', MARKET], ['calendar', CALENDAR]] as const) {
      assert.match(yaml, /git push/, `${name} refresh must still push`)
      assert.match(yaml, /schedule:/, `${name} refresh must stay scheduled`)
    }
  })
})
