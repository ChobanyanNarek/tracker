import { beforeEach, describe, expect, it } from 'vitest'
import { captureFocusOrigin, restoreFocusOrigin } from './focus-return'

/*
 * Closing a modal used to drop focus at the top of the page whenever it had been opened
 * from a menu: the menu unmounts as the modal appears, so the element that opened it is
 * already detached by the time the modal looks for it.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

function openMenu(): { trigger: HTMLButtonElement; item: HTMLButtonElement; menu: HTMLDivElement } {
  const wrap = document.createElement('div')
  const trigger = document.createElement('button')
  trigger.textContent = 'Account'
  const menu = document.createElement('div')
  const item = document.createElement('button')
  item.textContent = 'Profile settings'
  menu.append(item)
  wrap.append(trigger, menu)
  document.body.append(wrap)
  return { trigger, item, menu }
}

describe('focus return', () => {
  it('goes straight back to an opener that is still on the page', () => {
    const { trigger } = openMenu()
    trigger.focus()

    const origin = captureFocusOrigin()
    trigger.blur()
    restoreFocusOrigin(origin)

    expect(document.activeElement).toBe(trigger)
  })

  it("falls back to the menu's trigger when the opener has been unmounted", () => {
    const { trigger, item, menu } = openMenu()
    item.focus()

    const origin = captureFocusOrigin()
    menu.remove() // the menu closes as the modal opens
    restoreFocusOrigin(origin)

    expect(document.activeElement).toBe(trigger)
  })

  it('leaves focus alone rather than guessing when nothing is left', () => {
    const { item, menu } = openMenu()
    item.focus()
    const origin = captureFocusOrigin()

    menu.parentElement!.remove()
    restoreFocusOrigin(origin)

    expect(document.activeElement).toBe(document.body)
  })

  it('never returns to a dialog, which is what StrictMode would capture on its second mount', () => {
    const { trigger } = openMenu()
    trigger.focus()
    captureFocusOrigin()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.tabIndex = -1
    document.body.append(dialog)
    dialog.focus()

    expect(captureFocusOrigin()?.el).toBe(trigger)
  })
})
