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

  if (online && saveStatus !== 'error') return null

  const message = !online
    ? "You're offline — changes are saved locally and will sync once you're back online."
    : "Couldn't save your changes to the cloud — retrying automatically."

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '7px 16px', background: 'var(--amber-dim)', borderBottom: '1px solid var(--amber-border)',
      color: 'var(--amber)', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, textAlign: 'center', flexShrink: 0,
    }}>
      <Icon name="info" size={13} color="var(--amber)" />
      {message}
    </div>
  )
}
