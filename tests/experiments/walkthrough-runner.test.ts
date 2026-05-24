import { describe, expect, it } from 'vitest'
import { snapshotArgs } from '../../.build-loop/experiments/walkthrough-bench/runner.js'

describe('walkthrough benchmark runner', () => {
  it('requests screenshots only for axPlusScreenshot cells', () => {
    expect(snapshotArgs('s1', { snapshot: 'axOnly' })).toEqual({
      sessionId: 's1',
      screenshot: false,
    })
    expect(snapshotArgs('s1', { snapshot: 'axPlusScreenshot' })).toEqual({
      sessionId: 's1',
      screenshot: true,
    })
  })
})
