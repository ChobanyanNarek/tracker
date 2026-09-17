import { useStore } from '../../store'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import Icon from '../ui/Icon'

// Persistent banner so a connectivity or save failure is never silent — the
// prior notes-wipe incident traced back to exactly this class of bug (a
// failed save with no visible signal). Shown for either the browser going
// offline, or a save actively failing/retrying while still online.
export default function ConnectivityBanner() {
  const online = useOnlineStatus()
  const saveStatus = useStore((s) => s.saveStatus)
  const saveError = useStore((s) => s.saveError)

  if (online && saveStatus !== 'error') return null

  // An expired session is NOT a transient failure — no amount of retrying fixes it, and
  // claiming "retrying automatically" while every attempt fails instantly is how unsaved
  // edits get silently lost. Say so plainly and offer the only thing that works.
  const expired = online && saveError === 'unauthorized'

  const message = !online
    ? "You're offline — changes are saved locally and will sync once you're back online."
    : expired
      ? 'Your session expired, so changes are not being saved. Sign in again to save them.'
      : "Couldn't save your changes to the cloud — retrying automatically."

  const color = expired ? 'var(--red)' : 'var(--amber)'
  const bg = expired ? 'var(--red-dim)' : 'var(--amber-dim)'
  const border = expired ? 'var(--red-border)' : 'var(--amber-border)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '7px 16px', background: bg, borderBottom: `1px solid ${border}`,
      color, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, textAlign: 'center', flexShrink: 0,
    }}>
      <Icon name="info" size={13} color={color} />
      {message}
      {expired && (
        <button
          onClick={() => window.location.reload()}
          style={{
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, padding: '3px 10px',
            borderRadius: 6, border: `1px solid ${color}`, background: 'transparent',
            color, cursor: 'pointer',
          }}
        >
          Sign in
        </button>
      )}
    </div>
  )
}
