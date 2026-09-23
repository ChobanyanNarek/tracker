/*
 * Issue keys and identities, shared by the web app and the server-side sync.
 */

// Extract Jira issue keys (e.g. MONE-123) from arbitrary PR/MR text (title, branch name).
// Matching is anchored to the configured Jira project keys when available — this avoids
// false positives like a branch "feature/add-login-2" being read as the key "LOGIN-2".
// With no configured keys we fall back to a generic *uppercase* pattern (lowercase branch
// words must not be mistaken for a key). Shared between gitlab-api.ts and github-api.ts,
// which otherwise duplicated this exact regex logic.
export function keysFromText(text: string, projectKeys: string[]): string[] {
  const found = new Set<string>()
  const configured = projectKeys.map((k) => k.trim()).filter(Boolean)
  if (configured.length) {
    const esc = configured.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    for (const m of text.matchAll(new RegExp(`(?:${esc.join('|')})-\\d+`, 'ig'))) found.add(m[0].toUpperCase())
    // Stop here. The generic pattern below used to run as well, so a branch or title
    // mentioning ANY key matched -- which let a PR from one project link to another
    // project's issue even though that key was never configured here.
    return [...found]
  }
  // No keys configured for this project: fall back to the generic uppercase pattern.
  for (const m of text.matchAll(/[A-Z][A-Z0-9]+-\d+/g)) found.add(m[0])
  return [...found]
}

// Returns a stable dedup key for a jira issue.
// Extracts the Jira ticket ID (e.g. "MONE-781") from the URL or name when
// possible so that the same issue entered with slightly different URL formats
// (https://…/browse/MONE-781, https://…/MONE-781, bare "MONE-781") always
// maps to a single card in the Deadlines dashboard.
export function jiraDedupeKey(url: string, name: string): string {
  const u = (url ?? '').trim()
  if (u) {
    const ticket = u.match(/([A-Z][A-Z0-9]+-\d+)/)
    if (ticket) return ticket[1]!
    return u.replace(/\/+$/, '')
  }
  const n = (name ?? '').trim()
  if (n) {
    const ticket = n.match(/([A-Z][A-Z0-9]+-\d+)/)
    if (ticket) return ticket[1]!
    return `name:${n}`
  }
  return 'name:'
}

/*
 * Integration identities (Jira emails, GitLab/GitHub usernames) are stored either as a
 * single string (the original shape, still present in saved data) or as a list. This is
 * the ONLY place that difference is handled — everything else should call this and work
 * with a clean array of non-empty, trimmed values.
 */
export function identityList(value: string | string[] | undefined): string[] {
  if (!value) return []
  const arr = Array.isArray(value) ? value : [value]
  const seen = new Set<string>()
  return arr
    .map((v) => (v ?? '').trim())
    .filter((v) => {
      if (!v || seen.has(v)) return false
      seen.add(v)
      return true
    })
}
