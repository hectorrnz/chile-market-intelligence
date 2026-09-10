// FOLLOW-UP G — a module-resolution hook so a repository can be EXECUTED by a
// test, not merely read as text.
//
// The repositories in this codebase import through the `@/` alias, which Node's
// own resolver knows nothing about, and they reach the database through
// `@/lib/supabase/admin`. Both facts are why repository behaviour has been
// asserted against source text until now: a source assertion proves the code
// SAYS the right thing, never that it DOES it.
//
// This hook closes that gap for one suite. It teaches the loader two things and
// nothing else:
//
//   1. `@/x` means `<repo>/src/x`, with the extension the file actually has.
//   2. `@/lib/supabase/admin` means the stub beside this file, so the test —
//      and only the test — decides what the database answers.
//
// It is registered from inside a single test file. `node --test` gives each
// test file its own process, so no other suite's resolution is touched, and
// nothing here is reachable from the application at all: `npm test` collects
// `tests/*.test.ts`, and this is neither.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ADMIN_STUB = path.join(ROOT, 'tests', 'support', 'supabaseAdminStub.mjs')
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json']

/** `<dir>/x` → `<dir>/x.ts` when, and only when, that file really exists. */
function withExtension(target) {
  if (path.extname(target) !== '') return existsSync(target) ? target : null
  for (const ext of EXTENSIONS) {
    if (existsSync(target + ext)) return target + ext
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/supabase/admin') {
    return { url: pathToFileURL(ADMIN_STUB).href, shortCircuit: true }
  }

  let target = null
  if (specifier.startsWith('@/')) {
    target = path.join(ROOT, 'src', specifier.slice(2))
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // Only rewrite a relative specifier that Node would otherwise reject for
    // want of an extension, and only when the resolved file is really there.
    const parent = context.parentURL
    if (typeof parent === 'string' && parent.startsWith('file:')) {
      target = path.resolve(path.dirname(fileURLToPath(parent)), specifier)
    }
  }

  const resolved = target === null ? null : withExtension(target)
  if (resolved !== null) {
    return { url: pathToFileURL(resolved).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
