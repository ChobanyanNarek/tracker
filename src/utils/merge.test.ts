import { describe, expect, it } from 'vitest'
import { deepEqual, merge3 } from './merge'

describe('deepEqual', () => {
  it('treats an undefined property as missing, like JSON does', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('ignores key order but not array order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
  })

  it('tells null, undefined and values apart where JSON would', () => {
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual({ a: null }, { a: undefined })).toBe(false)
    expect(deepEqual(0, false)).toBe(false)
  })
})

describe('merge3', () => {
  it('takes the only side that changed', () => {
    expect(merge3({ a: 1 }, { a: 2 }, { a: 1 })).toEqual({ a: 2 })
    expect(merge3({ a: 1 }, { a: 1 }, { a: 3 })).toEqual({ a: 3 })
  })

  it('keeps edits to different fields from both sides', () => {
    const base = { title: 'x', comment: '', status: 'todo' }
    expect(merge3(base, { ...base, comment: 'mine' }, { ...base, status: 'done' }))
      .toEqual({ title: 'x', comment: 'mine', status: 'done' })
  })

  it('lets this tab win a field both sides changed', () => {
    expect(merge3({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 2 })
  })

  it('merges a task’s issues one by one: a sync on one tab, an edit on the other', () => {
    const issue = (key: string, patch = {}) => ({ issueId: key, url: `u/${key}`, status: 'todo', comment: '', ...patch })
    const base = { id: 't1', jiras: [issue('COM-1'), issue('COM-2')] }
    // Tab A synced: COM-2 moved to review and COM-3 arrived.
    const remote = { id: 't1', jiras: [issue('COM-1'), issue('COM-2', { status: 'review' }), issue('COM-3')] }
    // Tab B: the user commented on COM-1.
    const local = { id: 't1', jiras: [issue('COM-1', { comment: 'note' }), issue('COM-2')] }

    expect(merge3(base, local, remote).jiras).toEqual([
      issue('COM-1', { comment: 'note' }),
      issue('COM-2', { status: 'review' }),
      issue('COM-3'),
    ])
  })

  it('drops an item one side removed, unless the other side edited it', () => {
    const base = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }]
    const local = [{ id: 'a', v: 1 }] // removed b
    expect(merge3(base, local, [{ id: 'a', v: 2 }, { id: 'b', v: 1 }])).toEqual([{ id: 'a', v: 2 }])
    expect(merge3(base, local, [{ id: 'a', v: 1 }, { id: 'b', v: 9 }])).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 9 }])
  })

  it('keeps items both sides added', () => {
    const base = [{ id: 'a' }]
    expect(merge3(base, [{ id: 'a' }, { id: 'l' }], [{ id: 'a' }, { id: 'r' }]))
      .toEqual([{ id: 'a' }, { id: 'l' }, { id: 'r' }])
  })

  it('drops a field one side removed and the other left alone', () => {
    expect(merge3({ a: 1, hidden: true }, { a: 1 }, { a: 2, hidden: true })).toEqual({ a: 2 })
  })

  it('without a common base, keeps this tab’s value where the two differ', () => {
    expect(merge3(undefined, { a: 1, b: 2 }, { a: 9, c: 3 })).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('returns the remote copy itself when the two already agree', () => {
    const remote = { a: [1] }
    expect(merge3({ a: [] }, { a: [1] }, remote)).toBe(remote)
  })
})
