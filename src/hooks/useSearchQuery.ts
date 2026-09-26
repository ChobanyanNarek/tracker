import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

/*
 * The search box used to write into the global store on every keystroke. Everything that
 * reads the store re-rendered each time — the whole authed tree, including a scan of every
 * task for the urgent-deadline badge — so on a large board characters arrived visibly late.
 *
 * The input now keeps its own value and pushes it to the store on a short debounce, which
 * is also when the search itself should run. An external change (clearing from the other
 * box) still flows back in.
 */
const DEBOUNCE_MS = 150

export function useSearchQuery(): [string, (v: string) => void] {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const [local, setLocal] = useState(searchQuery)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Someone else changed it (the other search box, or a clear): follow.
  useEffect(() => {
    if (!pending.current) setLocal(searchQuery)
  }, [searchQuery])

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])

  const set = (v: string) => {
    setLocal(v)
    if (pending.current) clearTimeout(pending.current)
    // Clearing is an explicit act — apply it at once so the results empty immediately.
    if (v === '') { pending.current = null; setSearchQuery(''); return }
    pending.current = setTimeout(() => { pending.current = null; setSearchQuery(v) }, DEBOUNCE_MS)
  }

  return [local, set]
}
