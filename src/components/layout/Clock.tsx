import { useEffect, useState } from 'react'

const fmt = () =>
  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function Clock() {
  const [time, setTime] = useState(fmt)
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{time}</span>
}
