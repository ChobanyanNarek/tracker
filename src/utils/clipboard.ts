// navigator.clipboard.writeText rejects in insecure contexts, denied permissions,
// or iframes without a clipboard-write permissions-policy — always handle failure
// instead of letting callers await it bare (which produced silent unhandled
// rejections with no user-facing error before this helper existed).
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
