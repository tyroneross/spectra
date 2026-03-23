import { describe, it, expect } from 'vitest'
import * as zlib from 'node:zlib'
import {
  decodePng,
  encodePng,
  cropImage,
  resizeNearest,
  toGrayscale,
  type RawImage,
} from '../../src/media/png.js'

// ─── PNG Builder ─────────────────────────────────────────────
// Builds a minimal valid PNG buffer from raw scanline data (with filter bytes).
// rawRows: array of Uint8Array, each row is [filterByte, ...pixelData]
// colorType: 2 = RGB, 6 = RGBA

function buildPngBuffer(
  width: number,
  height: number,
  colorType: 2 | 6,
  rawRows: Uint8Array[]
): Buffer {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  function uint32BE(n: number): Buffer {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n >>> 0, 0)
    return b
  }

  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, 'ascii')
    const len = uint32BE(data.length)
    const crcInput = Buffer.concat([typeBytes, data])
    const crcVal = zlib.crc32(crcInput)
    const crcBuf = uint32BE(crcVal)
    return Buffer.concat([len, typeBytes, data, crcBuf])
  }

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8          // bit depth
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Concatenate all rows and deflate
  const totalLen = rawRows.reduce((s, r) => s + r.length, 0)
  const rawData = Buffer.alloc(totalLen)
  let off = 0
  for (const row of rawRows) {
    rawData.set(row, off)
    off += row.length
  }
  const compressed = zlib.deflateSync(rawData)

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Make a RawImage filled with a single RGBA color
function solidImage(width: number, height: number, r: number, g: number, b: number, a = 255): RawImage {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  return { width, height, data }
}

// ─── Tests ───────────────────────────────────────────────────

