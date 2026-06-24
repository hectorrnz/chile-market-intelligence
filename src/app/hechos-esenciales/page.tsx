'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatusPill } from '@/components/ui/StatusPill'
import { MaterialityBadge } from '@/components/ui/MaterialityBadge'
import { SearchInput } from '@/components/ui/SearchInput'
import { SourceNote } from '@/components/ui/SourceNote'
import { useLang } from '@/components/providers/LangProvider'
import { getAllHechos } from '@/lib/data/hechos'
import { getDocumentByRelatedId } from '@/lib/data/documents'
import { exportCSV } from '@/lib/export'
import type { HechoEsencial } from '@/types'

const CATEGORIES: HechoEsencial['category'][] = [
  'Dividend', 'Capital Increase', 'Debt Issuance', 'M&A', 'Management Change',
  'Regulation', 'Related-Party Transaction', 'Litigation', 'Guidance', 'Asset Sale', 'Other',
]

const impactColor: Record<string, string> = {
  Positive: 'text-positive',
  Negative: 'text-negative',
  Neutral:  'text-muted-fg',
  Unknown:  'text-muted-fg',
}

const allHechos = getAllHechos()

export default function HechosEsencialesPage() {
  const { t } = useLang()
  const [search,     setSearch]  = useState('')
  const [typeFilter, setType]    = useState<'All' | 'HE' | 'II'>('All')
  const [catFilter,  setCat]     = useState('')

  const rows = useMemo(() => {
    const q = search.toLowerCase()
    return allHechos.filter(h => {
      if (typeFilter !== 'All' && h.filingType !== typeFilter) return false
      if (catFilter && h.category !== catFilter) return false
      if (!q) return true
      return (
        h.ticker.toLowerCase().includes(q) ||
        h.companyName.toLowerCase().includes(q) ||
        h.title.toLowerCase().includes(q)
      )
    })
  }, [search, typeFilter, catFilter])

  const handleExport = () => {
    exportCSV(
      'hechos_esenciales',
      [
        t.hechos.cols.datetime, t.hechos.cols.company, t.hechos.cols.ticker, t.hechos.cols.type,
        t.hechos.cols.category, t.hechos.cols.materiality, t.hechos.cols.description, t.hechos.cols.impact,
      ],
      rows.map(h => [
        h.date, h.companyName, h.ticker, h.filingType,
        h.category, h.materiality, h.title, h.stockImpact ?? '',
      ]),
    )
  }

  return (
    <div className="w-full space-y-4">
      <SectionHeader
        tag={t.hechos.tag}
        title={t.hechos.title}
        subtitle={t.hechos.subtitle}
        asOf
      />

      <div className="flex items-center gap-2.5 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder={t.hechos.filterCo} width={220} />
        <div className="flex items-center border border-border rounded overflow-hidden">
          {(['All', 'HE', 'II'] as const).map(v => (
            <button
              key={v}
              onClick={() => setType(v)}
              className={[
                'px-3 py-1.5 text-xs transition-colors',
                typeFilter === v ? 'bg-surface-2 text-foreground' : 'text-muted-fg hover:text-foreground',
              ].join(' ')}
            >
              {v === 'All' ? t.common.all : v}
            </button>
          ))}
        </div>
        <select
          value={catFilter}
          onChange={e => setCat(e.target.value)}
          className="h-7 bg-surface border border-border rounded px-2 text-xs text-foreground outline-none focus:border-accent"
        >
          <option value="">{t.hechos.allCategories}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
        >
          <span aria-hidden>⤓</span>{t.common.exportCsv}
        </button>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.hechos.cols.datetime}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.company}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.ticker}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.type}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.category}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.materiality}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.description}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.hechos.cols.impact}</th>
              <th className="text-left py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.documents.viewSummary}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(h => {
              const doc = getDocumentByRelatedId(h.id)
              return (
                <tr key={h.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="py-2.5 pl-4 pr-3 ui-number text-muted-fg whitespace-nowrap">{h.date}</td>
                  <td className="py-2.5 px-3 text-foreground max-w-[140px]">
                    <span className="block truncate" title={h.companyName}>{h.companyName}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <Link href={`/companies/${h.ticker}`} className="font-mono text-primary hover:underline">{h.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3">
                    <StatusPill label={h.filingType} variant={h.filingType === 'HE' ? 'info' : 'neutral'} />
                  </td>
                  <td className="py-2.5 px-3 text-muted-fg">{h.category}</td>
                  <td className="py-2.5 px-3">
                    <MaterialityBadge materiality={h.materiality} />
                  </td>
                  <td className="py-2.5 px-3 max-w-[240px]">
                    <span className="block truncate text-foreground" title={h.title}>{h.title}</span>
                  </td>
                  <td className={`py-2.5 px-3 ${impactColor[h.stockImpact ?? 'Unknown']}`}>
                    {h.stockImpact ?? '—'}
                  </td>
                  <td className="py-2.5 px-3 pr-4">
                    {doc ? (
                      <Link href={`/documents/${doc.id}`} className="text-xs text-primary hover:underline">
                        {t.documents.viewSummary}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-fg">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-xs text-muted-fg">{t.common.noResults}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-border bg-surface flex items-center justify-between">
          <p className="text-xs text-muted-fg">{t.hechos.footer}</p>
          <span className="text-xs ui-number text-muted-fg">{rows.length} {t.common.records}</span>
        </div>
      </div>

      <SourceNote>{t.common.mvpNote}</SourceNote>
    </div>
  )
}
