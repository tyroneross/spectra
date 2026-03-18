// tests/media/recorder.test.ts
import { describe, it, expect } from 'vitest'

describe('RecordHandle', () => {
  it('is importable', async () => {
    const { SimRecordHandle } = await import('../../src/media/recorder.js')
    expect(SimRecordHandle).toBeDefined()
  })
})
