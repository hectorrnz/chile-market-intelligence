import docsData from '@/data/documents.json'
import type { DocumentRecord } from '@/types'

const documents = docsData as DocumentRecord[]

export function getAllDocuments(): DocumentRecord[] { return documents }

export function getDocumentById(id: string): DocumentRecord | undefined {
  return documents.find(d => d.id === id)
}

export function getDocumentsByTicker(ticker: string): DocumentRecord[] {
  return documents.filter(d => d.ticker === ticker)
}

export function getDocumentByRelatedId(relatedRecordId: string): DocumentRecord | undefined {
  return documents.find(d => d.relatedRecordId === relatedRecordId)
}

export function getDocumentsByType(type: DocumentRecord['type']): DocumentRecord[] {
  return documents.filter(d => d.type === type)
}
