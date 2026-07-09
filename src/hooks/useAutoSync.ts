import { useEffect } from 'react'
import { useStore } from '../store'

/** Background Jira / GitLab syncing:
 *  - GitLab sync on startup when data is stale (> 30 min since last sync)
 *  - interval polling for both providers (per their configured syncInterval)
 *  - GitLab sync on window focus, throttled to once per 5 minutes */
export function useAutoSync(onToast: (msg: string) => void) {
  const jiraConfig = useStore((s) => s.jiraConfig)
  const gitlabConfig = useStore((s) => s.gitlabConfig)

  // Startup GitLab sync — ensures PR links appear after a browser refresh
  // without requiring the user to manually open settings and click "Sync Now".
  useEffect(() => {
    const gc = useStore.getState().gitlabConfig
    if (!gc.enabled || !gc.token || !gc.groupPath) return
    const lastSyncMs = gc.lastSync ? new Date(gc.lastSync).getTime() : 0
    if (Date.now() - lastSyncMs <= 30 * 60 * 1000) return
    const timer = setTimeout(() => {
      useStore.getState().syncGitlab()
        .then(({ linked }) => { if (linked) onToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`) })
        .catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // Jira interval poll
  useEffect(() => {
    if (!jiraConfig.enabled || !jiraConfig.syncInterval || !jiraConfig.token) return
    const ms = jiraConfig.syncInterval * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { added, updated, removed } = await useStore.getState().syncJira()
        if (added || updated || removed) {
          onToast(`Jira synced — ${added} added, ${updated} updated${removed ? `, ${removed} closed removed` : ''}`)
        }
      } catch {}
    }, ms)
    return () => clearInterval(id)
  }, [jiraConfig.enabled, jiraConfig.syncInterval, jiraConfig.token])

  // GitLab interval poll
  useEffect(() => {
    if (!gitlabConfig.enabled || !gitlabConfig.syncInterval || !gitlabConfig.token) return
    const ms = gitlabConfig.syncInterval * 60 * 1000
    const id = setInterval(async () => {
      try {
        const { linked } = await useStore.getState().syncGitlab()
        if (linked) onToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`)
      } catch {}
    }, ms)
    return () => clearInterval(id)
  }, [gitlabConfig.enabled, gitlabConfig.syncInterval, gitlabConfig.token])

  // GitLab sync on window focus — throttled to once every 5 minutes so
  // switching tabs rapidly doesn't spam the API.
  useEffect(() => {
    const onFocus = () => {
      const gc = useStore.getState().gitlabConfig
      if (!gc.enabled || !gc.token || !gc.groupPath) return
      const lastSyncMs = gc.lastSync ? new Date(gc.lastSync).getTime() : 0
      if (Date.now() - lastSyncMs < 5 * 60 * 1000) return
      useStore.getState().syncGitlab()
        .then(({ linked }) => { if (linked) onToast(`GitLab synced — ${linked} MR${linked !== 1 ? 's' : ''} linked`) })
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [onToast])
}
