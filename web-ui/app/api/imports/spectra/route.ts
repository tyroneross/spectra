import { NextRequest, NextResponse } from 'next/server'
import { importCaptureCandidates, listCaptureImportCandidates } from '@/lib/data'

export async function GET() {
  try {
    const candidates = await listCaptureImportCandidates()
    return NextResponse.json(candidates)
  } catch (err) {
    console.error('[GET /api/imports/spectra]', err)
    return NextResponse.json({ error: 'Failed to discover capture imports' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { ids?: unknown }
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ error: 'ids must be a non-empty string array' }, { status: 400 })
    }
    const ids = body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    if (ids.length !== body.ids.length || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty string array' }, { status: 400 })
    }

    const results = await importCaptureCandidates(ids)
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    console.error('[POST /api/imports/spectra]', err)
    return NextResponse.json({ error: 'Failed to import captures' }, { status: 500 })
  }
}
