'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { SourceNote } from '@/components/ui/SourceNote'
import { getDocumentById } from '@/lib/data/documents'
import { getAllEarnings } from '@/lib/data/earnings'
import { formatMillionsCLP, formatPct, changeColor } from '@/lib/formatters'

const syncVariant: Record<string, 'positive' | 'warning' | 'neutral'> = {
  synced_future:  'positive',
  placeholder:    'warning',
  external_only:  'neutral',
}

const qualityVariant: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  Clean: 'positive', Mixed: 'warning', Weak: 'negative', Pending: 'neutral',
}
export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useLang()

  const doc = getDocumentById(id ?? '')

  if (!doc) {
    return (
      <div className="w-full space-y-4">
        <div className="text-xs text-muted-fg flex items-center gap-1.5">
          <Link href="/earnings" className="hover:text-foreground transition-colors">{t.earnings.tag}</Link>
          <span>/</span>
          <span className="text-foreground">{id}</span>
        </div>
        <EmptyState message={t.documents.notFound} />
      </div>
    )
  }

  const syncLabel =
    doc.localStatus === 'synced_future'  ? t.documents.syncPlanned  :
    doc.localStatus === 'placeholder'    ? t.documents.placeholder   :
                                           t.documents.externalOnly

  const docTypeLabel = t.documents.docType[doc.type as keyof typeof t.documents.docType] ?? doc.type
  const fileTypeLabel = t.documents.fileType[doc.fileType as keyof typeof t.documents.fileType] ?? doc.fileType

  const backHref  = '/earnings'
  const backLabel = t.earnings.tag

  // Cross-link the underlying record so the viewer can show structured facts +
  // an assessment chip (derived from existing static data — no external calls).
  const earningsRec = doc.type === 'earnings_release'
    ? getAllEarnings().find(e => e.id === doc.relatedRecordId)
    : undefined

  const assessment = earningsRec
    ? {
        label: earningsRec.resultQuality === 'Clean' ? t.documents.assessClean
             : earningsRec.resultQuality === 'Weak'  ? t.documents.assessWeak
             : t.documents.assessMixed,
        variant: qualityVariant[earningsRec.resultQuality] ?? 'neutral',
      }
    : null

  return (
    <div className="w-full space-y-4">

      {/* Breadcrumb */}
      <div className="text-xs text-muted-fg flex items-center gap-1.5">
        <Link href={backHref} className="hover:text-foreground transition-colors">{backLabel}</Link>
        <span>/</span>
        <span className="text-foreground">{doc.id}</span>
      </div>

      <SectionHeader
        tag={t.documents.tag}
        title={doc.title}
        subtitle={`${doc.companyName} · ${docTypeLabel} · ${doc.date}`}
        actions={<StatusPill label={syncLabel} variant={syncVariant[doc.localStatus]} />}
      />

      {/* Meta row */}
      <div className="bg-surface border border-border rounded p-4">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <div className="ui-label text-muted-fg mb-1">{t.earnings.calCols.ticker}</div>
            <Link href={`/companies/${doc.ticker}`} className="text-xs font-mono text-primary hover:underline">{doc.ticker}</Link>
          </div>
          <div>
            <div className="ui-label text-muted-fg mb-1">{t.home.company}</div>
            <span className="text-xs text-foreground">{doc.companyName}</span>
          </div>
          <div>
            <div className="ui-label text-muted-fg mb-1">{t.home.date}</div>
            <span className="text-xs ui-number text-foreground">{doc.date}</span>
          </div>
          <div>
            <div className="ui-label text-muted-fg mb-1">{t.common.source}</div>
            <span className="text-xs text-muted-fg">{doc.source} · {fileTypeLabel}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary border border-border rounded px-3 py-1.5 hover:bg-surface-2 transition-colors"
          >
            {t.documents.openSource}
            <span aria-hidden>↗</span>
          </a>
          <span className="text-xs text-muted-fg">{t.documents.mvpNote}</span>
        </div>
      </div>

      {/* At a glance — structured facts from the related record + assessment */}
      {earningsRec && (
        <div className="bg-surface border border-border rounded p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="ui-label text-muted-fg">{t.documents.atAGlance}</span>
            {assessment && (
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-muted-fg">{t.documents.assessment}:</span>
                <StatusPill label={assessment.label} variant={assessment.variant} />
              </span>
            )}
          </div>
          {earningsRec && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="ui-label text-muted-fg mb-1">{t.earnings.cols.period}</div>
                <span className="text-xs text-foreground">{earningsRec.period}</span>
              </div>
              <div>
                <div className="ui-label text-muted-fg mb-1">{t.company.cols.revenue}</div>
                <span className="text-xs ui-number text-foreground">{earningsRec.revenue != null ? formatMillionsCLP(earningsRec.revenue) : '—'}</span>
              </div>
              <div>
                <div className="ui-label text-muted-fg mb-1">{t.earnings.cols.revenueYoy}</div>
                <span className={`text-xs ui-number ${earningsRec.revenueYoY != null ? changeColor(earningsRec.revenueYoY) : 'text-muted-fg'}`}>{earningsRec.revenueYoY != null ? formatPct(earningsRec.revenueYoY) : '—'}</span>
              </div>
              <div>
                <div className="ui-label text-muted-fg mb-1">{t.company.cols.ebitda}</div>
                <span className="text-xs ui-number text-foreground">{earningsRec.ebitda != null ? formatMillionsCLP(earningsRec.ebitda) : '—'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="bg-surface border border-border rounded p-4">
        <div className="ui-label text-muted-fg mb-3">{t.documents.aiSummary}</div>
        <p className="text-xs text-foreground leading-relaxed">{doc.aiSummary}</p>
        <p className="text-xs text-muted-fg italic mt-3 pt-3 border-t border-border">{t.documents.aiDraftNote}</p>
      </div>

      {/* Key points */}
      {doc.keyPoints && doc.keyPoints.length > 0 && (
        <div className="bg-surface border border-border rounded p-4">
          <div className="ui-label text-muted-fg mb-3">{t.documents.keyPoints}</div>
          <ul className="space-y-2">
            {doc.keyPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-foreground leading-relaxed">
                <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-surface-2 border border-border flex items-center justify-center ui-number text-muted-fg text-[10px]">{i + 1}</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Related record */}
      <div className="bg-surface border border-border rounded p-4">
        <div className="ui-label text-muted-fg mb-2">{docTypeLabel}</div>
        <div className="flex items-center gap-2">
          <Link
            href={backHref}
            className="text-xs text-primary hover:underline"
          >
            ← {backLabel}
          </Link>
          <span className="text-xs text-muted-fg">·</span>
          <Link href={`/companies/${doc.ticker}`} className="text-xs text-primary hover:underline">
            {doc.ticker} {t.company.overview}
          </Link>
        </div>
      </div>

      <SourceNote>{t.documents.mvpNote}</SourceNote>
    </div>
  )
}
