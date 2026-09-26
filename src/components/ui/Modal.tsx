import { useEscapeKey } from '../../hooks/useEscapeKey'

interface Props {
  title: React.ReactNode
  subtitle?: React.ReactNode
  width?: number
  zIndex?: number
  headerExtra?: React.ReactNode
  footer?: React.ReactNode
  bodyStyle?: React.CSSProperties
  onClose: () => void
  children: React.ReactNode
}

/** Shared modal shell — overlay, box, header with close button, body, optional footer.
 *  Closes on Escape and on overlay click. */
export default function Modal({ title, subtitle, width, zIndex, headerExtra, footer, bodyStyle, onClose, children }: Props) {
  // Shared with the side panels so one Escape closes only the overlay on top.
  useEscapeKey(true, onClose)

  return (
    <div className="modal-ov" style={zIndex ? { zIndex } : undefined} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={width ? { width } : undefined}>
        <div className="modal-hdr">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          {headerExtra}
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={bodyStyle}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
