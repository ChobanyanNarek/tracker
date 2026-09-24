import { useState } from 'react'
import { useStore } from '../../store'
import { apiUrl } from '../../utils/cloud-api'
import { copyText } from '../../utils/clipboard'

const WHERE: Record<'jira' | 'github' | 'gitlab', string> = {
  jira: 'In Jira: Settings → System → WebHooks (needs Jira admin). Events: issue created, updated, deleted.',
  github: 'In GitHub: the repo or organisation Settings → Webhooks. Content type application/json, event: Pull requests.',
  gitlab: 'In GitLab: the group Settings → Webhooks. Trigger: Merge request events.',
}

/*
 * The server syncs every connection on its own interval. A webhook makes it sync within
 * about 20 seconds of a change instead. Optional: shown only when the server runs syncs.
 */
export default function WebhookHint({ provider }: { provider: 'jira' | 'github' | 'gitlab' }) {
  // Only while the server runs syncs: otherwise the address would trigger nothing.
  const hookPath = useStore((s) => (s.serverSync?.serverSync ? s.serverSync.hookPath : undefined))
  const [copied, setCopied] = useState(false)
  if (!hookPath) return null
  const url = apiUrl(hookPath)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 'var(--r)', background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>Instant updates (optional)</span>
      <span style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
        Syncing already runs on the server on each connection's interval. To sync within seconds of a change, add this address as a webhook. {WHERE[provider]}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Webhook address"
          style={{ flex: 1, background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)', minWidth: 0 }}
        />
        <button
          className="btn-secondary"
          onClick={() => { void copyText(url).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }) }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>Keep it private: anyone with this address can start a sync of your data (they can't read it).</span>
    </div>
  )
}
