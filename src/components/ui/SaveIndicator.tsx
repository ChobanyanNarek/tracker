import { useStore } from '../../store'
import Icon from './Icon'

// Small shared indicator reflecting the store's real cloud-save status
// (saveStatus is updated by flushPersist in store/index.ts based on the actual
// PUT result — not just assumed success).
export default function SaveIndicator({ compact }: { compact?: boolean }) {
  const saveStatus = useStore((s) => s.saveStatus)

  if (saveStatus === 'saving') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text3)', fontWeight: 600 }}>
        <Icon name="sync" size={12} color="var(--text3)" />
        {!compact && 'Saving…'}
      </span>
    )
  }
  if (saveStatus === 'error') {
    return (
      <span title="Changes couldn't be saved to the cloud — retrying automatically" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--red)', fontWeight: 600 }}>
        <Icon name="info" size={12} color="var(--red)" />
        {!compact && 'Not saved — retrying'}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--green)', fontWeight: 600 }}>
      <Icon name="check" size={12} color="var(--green)" />
      {!compact && 'Saved'}
    </span>
  )
}
