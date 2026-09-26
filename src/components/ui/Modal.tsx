import { useEffect, useId, useRef } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { captureFocusOrigin, restoreFocusOrigin } from '../../utils/focus-return'

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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Shared modal shell — overlay, box, header with close button, body, optional footer.
 *  Closes on Escape and on overlay click. */
export default function Modal({ title, subtitle, width, zIndex, headerExtra, footer, bodyStyle, onClose, children }: Props) {
  // Shared with the side panels so one Escape closes only the overlay on top.
  useEscapeKey(true, onClose)
  const boxRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Keyboard and screen-reader users were left behind the modal: focus stayed on the
  // page underneath, and Tab walked the hidden content. Move focus in, keep it in, and
  // hand it back to whatever opened the modal.
  useEffect(() => {
    const opener = captureFocusOrigin()
    const box = boxRef.current
    // The box, not its first control: that first control is the close button, and landing
    // on it means a stray Enter shuts the dialog. A screen reader reads the title here,
    // and Tab moves on to the fields.
    box?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box) return
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const firstEl = items[0]!
      const lastEl = items[items.length - 1]!
      if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocusOrigin(opener)
    }
  }, [])

  return (
    <div className="modal-ov" style={zIndex ? { zIndex } : undefined} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={width ? { width } : undefined}>
        <div className="modal-hdr">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title" id={titleId}>{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          {headerExtra}
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body" style={bodyStyle}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
