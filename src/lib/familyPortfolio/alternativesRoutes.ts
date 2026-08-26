// R13.R4A.4 — the Alternatives module's own URLs, in one place.
//
// The sub-navigation, the Cash Flows view and the Dashboard's "View full
// activity history" action all name the same routes. Spelling a path — or a
// hash — in more than one file is how a link and its target drift apart: the
// anchor gets renamed on the page that owns it and the link that points at it
// keeps working right up until nobody notices it stopped scrolling anywhere.
//
// Pure strings, no imports. A page module can export a constant safely, but a
// second page importing it would pull that whole route's bundle in behind it,
// so the shared names live here instead of on either page.

export const ALTERNATIVES_ROOT = '/family-portfolio/alternatives'
export const ALTERNATIVES_HOLDINGS = `${ALTERNATIVES_ROOT}/holdings`
export const ALTERNATIVES_CASH_FLOWS = `${ALTERNATIVES_ROOT}/cash-flows`

/** The Cash Flow History section's `id` on the Cash Flows view. */
export const CASH_FLOW_HISTORY_ANCHOR = 'cash-flow-history'

/** Deep link straight to that section — the Dashboard activity action's target. */
export const CASH_FLOW_HISTORY_HREF = `${ALTERNATIVES_CASH_FLOWS}#${CASH_FLOW_HISTORY_ANCHOR}`
