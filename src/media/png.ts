import * as zlib from 'node:zlib'

// ─── Types ───────────────────────────────────────────────────

export interface RawImage {
  width: number
  height: number
  data: Uint8Array // RGBA, 4 bytes per pixel
}

// ─── Constants ───────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

// ─── Helpers ─────────────────────────────────────────────────

function readUint32BE(buf: Buffer | Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>> 0
  )
}

function writeUint32BE(buf: Buffer, value: number, offset: number): void {
  buf.writeUInt32BE(value >>> 0, offset)
}

function buildChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  writeUint32BE(length, data.length, 0)

  const crcInput = Buffer.concat([typeBytes, data])
  const crcValue = zlib.crc32(crcInput)
  const crcBuf = Buffer.alloc(4)
  writeUint32BE(crcBuf, crcValue, 0)

  return Buffer.concat([length, typeBytes, data, crcBuf])
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

// ─── Decode ──────────────────────────────────────────────────

export function decodePng(buffer: Buffer): RawImage {
  // 1. Validate signature
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG signature')
    }
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks: Buffer[] = []

  // 2. Parse chunks
  while (offset < buffer.length) {
    const dataLength = readUint32BE(buffer, offset)
    offset += 4

    const type = buffer.toString('ascii', offset, offset + 4)
    offset += 4

    const data = buffer.slice(offset, offset + dataLength)
    offset += dataLength

    // skip CRC (4 bytes)
    offset += 4

    if (type === 'IHDR') {
      // 3. Extract IHDR fields
      width = readUint32BE(data, 0)
      height = readUint32BE(data, 4)
      bitDepth = data[8]
      colorType = data[9]

      if (bitDepth !== 8) {
        throw new Error(`Unsupported bit depth: ${bitDepth} (only 8 is supported)`)
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(
          `Unsupported color type: ${colorType} (only RGB=2 and RGBA=6 are supported)`
        )
      }
    } else if (type === 'IDAT') {
      // 4. Collect IDAT data
      idatChunks.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
  }

  if (width === 0 || height === 0) {
    throw new Error('Missing or invalid IHDR chunk')
  }

  // 5. Inflate
  const compressed = Buffer.concat(idatChunks)
  const decompressed = zlib.inflateSync(compressed)

  const bytesPerPixel = colorType === 6 ? 4 : 3
  const stride = width * bytesPerPixel

  // 6. Reconstruct scanlines
  // output is always RGBA (4 bytes per pixel)
  const output = new Uint8Array(width * height * 4)

  // prevRecon tracks the previous reconstructed row in source color space
  let prevRecon = new Uint8Array(stride) // all zeros for row 0

  let srcOffset = 0
  for (let y = 0; y < height; y++) {
    const filterByte = decompressed[srcOffset]
    srcOffset++

    const rawRow = decompressed.slice(srcOffset, srcOffset + stride)
    srcOffset += stride

    // 7. Apply filter reconstruction — produces recon in source color space
    const recon = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const raw = rawRow[x]
      const left = x >= bytesPerPixel ? recon[x - bytesPerPixel] : 0
      const above = prevRecon[x]
      const upperLeft = x >= bytesPerPixel ? prevRecon[x - bytesPerPixel] : 0

      let val: number
      switch (filterByte) {
        case 0: // None
          val = raw
          break
        case 1: // Sub
          val = (raw + left) & 0xff
          break
        case 2: // Up
          val = (raw + above) & 0xff
          break
        case 3: // Average
          val = (raw + Math.floor((left + above) / 2)) & 0xff
          break
        case 4: // Paeth
          val = (raw + paethPredictor(left, above, upperLeft)) & 0xff
          break
        default:
          throw new Error(`Unsupported filter type: ${filterByte}`)
      }
      recon[x] = val
    }

    // 8. Write to RGBA output (expand RGB -> RGBA if needed)
    const dstRowStart = y * width * 4
    if (colorType === 6) {
      // RGBA: copy directly
      for (let px = 0; px < width; px++) {
        output[dstRowStart + px * 4 + 0] = recon[px * 4 + 0]
        output[dstRowStart + px * 4 + 1] = recon[px * 4 + 1]
        output[dstRowStart + px * 4 + 2] = recon[px * 4 + 2]
        output[dstRowStart + px * 4 + 3] = recon[px * 4 + 3]
      }
    } else {
      // RGB: add alpha=255
      for (let px = 0; px < width; px++) {
        output[dstRowStart + px * 4 + 0] = recon[px * 3 + 0]
        output[dstRowStart + px * 4 + 1] = recon[px * 3 + 1]
        output[dstRowStart + px * 4 + 2] = recon[px * 3 + 2]
        output[dstRowStart + px * 4 + 3] = 255
      }
    }

    prevRecon = recon
  }

  return { width, height, data: output }
}

