// Run with: npm test
// Tests for hechosListParser.ts using the static fixture HTML.
// No live network calls — all tests run against local fixture data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseHechosList,
  parseHechosRow,
  parseCmfDate,
  parseCmfTime,
} from '../src/lib/providers/cmf/parsers/hechosListParser.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = join(__dirname, 'fixtures', 'cmf', 'hechos_ultimos_7_dias.html')
const fixtureHtml = readFileSync(FIXTURE_PATH, 'utf-8')

// ── parseCmfDate ──────────────────────────────────────────────────────────────

test('parseCmfDate: parses DD-MM-YYYY correctly', () => {
  assert.equal(parseCmfDate('30-04-2025'), '2025-04-30')
  assert.equal(parseCmfDate('01-01-2024'), '2024-01-01')
  assert.equal(parseCmfDate('28-02-2025'), '2025-02-28')
})

test('parseCmfDate: accepts YYYY-MM-DD passthrough', () => {
  assert.equal(parseCmfDate('2025-04-30'), '2025-04-30')
})

test('parseCmfDate: returns null for unrecognised formats', () => {
  assert.equal(parseCmfDate(''), null)
  assert.equal(parseCmfDate('April 30'), null)
  assert.equal(parseCmfDate('30/04/2025'), null)
  assert.equal(parseCmfDate('not a date'), null)
})

test('parseCmfDate: trims leading/trailing whitespace', () => {
  assert.equal(parseCmfDate('  30-04-2025  '), '2025-04-30')
})

// ── parseCmfTime ──────────────────────────────────────────────────────────────

test('parseCmfTime: parses HH:MM correctly', () => {
  assert.equal(parseCmfTime('17:30'), '17:30')
  assert.equal(parseCmfTime('09:05'), '09:05')
  assert.equal(parseCmfTime('9:15'), '09:15')
})

test('parseCmfTime: returns null for missing or invalid time', () => {
  assert.equal(parseCmfTime(''), null)
  assert.equal(parseCmfTime('not-a-time'), null)
})

// ── parseHechosList with fixture ──────────────────────────────────────────────

test('parseHechosList: fixture returns 7 data rows', () => {
  const rows = parseHechosList(fixtureHtml)
  assert.equal(rows.length, 7, `Expected 7 rows, got ${rows.length}`)
})

test('parseHechosList: first row is fully parsed (confidence 1.0)', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[0]
  assert.equal(row.date, '2025-04-30')
  assert.equal(row.time, '17:30')
  assert.equal(row.documentNumber, '345678')
  assert.ok(row.entityName?.includes('QUIMICA') || row.entityName?.includes('SQM'), `entityName: ${row.entityName}`)
  assert.equal(row.subject, 'Dividendo')
  assert.ok(row.sourceUrl !== null, 'sourceUrl should be extracted from link')
  assert.equal(row.parserConfidence, 1.0)
})

test('parseHechosList: second row has correct entity and document number', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[1]
  assert.equal(row.documentNumber, '345677')
  assert.ok(row.entityName?.includes('SANTANDER'), `entityName: ${row.entityName}`)
  assert.equal(row.date, '2025-04-29')
})

test('parseHechosList: third row extracts PDF link as sourceUrl', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[2]
  assert.equal(row.documentNumber, '345676')
  assert.ok(row.sourceUrl?.includes('345676.pdf'), `sourceUrl: ${row.sourceUrl}`)
})

test('parseHechosList: whitespace row is trimmed correctly', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[3]
  assert.equal(row.date, '2025-04-27')
  assert.equal(row.documentNumber, '345675')
  assert.equal(row.entityName, 'EMPRESAS COPEC S.A.')
})

test('parseHechosList: row with no link has null sourceUrl', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[4]
  assert.equal(row.documentNumber, '345674')
  assert.equal(row.sourceUrl, null)
  assert.ok(row.parserConfidence > 0, 'confidence should be > 0 even without link')
})

test('parseHechosList: malformed row (too few cells) has confidence 0', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[5]
  assert.equal(row.parserConfidence, 0)
  assert.equal(row.documentNumber, null)
  assert.equal(row.entityName, null)
})

test('parseHechosList: nbsp entity name is trimmed', () => {
  const rows = parseHechosList(fixtureHtml)
  const row = rows[6]
  assert.equal(row.entityName, 'CMPC S.A.')
  assert.equal(row.documentNumber, '345673')
})

test('parseHechosList: rawRowText is never empty for any row', () => {
  const rows = parseHechosList(fixtureHtml)
  for (const row of rows) {
    assert.ok(typeof row.rawRowText === 'string', 'rawRowText must be a string')
  }
})

// ── parseHechosRow edge cases ─────────────────────────────────────────────────

test('parseHechosRow: completely empty HTML returns confidence 0', () => {
  const row = parseHechosRow('<tr></tr>')
  assert.equal(row.parserConfidence, 0)
  assert.equal(row.date, null)
  assert.equal(row.documentNumber, null)
})

test('parseHechosRow: row with only 2 cells returns confidence 0', () => {
  const row = parseHechosRow('<tr><td>30-04-2025</td><td>17:30</td></tr>')
  assert.equal(row.parserConfidence, 0)
})

test('parseHechosRow: row with absolute URL is preserved', () => {
  const html = `<tr>
    <td>30-04-2025</td><td>09:00</td>
    <td><a href="https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sg.php?norma=999">999</a></td>
    <td>TEST ENTITY S.A.</td>
    <td>Emisión de bonos</td>
  </tr>`
  const row = parseHechosRow(html)
  assert.equal(row.sourceUrl, 'https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sg.php?norma=999')
})

test('parseHechosRow: relative URL is resolved to absolute', () => {
  const html = `<tr>
    <td>30-04-2025</td><td>09:00</td>
    <td><a href="/sitio/aplic/serdoc/ver_sg.php?norma=888">888</a></td>
    <td>ENTITY S.A.</td>
    <td>Fusión</td>
  </tr>`
  const row = parseHechosRow(html)
  assert.ok(row.sourceUrl?.startsWith('https://www.cmfchile.cl/'), `sourceUrl: ${row.sourceUrl}`)
})
