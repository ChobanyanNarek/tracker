import { useEffect, useRef } from 'react'
import { useStore } from '../store'

/** Background Jira / GitLab / GitHub syncing:
 *  - Startup sync when data is stale (> 30 min since last sync)
 *  - Interval polling for all providers (per their configured syncInterval)
 *  - Sync on window focus, throttled to once per 5 minutes */
export function useAutoSync(onToast: (msg: string) => void) {
  const jiraConnections = useStore((s) => s.jiraConnections)
  const gitlabConnections = useStore((s) => s.gitlabConnections)
  const githubConnections = useStore((s) => s.githubConnections)
  const cloudSyncing = useStore((s) => s.cloudSyncing)
  const startupDone = useRef(false)

  // Startup syncs — run once after cloud data finishes loading
  useEffect(() => {
    if (cloudSyncing) return           // data not loaded yet
    if (startupDone.current) return    // already fired
    startupDone.current = true

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

    // GitLab startup
    ;(async () => {
      const conns = useStore.getState().gitlabConnections
      const stale = conns.find((c) => {
        if (!c.enabled || !c.token || !c.groupPath) return false
        return Date.now() - (c.lastSync ? new Date(c.lastSync).getTime() : 0) > 30 * 60 * 1000
      })
      if (stale) {
        await delay(2000)
        useStore.getState().syncGitlab()
          .then(({ linked }) => { if (linked) onToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`) })
          .catch(() => {})
      }
    })()

    // GitHub startup
    ;(async () => {
      const conns = useStore.getState().githubConnections
      const stale = conns.find((c) => {
        if (!c.enabled || !c.token || !c.orgOrUser) return false
        return Date.now() - (c.lastSync ? new Date(c.lastSync).getTime() : 0) > 30 * 60 * 1000
      })
      if (stale) {
        await delay(3000)
        useStore.getState().syncGithub()
          .then(({ linked }) => { if (linked) onToast(`GitHub synced — ${linked} PR${linked !== 1 ? 's' : ''} linked`) })
          .catch(() => {})
      }
    })()

    // Jira startup
    ;(async () => {
      const conns = useStore.getState().jiraConnections
      const stale = conns.find((c) => {
        if (!c.enabled || !c.token) return false
        return Date.now() - (c.lastSync ? new Date(c.lastSync).getTime() : 0) > 5 * 60 * 1000
      })
      if (stale) {
        await delay(1500)
        useStore.getState().syncJira()
          .then(({ added, updated, removed }) => {
            onToast(`Jira synced — ${added} added, ${updated} updated${removed ? `, ${removed} removed` : ''}`)
          })
          .catch((e) => { console.warn('[auto-sync] startup Jira sync failed:', e) })
      }
    })()
  }, [cloudSyncing])

  // Jira interval poll — use the smallest configured interval across all enabled connections
  useEffect(() => {
    const active = jiraConnections.filter((c) => c.enabled && c.syncInterval && c.token)
    if (!active.length) return
    const ms = Math.min(...active.map((c) => c.syncInterval)) * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { added, updated, removed } = await useStore.getState().syncJira()
        // Always surface a toast so the user can see auto-sync is alive, even with no changes.
        if (added || updated || removed) {
          onToast(`Jira synced — ${added} added, ${updated} updated${removed ? `, ${removed} closed removed` : ''}`)
        } else {
          onToast('Jira synced — up to date')
        }
      } catch (e) {
        console.warn('[auto-sync] Jira interval sync failed:', e)
        onToast('Jira auto-sync failed — check connection')
      }
    }, ms)
    return () => clearInterval(id)
  }, [JSON.stringify(jiraConnections.map((c) => [c.id, c.enabled, c.syncInterval, c.token]))])

  // GitLab interval poll
  useEffect(() => {
    const active = gitlabConnections.filter((c) => c.enabled && c.syncInterval && c.token && c.groupPath)
    if (!active.length) return
    const ms = Math.min(...active.map((c) => c.syncInterval)) * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { linked } = await useStore.getState().syncGitlab()
        if (linked) onToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`)
      } catch {}
    }, ms)
    return () => clearInterval(id)
  }, [JSON.stringify(gitlabConnections.map((c) => [c.id, c.enabled, c.syncInterval, c.token]))])

  // GitHub interval poll
  useEffect(() => {
    const active = githubConnections.filter((c) => c.enabled && c.syncInterval && c.token && c.orgOrUser)
    if (!active.length) return
    const ms = Math.min(...active.map((c) => c.syncInterval)) * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { linked } = await useStore.getState().syncGithub()
        if (linked) onToast(`GitHub synced — ${linked} PR${linked !== 1 ? 's' : ''} linked`)
      } catch {}
    }, ms)
    return () => clearInterval(id)
  }, [JSON.stringify(githubConnections.map((c) => [c.id, c.enabled, c.syncInterval, c.token, c.orgOrUser]))])

  // GitLab sync on window focus — throttled to once every 5 minutes
  useEffect(() => {
    const onFocus = () => {
      const conns = useStore.getState().gitlabConnections
      const stale = conns.some((c) => {
        if (!c.enabled || !c.token || !c.groupPath) return false
        const lastSyncMs = c.lastSync ? new Date(c.lastSync).getTime() : 0
        return Date.now() - lastSyncMs >= 5 * 60 * 1000
      })
      if (!stale) return
      useStore.getState().syncGitlab()
        .then(({ linked }) => { if (linked) onToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`) })
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [onToast])

  // GitHub sync on window focus — throttled to once every 5 minutes
  useEffect(() => {
    const onFocus = () => {
      const conns = useStore.getState().githubConnections
      const stale = conns.some((c) => {
        if (!c.enabled || !c.token || !c.orgOrUser) return false
        const lastSyncMs = c.lastSync ? new Date(c.lastSync).getTime() : 0
        return Date.now() - lastSyncMs >= 5 * 60 * 1000
      })
      if (!stale) return
      useStore.getState().syncGithub()
        .then(({ linked }) => { if (linked) onToast(`GitHub synced — ${linked} PR${linked !== 1 ? 's' : ''} linked`) })
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [onToast])
}
