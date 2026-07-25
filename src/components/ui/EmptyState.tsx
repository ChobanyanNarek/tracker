import Icon, { type IconName } from './Icon'

interface Props {
  icon?: IconName
  title: string
  hint?: string
  action?: React.ReactNode
}

/** Friendly centered empty state — icon, title, hint line, optional action button. */
export default function EmptyState({ icon = 'info', title, hint, action }: Props) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 20px', color: 'var(--text3)' }}>
      <div style={{ marginBottom: 12, opacity: 0.35, display: 'flex', justifyContent: 'center' }}>
        <Icon name={icon} size={32} strokeWidth={1.5} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text2)', marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}
