import { NextRequest, NextResponse } from 'next/server'
import { getPlaybook, savePlaybook, deletePlaybook } from '@/lib/data'
import type { Playbook } from '@/lib/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const playbook = await getPlaybook(id)
    if (!playbook) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
    }
    return NextResponse.json(playbook)
  } catch (err) {
    console.error('[GET /api/playbooks/[id]]', err)
    return NextResponse.json({ error: 'Failed to load playbook' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json() as Partial<Playbook>

    const existing = await getPlaybook(id)
    if (!existing) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
    }

    const updated: Playbook = {
      ...existing,
      ...body,
      id, // prevent ID change
      updatedAt: Date.now(),
    }

    await savePlaybook(updated)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[PUT /api/playbooks/[id]]', err)
    return NextResponse.json({ error: 'Failed to update playbook' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await getPlaybook(id)
    if (!existing) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
    }

    await deletePlaybook(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/playbooks/[id]]', err)
    return NextResponse.json({ error: 'Failed to delete playbook' }, { status: 500 })
  }
}
