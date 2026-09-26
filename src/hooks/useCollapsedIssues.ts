import { useSyncExternalStore } from 'react'

/*
 * Which parent issues have their subtasks folded away. It is a per-viewer display
 * preference, so it lives in localStorage rather than the synced state.
 *
 * It has to be one set for the whole page: every TaskCard used to read the key into its
 * own state at mount and write its private copy back over the shared key, so collapsing
 * something on the second developer's card erased what had been collapsed on the first.
 */
const KEY = 'pm_collapsed_issues'

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    return new Set<string>(raw ? JSON.parse(raw) as string[] : [])
  } catch { return new Set<string>() }
}

let collapsed = load()
const listeners = new Set<() => void>()

export function toggleCollapsedIssue(key: string): void {
  const next = new Set(collapsed)
  next.has(key) ? next.delete(key) : next.add(key)
  collapsed = next
  try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* private mode */ }
  for (const l of listeners) l()
}

export function useCollapsedIssues(): Set<string> {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => { listeners.delete(onChange) } },
    () => collapsed,
    () => collapsed,
  )
}
