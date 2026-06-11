import { describe, expect, it, vi } from 'vitest'
import { POST } from '../../app/api/imports/spectra/route.js'
import { importCaptureCandidates } from '@/lib/data'

vi.mock('@/lib/data', () => ({
  importCaptureCandidates: vi.fn().mockResolvedValue([{ candidateId: 'abc123', copied: 1 }]),
  listCaptureImportCandidates: vi.fn().mockResolvedValue([]),
}))

function requestWithBody(body: unknown) {
  return {
    json: async () => body,
  } as never
}

describe('POST /api/imports/spectra', () => {
  it('rejects missing import ids instead of importing everything', async () => {
    const response = await POST(requestWithBody({}))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'ids must be a non-empty string array' })
    expect(importCaptureCandidates).not.toHaveBeenCalled()
  })

  it('passes validated import ids to the importer', async () => {
    const response = await POST(requestWithBody({ ids: ['candidate-a'] }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, results: [{ candidateId: 'abc123', copied: 1 }] })
    expect(importCaptureCandidates).toHaveBeenCalledWith(['candidate-a'])
  })
})
