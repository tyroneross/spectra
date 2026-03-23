import { NextRequest, NextResponse } from 'next/server'
import { listPlaybooks, savePlaybook } from '@/lib/data'
import type { Playbook } from '@/lib/types'

export async function GET() {
  try {
    const playbooks = await listPlaybooks()
    return NextResponse.json(playbooks)
  } catch (err) {
    console.error('[GET /api/playbooks]', err)
    return NextResponse.json({ error: 'Failed to list playbooks' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Playbook>

    if (!body.name || !body.platform) {
      return NextResponse.json({ error: 'Missing required fields: name, platform' }, { status: 400 })
    }

    const now = Date.now()
    const playbook: Playbook = {
      id: crypto.randomUUID(),
      name: body.name,
      description: body.description ?? '',
      target: body.target ?? '',
      platform: body.platform,
      steps: body.steps ?? [],
      createdAt: now,
      updatedAt: now,
    }

    await savePlaybook(playbook)
    return NextResponse.json(playbook, { status: 201 })
  } catch (err) {
    console.error('[POST /api/playbooks]', err)
    return NextResponse.json({ error: 'Failed to create playbook' }, { status: 500 })
  }
}
