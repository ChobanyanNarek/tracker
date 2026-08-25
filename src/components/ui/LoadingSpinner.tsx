// The app's own rotating gear mark, reused as the loading indicator everywhere
// instead of a generic spinner — keeps loading states on-brand with the logo
// in TopBar (which spins the same way, continuously, as its idle state).
export default function LoadingSpinner({ size = 16, color = '#171a2d', ringColor = '#ffffff', duration = '.8s' }: { size?: number; color?: string; ringColor?: string; duration?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, animation: `spin ${duration} linear infinite` }}>
      <path fillRule="evenodd" fill={color} d="M24,3 A21,21 0 1,0 24,45 A21,21 0 1,0 24,3 Z M24,9 A15,15 0 1,0 24,39 A15,15 0 1,0 24,9 Z"/>
      <g stroke={ringColor} strokeWidth="2.2" strokeLinecap="round">
        <line x1="21" y1="7" x2="27" y2="5"/>
        <line x1="21" y1="7" x2="27" y2="5" transform="rotate(60 24 24)"/>
        <line x1="21" y1="7" x2="27" y2="5" transform="rotate(120 24 24)"/>
        <line x1="21" y1="7" x2="27" y2="5" transform="rotate(180 24 24)"/>
        <line x1="21" y1="7" x2="27" y2="5" transform="rotate(240 24 24)"/>
        <line x1="21" y1="7" x2="27" y2="5" transform="rotate(300 24 24)"/>
      </g>
    </svg>
  )
}
