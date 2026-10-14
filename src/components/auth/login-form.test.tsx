import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LoginPage from './LoginPage'

/*
 * "Min 6 characters" is a rule for creating an account. It was on the shared password
 * input, so it also applied to signing in, and every account whose password predates the
 * rule was locked out: the browser refused to submit, the password never reached the
 * server, and the form said only "please lengthen this text".
 */
describe('the password field', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
  })

  const render = () => {
    act(() => { root.render(<LoginPage onAuth={() => {}} />) })

    return host.querySelector<HTMLInputElement>('input[type="password"]')!
  }

  const clickTab = (label: string) => {
    const tab = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
    act(() => { tab?.click() })
  }

  it('accepts a password shorter than a new one is allowed to be', () => {
    const input = render()

    expect(input.hasAttribute('minLength')).toBe(false)

    input.value = 'nch'

    expect(input.checkValidity()).toBe(true)
  })

  it('still holds new accounts to six characters', () => {
    render()
    clickTab('Create Account')
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!

    expect(input.minLength).toBe(6)
  })
})
