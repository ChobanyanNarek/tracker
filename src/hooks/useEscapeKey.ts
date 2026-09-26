import { useEffect, useRef } from 'react'

/*
 * Escape closes the TOPMOST overlay only.
 *
 * Every overlay listens on window, so without an order a single Escape ran all of them:
 * dismissing a Jira settings dialog also slammed the Projects panel shut behind it and
 * threw away the half-finished edit in its drawer.
 *
 * Overlays register here in mount order, so the last one opened is the one on top and
 * the only one that reacts. The callback is held in a ref so that re-rendering a parent
 * (which usually hands down a fresh arrow function) does not re-register the overlay and
 * push it back to the top of the stack.
 */
const stack: object[] = []

export function useEscapeKey(active: boolean, onEscape: () => void): void {
  const latest = useRef(onEscape)
  useEffect(() => { latest.current = onEscape })

  useEffect(() => {
    if (!active) return
    const token = {}
    stack.push(token)

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (stack[stack.length - 1] !== token) return
      latest.current()
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      const i = stack.indexOf(token)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
