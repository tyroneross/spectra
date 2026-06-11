import { NextResponse } from 'next/server'
import { listProductionBundles } from '@/lib/data'

export async function GET() {
  try {
    const bundles = await listProductionBundles()
    return NextResponse.json(bundles)
  } catch (err) {
    console.error('[GET /api/productions]', err)
    return NextResponse.json({ error: 'Failed to list production bundles' }, { status: 500 })
  }
}
