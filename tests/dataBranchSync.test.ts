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
// SECOND ROOT CAUSE, found 2026-08-28: that fix never actually ran. It was
// wired to `on: push: branches: [master], paths: ['src/data/**']`, but both
// refresh workflows push using `secrets.GITHUB_TOKEN`, and GitHub raises no
// workflow-triggering event for a push authored by that token. Measured: 51 bot
// data-refresh commits landed on master between 2026-08-06 and 2026-08-28 while
// the sync workflow ran exactly ONCE in its lifetime — on 2026-08-05, from the
// human push that added the file. Every assertion in the first describe block
// below passed the whole time, because they checked the workflow's *shape* and
// never its *trigger effectiveness*.
//
// SECOND FIX: chain off `workflow_run` (keyed to a workflow run completing, not
// to a git push, so the GITHUB_TOKEN restriction does not apply) and assert the
// chain end-to-end — see "the trigger actually fires" below.
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

describe('the trigger actually fires — not just the workflow shape', () => {
  // The 2026-08-28 regression: every structural assertion above passed while the
  // workflow had never run. These check the one property that was missing —
  // that the configured trigger can be reached at all by a bot data refresh.

  const ON = SYNC.slice(SYNC.indexOf('\non:'), SYNC.indexOf('\njobs:'))
  const firstName = (yaml: string) => {
    const m = yaml.match(/^name:\s*(.+)$/m)
    assert.ok(m, 'workflow has no name:')
    return m[1].trim()
  }

  test('the refresh workflows push as GITHUB_TOKEN — which is WHY a push trigger cannot work', () => {
    // The precondition for the whole workflow_run design. If either refresh ever
    // switches to a PAT or a GitHub App token, its pushes would start raising
    // events and this indirection could be revisited — so pin it down.
    for (const [name, yaml] of [['market', MARKET], ['calendar', CALENDAR]] as const) {
      assert.match(
        yaml,
        /token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/,
        `${name} refresh must check out with GITHUB_TOKEN`,
      )
    }
  })

  test('sync chains off workflow_run, naming BOTH refresh workflows exactly', () => {
    assert.match(ON, /workflow_run:/)
    // Read the names out of the real files rather than hardcoding them: renaming
    // a refresh workflow silently breaks the chain, and that must fail here.
    for (const [file, yaml] of [
      ['refresh-market-data.yml', MARKET],
      ['refresh-earnings-calendar.yml', CALENDAR],
    ] as const) {
      const name = firstName(yaml)
      assert.ok(
        ON.includes(`'${name}'`) || ON.includes(`"${name}"`) || ON.includes(`- ${name}`),
        `sync's workflow_run list must name ${file}'s workflow ("${name}") — the chain breaks silently otherwise`,
      )
    }
    assert.match(ON, /types:\s*\[completed\]/)
  })

  test('it syncs only after a SUCCESSFUL refresh, and only one that ran on master', () => {
    // `types: [completed]` fires for failure and cancellation too.
    assert.match(SYNC, /github\.event\.workflow_run\.conclusion == 'success'/)
    // A refresh dispatched by hand from a feature branch must not push master's
    // state around on that branch's behalf.
    assert.match(SYNC, /github\.event\.workflow_run\.head_branch == 'master'/)
    // Non-workflow_run events (a human push, a manual dispatch) still run.
    assert.match(SYNC, /github\.event_name != 'workflow_run'/)
  })

  test('the direct-push path keeps its data-only filter — unrelated master commits do not sync', () => {
    const push = ON.slice(ON.indexOf('  push:'))
    assert.match(push, /branches:\s*\[master\]/)
    assert.match(push, /paths:/, 'a source-only commit to master must not trigger a sync')
    assert.match(push, /src\/data\/\*\*/)
  })

  test('no new secret, no PAT, no GitHub App — GITHUB_TOKEN is the only credential', () => {
    const secrets = [...new Set([...SYNC.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))]
    assert.deepEqual(secrets, ['GITHUB_TOKEN'], `sync must need no new secret, saw: ${secrets}`)
    // Usage, not prose — the header comment legitimately says "no PAT", so scan
    // the trigger block and the `uses:` lines rather than the whole file.
    assert.doesNotMatch(ON, /repository_dispatch/)
    assert.doesNotMatch(SYNC, /uses:.*(create-github-app-token|app-token|actions-app-token)/)
  })

  test('it still cannot loop — sync is not in its own workflow_run list', () => {
    assert.ok(
      !ON.includes(firstName(SYNC)),
      'sync must not listen for its own completion',
    )
    // And its pushes are GITHUB_TOKEN-authored to feature branches, so they
    // raise no events either way.
    assert.doesNotMatch(SYNC, /git push origin master/)
  })

  test('participating branches are chosen deliberately, not "every ref that exists"', () => {
    // Scope is an explicit, reviewable knob rather than a buried glob...
    assert.match(SYNC, /SYNC_BRANCH_GLOB:\s*'refs\/remotes\/origin\/feat\/\*\*'/)
    // ...and parked branches are reported instead of quietly accumulating merge
    // commits on work nobody is touching.
    assert.match(SYNC, /SYNC_MAX_BRANCH_AGE_DAYS/)
    assert.match(SYNC, /git log -1 --format=%ct "origin\/\$BRANCH"/)
    assert.match(SYNC, /parked/i)
    // Still no hardcoded branch name — the original rule.
    assert.doesNotMatch(SYNC, /feat\/fable-frontend-integration|feat\/portfolio-r13/)
  })

  test('the reason for the indirection is written down, so nobody "simplifies" it back', () => {
    assert.match(SYNC, /GITHUB_TOKEN/)
    assert.match(SYNC, /anti-recursion/i)
    assert.match(SYNC, /workflow_run/)
  })
})
