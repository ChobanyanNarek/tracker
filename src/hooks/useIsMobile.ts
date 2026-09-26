import { useEffect, useState } from 'react'

/** Phone-sized viewport — matches the `@media (max-width: 640px)` block in index.css. */
export const MOBILE_MAX = 640

export function useIsMobile(max: number = MOBILE_MAX): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < max : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${max - 1}px)`)
    const check = () => setIsMobile(mq.matches)
    check()
    mq.addEventListener('change', check)
    return () => mq.removeEventListener('change', check)
  }, [max])

  return isMobile
}
