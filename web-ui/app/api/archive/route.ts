import { NextRequest, NextResponse } from 'next/server'
import { rename, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { getStoragePath } from 'spectra'
import { listArchived, resolveMediaPath } from '@/lib/data'

function getArchiveDir(): string {
  return join(getStoragePath(process.cwd()), 'archive')
}

function getArtifactsUploadsDir(): string {
  // Resolve artifacts relative to cwd (project root detection mirrors lib/data.ts)
  return join(process.cwd(), 'artifacts', 'uploads')
}

export async function GET() {
  try {
    const captures = await listArchived()
    return NextResponse.json(captures)
  } catch (err) {
    console.error('[GET /api/archive]', err)
    return NextResponse.json({ error: 'Failed to list archive' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''

    // Handle multipart upload separately
    if (contentType.startsWith('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
      }

      const uploadsDir = getArtifactsUploadsDir()
      await mkdir(uploadsDir, { recursive: true })

      const bytes = await file.arrayBuffer()
      const destPath = join(uploadsDir, file.name)
      await writeFile(destPath, Buffer.from(bytes))

      return NextResponse.json({ ok: true, path: `artifacts/uploads/${file.name}` }, { status: 201 })
    }

    // JSON action-based operations
    const body = await req.json() as {
      action: 'archive' | 'restore' | 'delete' | 'upload'
      path?: string
      file?: string
    }

    const { action } = body

    if (action === 'archive') {
      const relPath = body.path
      if (!relPath) {
        return NextResponse.json({ error: 'Missing path' }, { status: 400 })
      }

      const srcAbs = resolveMediaPath(relPath)
      if (!srcAbs) {
        return NextResponse.json({ error: 'Forbidden path' }, { status: 403 })
      }

      const archiveDir = getArchiveDir()
      await mkdir(archiveDir, { recursive: true })
      const destAbs = join(archiveDir, basename(relPath))
      await rename(srcAbs, destAbs)

      return NextResponse.json({ ok: true })
    }

    if (action === 'restore') {
      const relPath = body.path
      if (!relPath) {
        return NextResponse.json({ error: 'Missing path' }, { status: 400 })
      }

      // path is relative from project root — validate it lives inside archive dir
      const archiveDir = getArchiveDir()
      const srcAbs = join(archiveDir, basename(relPath))

      // Security: ensure srcAbs is inside archiveDir
      if (!srcAbs.startsWith(archiveDir)) {
        return NextResponse.json({ error: 'Forbidden path' }, { status: 403 })
      }

      const artifactsDir = join(process.cwd(), 'artifacts')
      await mkdir(artifactsDir, { recursive: true })
      const destAbs = join(artifactsDir, basename(relPath))
      await rename(srcAbs, destAbs)

      return NextResponse.json({ ok: true })
    }

    if (action === 'delete') {
      const relPath = body.path
      if (!relPath) {
        return NextResponse.json({ error: 'Missing path' }, { status: 400 })
      }

      const absPath = resolveMediaPath(relPath)
      if (!absPath) {
        return NextResponse.json({ error: 'Forbidden path' }, { status: 403 })
      }

      await rm(absPath, { force: true })
      return NextResponse.json({ ok: true })
    }

    if (action === 'upload') {
      // JSON-based upload not supported — use multipart/form-data
      return NextResponse.json(
        { error: 'Use multipart/form-data for upload action' },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[POST /api/archive]', err)
    return NextResponse.json({ error: 'Archive operation failed' }, { status: 500 })
  }
}
