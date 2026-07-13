import type { Status, JiraConfig } from '../../types'
import { resolveGroups, GROUP_COLOR_TOKENS, legacyStatusToGroupId } from '../../utils/status-groups'

interface Props {
  value: Status
  groupId?: string
  conn?: JiraConfig
  onChange: (v: Status, groupId: string) => void
  style?: React.CSSProperties
}

export default function StatusSelect({ value, groupId, conn, onChange, style }: Props) {
  const groups = resolveGroups(conn)
  const activeId = groupId ?? legacyStatusToGroupId(value)
  const activeGroup = groups.find((g) => g.id === activeId) ?? groups[0]!
  const tokens = GROUP_COLOR_TOKENS[activeGroup.color]

  return (
    <select
      value={activeId}
      onChange={(e) => {
        const gid = e.target.value
        const group = groups.find((g) => g.id === gid)
        // Derive legacy Status from group — isClosed=done, else keep internal logic
        const newStatus: Status = group?.isClosed ? 'done'
          : gid === 'blocked' ? 'blocked'
          : gid === 'review' ? 'review'
          : gid === 'inprogress' ? 'inprogress'
          : 'todo'
        onChange(newStatus, gid)
      }}
      style={{
        border: '1.5px solid',
        borderRadius: 20,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        fontWeight: 600,
        padding: '4px 24px 4px 10px',
        outline: 'none',
        cursor: 'pointer',
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239aa0b8' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        transition: 'all .15s',
        background: tokens.bg,
        color: tokens.text,
        borderColor: tokens.border,
        ...style,
      }}
    >
      {groups.map((g) => {
        const t = GROUP_COLOR_TOKENS[g.color]
        return (
          <option key={g.id} value={g.id} style={{ background: t.bg.startsWith('var') ? undefined : t.bg, color: 'var(--text)', fontWeight: 500 }}>
            {g.label}
          </option>
        )
      })}
    </select>
  )
}
