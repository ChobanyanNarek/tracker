import Modal from './Modal'

interface Props {
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** In-app replacement for window.confirm() — consistent styling, Escape to cancel. */
export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onCancel }: Props) {
  return (
    <Modal
      title={title}
      width={400}
      zIndex={1200}
      onClose={onCancel}
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
        {message ?? 'This action cannot be undone.'}
      </div>
    </Modal>
  )
}
