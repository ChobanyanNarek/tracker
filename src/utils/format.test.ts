import { describe, expect, it } from 'vitest'
import { keysFromText, nestByParent } from './format'

describe('keysFromText', () => {
  it('matches only the configured project keys', () => {
    // Regression: a generic fallback also ran, so a PR titled MIND-42 linked
    // into a project that only has MAB and COM.
    expect(keysFromText('MIND-42 fix login', ['MAB', 'COM'])).toEqual([])
    expect(keysFromText('COM-1326 fix login', ['MAB', 'COM'])).toEqual(['COM-1326'])
  })

  it('matches lowercase branch names', () => {
    expect(keysFromText('feature/com-1326', ['COM'])).toEqual(['COM-1326'])
  })

  it('does not let a short key swallow a longer one', () => {
    expect(keysFromText('MINDPORT-1', ['MIN'])).toEqual([])
  })

  it('falls back to any KEY-123 when a project has no keys configured', () => {
    expect(keysFromText('ANY-9 fix', [])).toEqual(['ANY-9'])
  })
})

describe('nestByParent', () => {
  const I = (issueId: string, parentKey?: string) => ({ issueId, parentKey })
  const shape = (rows: ReturnType<typeof nestByParent<ReturnType<typeof I>>>) =>
    rows.map((r) => `${'-'.repeat(r.depth)}${r.issue.issueId}`)

  it('places subtasks directly under their parent', () => {
    expect(shape(nestByParent([I('A'), I('B', 'A'), I('C', 'A'), I('D')]))).toEqual(['A', '-B', '-C', 'D'])
  })

  it('keeps an orphan visible when its parent is absent', () => {
    expect(shape(nestByParent([I('X', 'NOT-HERE')]))).toEqual(['X'])
  })

  it('survives self-parents and cycles without hanging', () => {
    expect(shape(nestByParent([I('S', 'S')]))).toEqual(['S'])
    expect(shape(nestByParent([I('P', 'Q'), I('Q', 'P')])).sort()).toEqual(['P', 'Q'])
  })
})
