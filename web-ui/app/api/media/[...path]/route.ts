import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { resolveMediaPath } from '@/lib/data'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params
    const relativePath = segments.join('/')

    const absPath = resolveMediaPath(relativePath)
    if (!absPath) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    let data: Buffer
    try {
      data = await readFile(absPath)
    } catch {
      return new NextResponse('Not Found', { status: 404 })
    }

    const ext = extname(absPath).toLowerCase()
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(data.byteLength),
      },
    })
  } catch (err) {
    console.error('[GET /api/media]', err)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
