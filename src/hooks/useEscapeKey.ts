import { useEffect } from 'react'

/**
 * Close an open overlay when Escape is pressed. Modals have always done this; the side
 * panels did not, so the same key worked in one place and not the other.
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onEscape])
}
