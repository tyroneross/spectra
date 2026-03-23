import { NextRequest, NextResponse } from 'next/server'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from 'spectra'
import { listSessions } from '@/lib/data'

function getSessionsDir(): string {
  return join(getStoragePath(process.cwd()), 'sessions')
}

export async function GET() {
  try {
    const sessions = await listSessions()
    return NextResponse.json(sessions)
  } catch (err) {
    console.error('[GET /api/sessions]', err)
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { id?: string }
    const { id } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing session id' }, { status: 400 })
    }

    // Reject traversal attempts
    if (id.includes('/') || id.includes('..') || id.includes('\0')) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }

    const sessionDir = join(getSessionsDir(), id)
    await rm(sessionDir, { recursive: true, force: true })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/sessions]', err)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
