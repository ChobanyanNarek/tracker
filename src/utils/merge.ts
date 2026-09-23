/*
 * Structural equality and three-way merge for saved records.
 *
 * Records round-trip through JSON on the server, so equality follows JSON: a property
 * holding `undefined` is the same as a missing one, and key order does not matter.
 */

type Json = unknown

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false
}

// Items in a list are matched by their own identity when they have one.
function itemKey(v: unknown): string | undefined {
  if (!isPlainObject(v)) return undefined
  for (const field of ['id', 'issueId', 'url'] as const) {
    const k = v[field]
    if (typeof k === 'string' && k !== '') return `${field}:${k}`
  }
  return undefined
}

function keyedList(list: unknown[]): Map<string, unknown> | null {
  const map = new Map<string, unknown>()
  for (const item of list) {
    const k = itemKey(item)
    if (!k || map.has(k)) return null
    map.set(k, item)
  }
  return map
}

/*
 * Combine two edits of the same record made from a common starting point.
 *
 * - Only one side changed it: that side wins.
 * - Both changed an object: merge key by key, so edits to different fields both survive.
 * - Both changed a list of identifiable items (tasks' issues, projects, connections):
 *   merge item by item. An item added on either side is kept; an item removed on one
 *   side is dropped unless the other side edited it; order follows `local`, with items
 *   only `remote` has added at the end.
 * - Anything else changed on both sides: `local` wins, being what this user just did.
 *
 * `base` is undefined when there is no common starting point; `local` then wins wherever
 * the two differ.
 */
export function merge3<T>(base: T | undefined, local: T, remote: T): T {
  if (deepEqual(local, remote)) return remote
  if (base !== undefined && deepEqual(local, base)) return remote
  if (base !== undefined && deepEqual(remote, base)) return local

  if (isPlainObject(local) && isPlainObject(remote)) {
    const b = isPlainObject(base) ? base : undefined
    const out: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const inLocal = local[k] !== undefined
      const inRemote = remote[k] !== undefined
      const inBase = b?.[k] !== undefined
      let v: unknown
      if (inLocal && inRemote) v = merge3(b?.[k], local[k], remote[k])
      else if (inLocal) v = inBase && deepEqual(local[k], b![k]) ? undefined : local[k] // remote removed it
      else if (inRemote) v = inBase && deepEqual(remote[k], b![k]) ? undefined : remote[k] // local removed it
      if (v !== undefined) out[k] = v
    }
    return out as T
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    const l = keyedList(local)
    const r = keyedList(remote)
    const b = Array.isArray(base) ? keyedList(base) : new Map<string, unknown>()
    if (l && r && b) {
      const out: unknown[] = []
      const take = (k: string) => {
        const li = l.get(k)
        const ri = r.get(k)
        const bi = b.get(k)
        if (li !== undefined && ri !== undefined) out.push(merge3(bi, li, ri))
        else if (li !== undefined) { if (bi === undefined || !deepEqual(li, bi)) out.push(li) }
        else if (ri !== undefined) { if (bi === undefined || !deepEqual(ri, bi)) out.push(ri) }
      }
      for (const k of l.keys()) take(k)
      for (const k of r.keys()) if (!l.has(k)) take(k)
      return out as T
    }
  }

  return local
}
