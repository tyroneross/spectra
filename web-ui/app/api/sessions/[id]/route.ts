import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from 'spectra'
import { getSession } from '@/lib/data'

function getSessionsDir(): string {
  return join(getStoragePath(process.cwd()), 'sessions')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession(id)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    return NextResponse.json(session)
  } catch (err) {
    console.error('[GET /api/sessions/[id]]', err)
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json() as { name?: string }

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    }

    const sessionFile = join(getSessionsDir(), id, 'session.json')
    let raw: string
    try {
      raw = await readFile(sessionFile, 'utf-8')
    } catch {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const data = JSON.parse(raw) as Record<string, unknown>
    data.name = body.name
    data.updatedAt = Date.now()

    await writeFile(sessionFile, JSON.stringify(data, null, 2), 'utf-8')

    const updated = await getSession(id)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[PATCH /api/sessions/[id]]', err)
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
  }
}
