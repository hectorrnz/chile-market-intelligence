// Platform notifications — pure domain types (no runtime imports), safe for
// client components and plain `node --test`.
//
// General-purpose: notification_type is an open string vocabulary so any
// future feature (not just Structured Notes) can write into this same feed
// without a schema change. The first producer is the structured-notes
// monitoring cron ('structured_note_called').

export type NotificationType = 'structured_note_called' | string

export interface PlatformNotification {
  id: string
  notificationType: NotificationType
  title: string
  body: string | null
  linkUrl: string | null
  relatedEntityType: string | null
  relatedEntityId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  /** True when the CURRENT user has read this notification. Computed per-request from notification_reads — never stored on the shared row itself. */
  isRead: boolean
}

export interface NotificationRecipient {
  id: string
  email: string
  label: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Input for creating a new notification (id/createdAt are DB-assigned). */
export interface NewNotification {
  notificationType: NotificationType
  title: string
  body?: string | null
  linkUrl?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  metadata?: Record<string, unknown>
}