// ─── Encode ──────────────────────────────────────────────────

export function encodePng(image: RawImage): Buffer {
  const { width, height, data } = image

  // 1. Build IHDR chunk data
  const ihdrData = Buffer.alloc(13)
  writeUint32BE(ihdrData, width, 0)
  writeUint32BE(ihdrData, height, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 6  // color type: RGBA
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method

  // 2. Build raw scanlines: filter byte 1 (Sub) + filtered row data
  //    Sub filter: each byte = raw - left (wrapping at 0xff)
  //    Better compression than None for typical screenshots
  const rowSize = width * 4
  const rawScanlines = Buffer.alloc(height * (1 + rowSize))
  for (let y = 0; y < height; y++) {
    const destBase = y * (1 + rowSize)
    rawScanlines[destBase] = 1 // filter type: Sub
    const rowStart = y * rowSize
    for (let x = 0; x < rowSize; x++) {
      const raw = data[rowStart + x]
      const left = x >= 4 ? data[rowStart + x - 4] : 0
      rawScanlines[destBase + 1 + x] = (raw - left) & 0xff
    }
  }

  // 3. Deflate
  const compressed = zlib.deflateSync(rawScanlines)

  // 4-6. Build chunks and combine
  const sigBuf = Buffer.from(PNG_SIGNATURE)
  const ihdrChunk = buildChunk('IHDR', ihdrData)
  const idatChunk = buildChunk('IDAT', compressed)
  const iendChunk = buildChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([sigBuf, ihdrChunk, idatChunk, iendChunk])
}

// ─── Crop ────────────────────────────────────────────────────

export function cropImage(
  image: RawImage,
  x: number,
  y: number,
  w: number,
  h: number
): RawImage {
  const { width, height, data } = image

  // Clamp to bounds
  const x0 = Math.max(0, Math.min(x, width))
  const y0 = Math.max(0, Math.min(y, height))
  const x1 = Math.max(0, Math.min(x + w, width))
  const y1 = Math.max(0, Math.min(y + h, height))

  const cropW = x1 - x0
  const cropH = y1 - y0

  const output = new Uint8Array(cropW * cropH * 4)

  for (let row = 0; row < cropH; row++) {
    const srcRowStart = ((y0 + row) * width + x0) * 4
    const dstRowStart = row * cropW * 4
    output.set(data.slice(srcRowStart, srcRowStart + cropW * 4), dstRowStart)
  }

  return { width: cropW, height: cropH, data: output }
}

// ─── Resize ──────────────────────────────────────────────────

export function resizeNearest(
  image: RawImage,
  targetW: number,
  targetH: number
): RawImage {
  const { width: srcW, height: srcH, data } = image
  const output = new Uint8Array(targetW * targetH * 4)

  for (let ty = 0; ty < targetH; ty++) {
    const sy = Math.floor((ty * srcH) / targetH)
    for (let tx = 0; tx < targetW; tx++) {
      const sx = Math.floor((tx * srcW) / targetW)
      const srcIdx = (sy * srcW + sx) * 4
      const dstIdx = (ty * targetW + tx) * 4
      output[dstIdx + 0] = data[srcIdx + 0]
      output[dstIdx + 1] = data[srcIdx + 1]
      output[dstIdx + 2] = data[srcIdx + 2]
      output[dstIdx + 3] = data[srcIdx + 3]
    }
  }

  return { width: targetW, height: targetH, data: output }
}

// ─── Grayscale ───────────────────────────────────────────────

export function toGrayscale(image: RawImage): Uint8Array {
  const { width, height, data } = image
  const output = new Uint8Array(width * height)

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4 + 0]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    output[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
  }

  return output
}
