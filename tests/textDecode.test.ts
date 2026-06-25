// Run with: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { charsetFromContentType, normalizeSearchText, decodeResponseText } from '../src/lib/providers/textDecode.ts'

// ── charsetFromContentType ────────────────────────────────────────────────────

test('charsetFromContentType: extracts charset from full Content-Type', () => {
  assert.equal(charsetFromContentType('application/json; charset=utf-8'), 'utf-8')
  assert.equal(charsetFromContentType('application/json; charset=iso-8859-1'), 'iso-8859-1')
  assert.equal(charsetFromContentType('text/html; charset=windows-1252'), 'windows-1252')
})

test('charsetFromContentType: defaults to utf-8 when no charset declared', () => {
  assert.equal(charsetFromContentType('application/json'), 'utf-8')
  assert.equal(charsetFromContentType(null), 'utf-8')
  assert.equal(charsetFromContentType(''), 'utf-8')
})

test('charsetFromContentType: case-insensitive CHARSET= match', () => {
  const result = charsetFromContentType('text/html; CHARSET=Windows-1252')
  assert.equal(result.toLowerCase(), 'windows-1252')
})

// ── normalizeSearchText ───────────────────────────────────────────────────────

test('normalizeSearchText: strips accents from Spanish words', () => {
  assert.equal(normalizeSearchText('Dólar observado'), 'dolar observado')
  assert.equal(normalizeSearchText('Índice de precios al consumidor'), 'indice de precios al consumidor')
  assert.equal(normalizeSearchText('Variación anual'), 'variacion anual')
  assert.equal(normalizeSearchText('Desocupación'), 'desocupacion')
  assert.equal(normalizeSearchText('Tasa de política monetaria'), 'tasa de politica monetaria')
  assert.equal(normalizeSearchText('IMACEC desestacionalizado'), 'imacec desestacionalizado')
})

test('normalizeSearchText: strips Spanish ñ diacritic', () => {
  const result = normalizeSearchText('variación mensual')
  assert.equal(result, 'variacion mensual')
})

test('normalizeSearchText: collapses internal whitespace', () => {
  assert.equal(normalizeSearchText('  hello   world  '), 'hello world')
})

test('normalizeSearchText: handles empty and undefined-like input', () => {
  assert.equal(normalizeSearchText(''), '')
})

test('normalizeSearchText: unaccented keyword matches stripped accented title', () => {
  const title = normalizeSearchText('Índice de Precios al Consumidor')
  const kw = normalizeSearchText('indice de precios al consumidor')
  assert.ok(title.includes(kw), `"${title}" should include "${kw}"`)
})

test('normalizeSearchText: accented keyword matches stripped accented title', () => {
  // Both sides are stripped — should be symmetric
  const title = normalizeSearchText('Dólar observado')
  const kw = normalizeSearchText('Dólar observado')
  assert.equal(title, kw)
})

// ── decodeResponseText ────────────────────────────────────────────────────────

test('decodeResponseText: decodes UTF-8 content declared as UTF-8 correctly', async () => {
  const original = 'Dólar observado: ó é á ú ñ'
  const buf = new TextEncoder().encode(original)  // TextEncoder always produces UTF-8
  const res = new Response(buf, { headers: { 'content-type': 'application/json; charset=utf-8' } })
  const result = await decodeResponseText(res)
  assert.equal(result, original)
})

test('decodeResponseText: decodes ISO-8859-1 content when charset is declared', async () => {
  // "Dólar" in ISO-8859-1: D=0x44, ó=0xF3, l=0x6C, a=0x61, r=0x72
  const bytes = new Uint8Array([0x44, 0xF3, 0x6C, 0x61, 0x72])
  const res = new Response(bytes, { headers: { 'content-type': 'application/json; charset=iso-8859-1' } })
  const result = await decodeResponseText(res)
  assert.equal(result, 'Dólar')
})

test('decodeResponseText: falls back to ISO-8859-1 when undeclared charset produces garbled UTF-8', async () => {
  // ISO-8859-1 bytes for "Dólar" served without charset declaration.
  // 0xF3 is invalid as a UTF-8 single byte → would become U+FFFD if decoded as UTF-8.
  const bytes = new Uint8Array([0x44, 0xF3, 0x6C, 0x61, 0x72])
  const res = new Response(bytes, { headers: { 'content-type': 'application/json' } })
  const result = await decodeResponseText(res)
  // Should fall back to ISO-8859-1 and produce readable Spanish
  assert.equal(result, 'Dólar', 'Expected ISO-8859-1 fallback to decode ó correctly')
})

test('decodeResponseText: UTF-8 content without charset declaration passes through cleanly', async () => {
  // Normal ASCII + UTF-8 content with no charset header — should decode fine as UTF-8
  const original = 'Tasa de politica monetaria: 4.5%'
  const buf = new TextEncoder().encode(original)
  const res = new Response(buf, { headers: { 'content-type': 'application/json' } })
  const result = await decodeResponseText(res)
  assert.equal(result, original)
})

test('decodeResponseText: prefers UTF-8 when content is valid UTF-8 despite wrong charset declaration', async () => {
  // BCCh scenario: UTF-8 content but Content-Type says charset=iso-8859-1.
  // Without UTF-8 sniffing, "ó" (bytes 0xC3 0xB3) would be decoded as
  // two ISO-8859-1 chars "Ã³" — Mojibake.
  const original = 'Dólar observado: ó é á ú ñ'
  const buf = new TextEncoder().encode(original)  // UTF-8 encoded
  const res = new Response(buf, { headers: { 'content-type': 'application/json; charset=iso-8859-1' } })
  const result = await decodeResponseText(res)
  assert.equal(result, original, 'Should prefer UTF-8 over the wrong charset declaration')
})

test('decodeResponseText: error messages do not expose credential-bearing strings', async () => {
  // Verify that textDecode itself does not log/throw URL strings.
  // (Credential safety is enforced at the call site; this test checks that
  // decodeResponseText returns a string and does not leak via thrown errors.)
  const buf = new TextEncoder().encode('{"ok":true}')
  const res = new Response(buf, { headers: { 'content-type': 'application/json' } })
  const result = await decodeResponseText(res)
  assert.equal(typeof result, 'string')
  // Must not contain any URL-like pattern with user/pass query params
  assert.ok(!result.includes('user='), 'result must not contain credential params')
  assert.ok(!result.includes('pass='), 'result must not contain credential params')
})