describe('png encode/decode', () => {
  it('roundtrip: encode then decode yields identical pixels', () => {
    // 4x4 checkerboard: alternating red and blue RGBA pixels
    const width = 4
    const height = 4
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      if (i % 2 === 0) {
        data[i * 4 + 0] = 255; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255
      } else {
        data[i * 4 + 0] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 255; data[i * 4 + 3] = 200
      }
    }
    const original: RawImage = { width, height, data }

    const encoded = encodePng(original)
    const decoded = decodePng(encoded)

    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.data.length).toBe(data.length)
    for (let i = 0; i < data.length; i++) {
      expect(decoded.data[i]).toBe(data[i])
    }
  })

  it('decode known PNG: 2x2 red pixels (RGBA)', () => {
    // Build a 2x2 PNG with solid red (255,0,0,255) using filter=0 (None)
    const width = 2
    const height = 2
    const rows: Uint8Array[] = []
    for (let y = 0; y < height; y++) {
      // filter byte 0 + RGBA * width
      const row = new Uint8Array(1 + width * 4)
      row[0] = 0 // filter: None
      for (let x = 0; x < width; x++) {
        row[1 + x * 4 + 0] = 255
        row[1 + x * 4 + 1] = 0
        row[1 + x * 4 + 2] = 0
        row[1 + x * 4 + 3] = 255
      }
      rows.push(row)
    }

    const png = buildPngBuffer(width, height, 6, rows)
    const img = decodePng(png)

    expect(img.width).toBe(2)
    expect(img.height).toBe(2)
    for (let i = 0; i < 4; i++) {
      expect(img.data[i * 4 + 0]).toBe(255) // R
      expect(img.data[i * 4 + 1]).toBe(0)   // G
      expect(img.data[i * 4 + 2]).toBe(0)   // B
      expect(img.data[i * 4 + 3]).toBe(255) // A
    }
  })

  it('crop: 10x10 image, crop 5x5 at (2,3)', () => {
    // Fill a 10x10 image: pixel at (x,y) = (x, y, 0, 255)
    const width = 10
    const height = 10
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        data[i + 0] = x
        data[i + 1] = y
        data[i + 2] = 0
        data[i + 3] = 255
      }
    }
    const img: RawImage = { width, height, data }
    const cropped = cropImage(img, 2, 3, 5, 5)

    expect(cropped.width).toBe(5)
    expect(cropped.height).toBe(5)

    // Verify pixel at crop (0,0) = original (2,3)
    expect(cropped.data[0]).toBe(2)
    expect(cropped.data[1]).toBe(3)

    // Verify pixel at crop (4,4) = original (6,7)
    const idx = (4 * 5 + 4) * 4
    expect(cropped.data[idx + 0]).toBe(6)
    expect(cropped.data[idx + 1]).toBe(7)
  })

  it('resize: 100x100 -> 9x8 produces correct dimensions', () => {
    const img = solidImage(100, 100, 128, 64, 32)
    const resized = resizeNearest(img, 9, 8)
    expect(resized.width).toBe(9)
    expect(resized.height).toBe(8)
    expect(resized.data.length).toBe(9 * 8 * 4)
  })

  it('grayscale: correct formula per pixel', () => {
    const data = new Uint8Array(4)
    data[0] = 100 // R
    data[1] = 150 // G
    data[2] = 200 // B
    data[3] = 255 // A
    const img: RawImage = { width: 1, height: 1, data }
    const gray = toGrayscale(img)
    const expected = Math.round(100 * 0.299 + 150 * 0.587 + 200 * 0.114)
    expect(gray[0]).toBe(expected)
  })

  it('filter reconstruction: Sub filter (filter byte = 1)', () => {
    // Build a 3x1 image with Sub filter.
    // Each channel value is absolute, but encoded as delta from left pixel.
    // We'll encode pixel values [10,20,30,255], [20,40,60,255], [30,60,90,255]
    // Sub-filtered row values: first pixel as-is, subsequent = value - left
    // raw[0] for px0 = 10,20,30,255
    // raw[1] for px1 = 20-10=10, 40-20=20, 60-30=30, 255-255=0
    // raw[2] for px2 = 30-20=10, 60-40=20, 90-60=30, 255-255=0
    const width = 3
    const height = 1
    const row = new Uint8Array(1 + width * 4)
    row[0] = 1 // Sub filter
    // px0
    row[1] = 10; row[2] = 20; row[3] = 30; row[4] = 255
    // px1 (delta from px0)
    row[5] = 10; row[6] = 20; row[7] = 30; row[8] = 0
    // px2 (delta from px1)
    row[9] = 10; row[10] = 20; row[11] = 30; row[12] = 0

    const png = buildPngBuffer(width, height, 6, [row])
    const img = decodePng(png)

    expect(img.data[0]).toBe(10);  expect(img.data[1]).toBe(20);  expect(img.data[2]).toBe(30);  expect(img.data[3]).toBe(255)
    expect(img.data[4]).toBe(20);  expect(img.data[5]).toBe(40);  expect(img.data[6]).toBe(60);  expect(img.data[7]).toBe(255)
    expect(img.data[8]).toBe(30);  expect(img.data[9]).toBe(60);  expect(img.data[10]).toBe(90); expect(img.data[11]).toBe(255)
  })

  it('RGB support (color type 2): decode adds alpha=255', () => {
    const width = 2
    const height = 2
    const rows: Uint8Array[] = []
    for (let y = 0; y < height; y++) {
      // filter byte 0 + RGB * width (no alpha)
      const row = new Uint8Array(1 + width * 3)
      row[0] = 0 // filter: None
      for (let x = 0; x < width; x++) {
        row[1 + x * 3 + 0] = 200 // R
        row[1 + x * 3 + 1] = 100 // G
        row[1 + x * 3 + 2] = 50  // B
      }
      rows.push(row)
    }

    const png = buildPngBuffer(width, height, 2, rows)
    const img = decodePng(png)

    expect(img.width).toBe(2)
    expect(img.height).toBe(2)
    // Every pixel should have A=255 added
    for (let i = 0; i < 4; i++) {
      expect(img.data[i * 4 + 0]).toBe(200)
      expect(img.data[i * 4 + 1]).toBe(100)
      expect(img.data[i * 4 + 2]).toBe(50)
      expect(img.data[i * 4 + 3]).toBe(255)
    }
  })

  it('invalid PNG: throws on non-PNG buffer', () => {
    const buf = Buffer.from('not a png buffer at all')
    expect(() => decodePng(buf)).toThrow('Invalid PNG signature')
  })

  it('edge case: 1x1 image roundtrip', () => {
    const data = new Uint8Array([77, 88, 99, 200])
    const img: RawImage = { width: 1, height: 1, data }
    const decoded = decodePng(encodePng(img))
    expect(decoded.width).toBe(1)
    expect(decoded.height).toBe(1)
    expect(decoded.data[0]).toBe(77)
    expect(decoded.data[1]).toBe(88)
    expect(decoded.data[2]).toBe(99)
    expect(decoded.data[3]).toBe(200)
  })

  it('edge case: crop to full size', () => {
    const img = solidImage(5, 5, 10, 20, 30)
    const cropped = cropImage(img, 0, 0, 5, 5)
    expect(cropped.width).toBe(5)
    expect(cropped.height).toBe(5)
    expect(cropped.data).toEqual(img.data)
  })

  it('edge case: resize to same size', () => {
    const img = solidImage(4, 4, 50, 100, 150)
    const resized = resizeNearest(img, 4, 4)
    expect(resized.width).toBe(4)
    expect(resized.height).toBe(4)
    expect(resized.data).toEqual(img.data)
  })
})
