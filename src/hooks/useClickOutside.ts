import { useEffect, useRef } from 'react'

/** Calls `onOutside` when a click lands outside the returned ref's element. */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null)
  const cbRef = useRef(onOutside)
  cbRef.current = onOutside

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cbRef.current()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return ref
}
