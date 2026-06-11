import { NextResponse } from 'next/server'
import { listPlaybookRecommendations } from '@/lib/data'

export async function GET() {
  try {
    const recommendations = await listPlaybookRecommendations()
    return NextResponse.json(recommendations)
  } catch (err) {
    console.error('[GET /api/playbooks/recommendations]', err)
    return NextResponse.json({ error: 'Failed to list playbook recommendations' }, { status: 500 })
  }
}
