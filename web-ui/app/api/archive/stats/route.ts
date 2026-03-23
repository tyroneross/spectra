import { NextResponse } from 'next/server'
import { getStorageStats } from '@/lib/data'

export async function GET() {
  try {
    const stats = await getStorageStats()
    return NextResponse.json(stats)
  } catch (err) {
    console.error('[GET /api/archive/stats]', err)
    return NextResponse.json({ error: 'Failed to compute storage stats' }, { status: 500 })
  }
}
