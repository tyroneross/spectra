import { NextRequest, NextResponse } from 'next/server'
import { getProductionBundle } from '@/lib/data'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const bundle = await getProductionBundle(id)

    if (!bundle) {
      return NextResponse.json({ error: 'Production bundle not found' }, { status: 404 })
    }

    return NextResponse.json(bundle)
  } catch (err) {
    console.error('[GET /api/productions/:id]', err)
    return NextResponse.json({ error: 'Failed to load production bundle' }, { status: 500 })
  }
}
