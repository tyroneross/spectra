import { NextRequest, NextResponse } from 'next/server'
import { listCaptures } from '@/lib/data'
import type { CaptureFilters } from '@/lib/types'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams

    const filters: CaptureFilters = {}

    const sessionId = sp.get('sessionId')
    if (sessionId) filters.sessionId = sessionId

    const platform = sp.get('platform')
    if (platform) filters.platform = platform as CaptureFilters['platform']

    const type = sp.get('type')
    if (type === 'screenshot' || type === 'video') filters.type = type

    const search = sp.get('search')
    if (search) filters.search = search

    const sort = sp.get('sort')
    if (sort) filters.sort = sort as CaptureFilters['sort']

    const dateFrom = sp.get('dateFrom')
    if (dateFrom) filters.dateFrom = Number(dateFrom)

    const dateTo = sp.get('dateTo')
    if (dateTo) filters.dateTo = Number(dateTo)

    const archived = sp.get('archived')
    if (archived !== null) filters.archived = archived === 'true'

    const captures = await listCaptures(filters)
    return NextResponse.json(captures)
  } catch (err) {
    console.error('[GET /api/captures]', err)
    return NextResponse.json({ error: 'Failed to list captures' }, { status: 500 })
  }
}
