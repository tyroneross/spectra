import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises'
import { join, basename, extname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { listCaptures, resolveMediaPath } from '@/lib/data'
import type { ExportRequest, ExportCapture } from '@/lib/types'

// ─── Sharp (optional — graceful degradation if unavailable) ─────────────────

type SharpInstance = {
  extract(region: { left: number; top: number; width: number; height: number }): SharpInstance
  composite(layers: { input: Buffer; left: number; top: number }[]): SharpInstance
  resize(width: number, height: number): SharpInstance
  toBuffer(): Promise<Buffer>
  toFile(path: string): Promise<unknown>
}

let sharpLib: ((input: Buffer, options?: Record<string, unknown>) => SharpInstance) | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sharpLib = require('sharp')
} catch {
  console.warn('[export] sharp not available — image processing disabled')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return join(tmpdir(), `spectra-export-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

/** Parse a hex/rgb color string into RGBA bytes for a semi-transparent overlay. */
function hexToRgba(color: string = '#FFFF00'): { r: number; g: number; b: number; alpha: number } {
  const hex = color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) || 255
  const g = parseInt(hex.slice(2, 4), 16) || 255
  const b = parseInt(hex.slice(4, 6), 16) || 0
  return { r, g, b, alpha: 0.4 }
}

/** Create a solid-colour rectangle PNG buffer via sharp for compositing. */
async function makeHighlightBuffer(
  width: number,
  height: number,
  color: string
): Promise<Buffer> {
  if (!sharpLib) throw new Error('sharp not available')
  const { r, g, b, alpha } = hexToRgba(color)
  // Create raw RGBA pixel data
  const channels = 4
  const pixels = Buffer.alloc(width * height * channels)
  const a = Math.round(alpha * 255)
  for (let i = 0; i < width * height; i++) {
    pixels[i * channels] = r
    pixels[i * channels + 1] = g
    pixels[i * channels + 2] = b
    pixels[i * channels + 3] = a
  }
  return sharpLib(pixels, { raw: { width, height, channels } })
    .toBuffer()
}

/** Process a single capture: apply crop and/or highlights. Returns final buffer. */
async function processCapture(
  absPath: string,
  ec: ExportCapture,
  template?: string
): Promise<Buffer> {
  const raw = await readFile(absPath)

  if (!sharpLib) return raw
  if (!ec.crop && (!ec.highlights || ec.highlights.length === 0) && template !== 'social') {
    return raw
  }

  let img = sharpLib(raw)

  // Social template: crop to 1200x630
  if (template === 'social' && !ec.crop) {
    img = img.resize(1200, 630)
  }

  if (ec.crop) {
    img = img.extract({
      left: ec.crop.x,
      top: ec.crop.y,
      width: ec.crop.width,
      height: ec.crop.height,
    })
    if (template === 'social') {
      img = img.resize(1200, 630)
    }
  }

  if (ec.highlights && ec.highlights.length > 0) {
    const layers: { input: Buffer; left: number; top: number }[] = []
    for (const h of ec.highlights) {
      try {
        const buf = await makeHighlightBuffer(h.width, h.height, h.color ?? '#FFFF00')
        layers.push({ input: buf, left: h.x, top: h.y })
      } catch {
        // skip this highlight if buffer creation fails
      }
    }
    if (layers.length > 0) {
      img = img.composite(layers)
    }
  }

  return img.toBuffer()
}

/** Write a minimal tar.gz containing all files in srcDir. */
async function writeTarGz(srcDir: string, destFile: string, files: string[]): Promise<void> {
  // Simple approach: write a tar manually (POSIX ustar format)
  const BLOCK = 512

  function padEnd(s: string, len: number): Buffer {
    const b = Buffer.alloc(len, 0)
    Buffer.from(s).copy(b)
    return b
  }

  function octal(n: number, len: number): Buffer {
    return padEnd(n.toString(8).padStart(len - 1, '0') + ' ', len)
  }

  const chunks: Buffer[] = []

  for (const filePath of files) {
    const fileData = await readFile(filePath)
    const relName = filePath.replace(srcDir + '/', '')

    // Build 512-byte header
    const header = Buffer.alloc(BLOCK, 0)
    padEnd(relName, 100).copy(header, 0)        // name
    octal(0o644, 8).copy(header, 100)           // mode
    octal(0, 8).copy(header, 108)               // uid
    octal(0, 8).copy(header, 116)               // gid
    octal(fileData.length, 12).copy(header, 124) // size
    octal(Math.floor(Date.now() / 1000), 12).copy(header, 136) // mtime
    Buffer.from('        ').copy(header, 148)   // checksum placeholder
    header[156] = 0x30                          // typeflag '0' = regular file
    Buffer.from('ustar  \0').copy(header, 257)  // magic

    // Compute checksum
    let sum = 0
    for (let i = 0; i < BLOCK; i++) sum += header[i]
    octal(sum, 8).copy(header, 148)

    chunks.push(header)

    // File data padded to 512-byte boundary
    const padded = Buffer.alloc(Math.ceil(fileData.length / BLOCK) * BLOCK, 0)
    fileData.copy(padded)
    chunks.push(padded)
  }

  // Two 512-byte zero blocks = end of archive
  chunks.push(Buffer.alloc(BLOCK * 2, 0))

  const tarData = Buffer.concat(chunks)

  await new Promise<void>((res, rej) => {
    const out = createWriteStream(destFile)
    const gz = createGzip()
    gz.on('error', rej)
    out.on('error', rej)
    out.on('finish', res)
    gz.pipe(out)
    gz.end(tarData)
  })
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ExportRequest

    const { format, template, outputDir: requestedOutputDir, captures: exportCaptures } = body

    if (!Array.isArray(exportCaptures) || exportCaptures.length === 0) {
      return NextResponse.json({ error: 'No captures specified' }, { status: 400 })
    }

    // Load all captures to resolve IDs → paths
    const allCaptures = await listCaptures()
    const captureMap = new Map(allCaptures.map((c) => [c.id, c]))

    // Resolve and validate output directory
    const outputDir = requestedOutputDir
      ? resolve(requestedOutputDir)
      : makeTempDir()

    await mkdir(outputDir, { recursive: true })

    // Sort by order
    const sorted = [...exportCaptures].sort((a, b) => a.order - b.order)

    // Process each capture
    const processedFiles: { destPath: string; caption?: string; index: number }[] = []

    for (const ec of sorted) {
      const capture = captureMap.get(ec.captureId)
      if (!capture) {
        console.warn(`[export] capture not found: ${ec.captureId}`)
        continue
      }

      const absPath = resolveMediaPath(capture.path)
      if (!absPath) {
        console.warn(`[export] forbidden path for capture: ${ec.captureId}`)
        continue
      }

      let processedBuf: Buffer
      try {
        processedBuf = await processCapture(absPath, ec, template)
      } catch (err) {
        console.warn(`[export] processing failed for ${capture.filename}:`, err)
        processedBuf = await readFile(absPath)
      }

      const destName = `${String(ec.order).padStart(3, '0')}-${capture.filename}`
      const destPath = join(outputDir, destName)
      await writeFile(destPath, processedBuf)

      processedFiles.push({ destPath, caption: ec.caption, index: ec.order })
    }

    if (processedFiles.length === 0) {
      return NextResponse.json({ error: 'No captures could be resolved' }, { status: 422 })
    }

    let finalOutputPath = outputDir
    let fileCount = processedFiles.length

    // ── Format-specific packaging ──────────────────────────────────────────

    if (format === 'zip') {
      // Produce a tar.gz (no archiver dep — use built-in zlib)
      const archivePath = join(outputDir, '..', `spectra-export-${Date.now()}.tar.gz`)
      await writeTarGz(
        outputDir,
        archivePath,
        processedFiles.map((f) => f.destPath)
      )
      finalOutputPath = archivePath
      fileCount = processedFiles.length
    }

    if (format === 'markdown' || template === 'blog') {
      const imagesDir = join(outputDir, 'images')
      await mkdir(imagesDir, { recursive: true })

      const mdLines: string[] = ['# Export\n']

      for (const { destPath, caption, index } of processedFiles) {
        const fname = basename(destPath)
        const imgDest = join(imagesDir, fname)
        await copyFile(destPath, imgDest)

        const captionText = caption ?? `Step ${index}`
        mdLines.push(`![${captionText}](images/${fname})\n`)
        mdLines.push(`*${captionText}*\n`)
      }

      const mdPath = join(outputDir, 'export.md')
      await writeFile(mdPath, mdLines.join('\n'), 'utf-8')
      fileCount = processedFiles.length + 1 // include the .md file
    }

    // Compute total size
    let totalSize = 0
    for (const { destPath } of processedFiles) {
      try {
        const s = await stat(destPath)
        totalSize += s.size
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ outputPath: finalOutputPath, fileCount, totalSize })
  } catch (err) {
    console.error('[POST /api/export]', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
