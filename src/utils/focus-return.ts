/*
 * Where focus should go when an overlay closes.
 *
 * `document.activeElement` is not enough. A modal is usually opened from a menu item, and
 * the menu unmounts as the modal appears — so by the time the modal's effect runs, the
 * element that opened it is already detached and focus has fallen to <body>. Closing then
 * dropped the user at the top of the page.
 *
 * So the last real focus is recorded as it happens, together with a few of its ancestors,
 * while they are all still attached. On the way out we take the first of those still on
 * the page (the menu's own trigger, typically) and focus its first control.
 */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export interface FocusOrigin {
  el: HTMLElement
  ancestors: HTMLElement[]
}

function originOf(el: HTMLElement): FocusOrigin {
  const ancestors: HTMLElement[] = []
  // Stop at <body>: its "first focusable" is whatever happens to come first in the
  // document, which is a worse answer than leaving focus where the browser put it.
  for (let p = el.parentElement; p && p !== document.body && ancestors.length < 5; p = p.parentElement) {
    ancestors.push(p)
  }
  return { el, ancestors }
}

/*
 * Anything inside an open dialog is out: React's StrictMode mounts an effect twice, so a
 * modal that has already focused itself would otherwise capture its own box as the place
 * to return to, and closing would drop focus at the top of the page.
 */
function usable(el: EventTarget | Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el !== document.body && !el.closest('[role="dialog"]')
}

let lastFocus: FocusOrigin | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('focusin', (e) => {
    const el = e.target
    if (usable(el)) lastFocus = originOf(el)
  }, true)
}

/** Call as an overlay opens. */
export function captureFocusOrigin(): FocusOrigin | null {
  const active = document.activeElement
  if (usable(active)) return originOf(active)
  return lastFocus
}

/** Call as it closes. Does nothing if there is nowhere sensible to go. */
export function restoreFocusOrigin(origin: FocusOrigin | null): void {
  if (!origin) return
  if (origin.el.isConnected) { origin.el.focus(); return }
  for (const el of origin.ancestors) {
    if (!el.isConnected) continue
    const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE)
    if (target) { target.focus(); return }
  }
}
