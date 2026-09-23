// The only global the shared sync core uses, for checking it without the DOM library (the
// server provides it through Node's types).
declare const console: {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}
