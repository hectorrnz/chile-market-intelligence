// R13.7B2.2.2 § 5-8 — the shared DeleteButton's state machine, as a PURE module.
//
// The component in ./DeleteButton.tsx renders whatever this reducer says and
// nothing else, so every guarantee the platform makes about a destructive
// control lives here, where `node --test` can prove it without a DOM:
//
//   idle ──ARM──▶ armed ──CONFIRM──▶ pending ──RESOLVE ok──▶ success ──RESET──▶ idle
//                   │                    └──RESOLVE error──▶ idle
//                   └──CANCEL / ESCAPE──▶ idle
//
//   · A disabled control never leaves `idle`, whatever it receives.
//   · `CONFIRM` is accepted from `armed` ONLY — a second CONFIRM while
//     `pending` is a no-op, so the caller's handler can fire at most once per
//     arming (`invokesHandler` is the single place that says so).
//   · `CANCEL` and `ESCAPE` are accepted from `armed` ONLY. While `pending` the
//     control is locked: the request is in flight and cannot be un-sent, so a
//     cancel there would be a lie.
//   · `success` is reachable only through `RESOLVE ok`, i.e. only after the
//     caller's handler has actually resolved successfully — the check mark can
//     never be shown before the backend confirmed the deletion.
//   · `RESOLVE error` returns to `idle`, a usable state: the item is still
//     there, and the caller's own error treatment says why.
//
// Nothing in here knows about React, the DOM, fetch, or which record is being
// deleted. Deletion semantics — endpoint, authorization, refetch — stay with
// the caller, exactly as they did behind the DestructiveConfirm dialog.

export type DeleteButtonState = 'idle' | 'armed' | 'pending' | 'success'

export type DeleteButtonEvent =
  | { type: 'ARM' }
  | { type: 'CANCEL' }
  | { type: 'ESCAPE' }
  | { type: 'CONFIRM' }
  | { type: 'RESOLVE'; ok: boolean }
  | { type: 'RESET' }

export interface DeleteButtonContext {
  /** The caller's `disabled` (or an external busy lock). Freezes the machine in `idle`. */
  disabled: boolean
}

export const INITIAL_DELETE_STATE: DeleteButtonState = 'idle'

/** Pure transition. Returns the SAME state for any event that is not accepted in `state`. */
export function transition(state: DeleteButtonState, event: DeleteButtonEvent, ctx: DeleteButtonContext): DeleteButtonState {
  if (ctx.disabled) {
    // A disabled control cannot be armed, confirmed or cancelled — but a
    // request that was already in flight when it became disabled must still be
    // allowed to resolve, or the control would be stuck showing a spinner.
    if (state === 'pending' && event.type === 'RESOLVE') return event.ok ? 'success' : 'idle'
    if (state === 'success' && event.type === 'RESET') return 'idle'
    return state
  }
  switch (state) {
    case 'idle':
      return event.type === 'ARM' ? 'armed' : 'idle'
    case 'armed':
      if (event.type === 'CONFIRM') return 'pending'
      if (event.type === 'CANCEL' || event.type === 'ESCAPE') return 'idle'
      return 'armed'
    case 'pending':
      if (event.type === 'RESOLVE') return event.ok ? 'success' : 'idle'
      return 'pending'
    case 'success':
      return event.type === 'RESET' ? 'idle' : 'success'
  }
}

/**
 * True exactly when this event must invoke the caller's destructive handler:
 * a CONFIRM received in `armed`, on an enabled control. Everything else —
 * cancel, Escape, a repeated confirm while pending, any event while disabled
 * — invokes nothing.
 */
export function invokesHandler(state: DeleteButtonState, event: DeleteButtonEvent, ctx: DeleteButtonContext): boolean {
  return !ctx.disabled && state === 'armed' && event.type === 'CONFIRM'
}

/** Convenience for tests and callers: replays a sequence and counts handler invocations. */
export function replay(
  events: DeleteButtonEvent[],
  ctx: DeleteButtonContext,
  from: DeleteButtonState = INITIAL_DELETE_STATE,
): { state: DeleteButtonState; invocations: number; trace: DeleteButtonState[] } {
  let state = from
  let invocations = 0
  const trace: DeleteButtonState[] = [state]
  for (const e of events) {
    if (invokesHandler(state, e, ctx)) invocations++
    state = transition(state, e, ctx)
    trace.push(state)
  }
  return { state, invocations, trace }
}
