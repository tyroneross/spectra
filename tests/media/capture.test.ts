// tests/media/capture.test.ts
import { describe, it, expect, vi } from 'vitest'
import { detectFfmpeg } from '../../src/media/ffmpeg.js'
import { screenshot } from '../../src/media/capture.js'
import { encodePng, decodePng } from '../../src/media/png.js'
import type { Driver } from '../../src/core/types.js'
import type { Element } from '../../src/core/types.js'

// Build a minimal valid 4x4 RGBA PNG with known pixel colors
function makeTestPng(width: number, height: number): Buffer {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Top-left quadrant: red (255,0,0,255)
      // Top-right quadrant: green (0,255,0,255)
      // Bottom-left quadrant: blue (0,0,255,255)
      // Bottom-right quadrant: white (255,255,255,255)
      const halfW = Math.floor(width / 2)
      const halfH = Math.floor(height / 2)
      if (x < halfW && y < halfH) {
        data[i] = 255; data[i+1] = 0;   data[i+2] = 0;   data[i+3] = 255
      } else if (x >= halfW && y < halfH) {
        data[i] = 0;   data[i+1] = 255; data[i+2] = 0;   data[i+3] = 255
      } else if (x < halfW && y >= halfH) {
        data[i] = 0;   data[i+1] = 0;   data[i+2] = 255; data[i+3] = 255
      } else {
        data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255
      }
    }
  }
  return encodePng({ width, height, data })
}

function mockDriver(screenshotBuf: Buffer): Driver {
  return {
    connect: vi.fn(),
    snapshot: vi.fn(),
    act: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(screenshotBuf),
    close: vi.fn(),
    disconnect: vi.fn(),
  }
}

describe('ffmpeg', () => {
  it('detects ffmpeg presence', () => {
    const path = detectFfmpeg()
    // May be null if ffmpeg not installed — just verify it returns string or null
    expect(path === null || typeof path === 'string').toBe(true)
  })
})

describe('screenshot (capture)', () => {
  it('returns full screenshot buffer when no options given', async () => {
    const png = makeTestPng(8, 8)
    const driver = mockDriver(png)
    const result = await screenshot(driver, 'web')

    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.format).toBe('png')
    expect(result.bounds).toBeUndefined()
    expect(driver.screenshot).toHaveBeenCalledOnce()
  })

  it('returns full screenshot with explicit format option', async () => {
    const png = makeTestPng(8, 8)
    const driver = mockDriver(png)
    const result = await screenshot(driver, 'web', { format: 'jpeg' })

    expect(result.format).toBe('jpeg')
    expect(result.bounds).toBeUndefined()
  })

  it('crops to region when region option is provided', async () => {
    const png = makeTestPng(8, 8)
    const driver = mockDriver(png)
    // Crop top-left 4x4 quadrant
    const result = await screenshot(driver, 'web', { region: [0, 0, 4, 4] })

    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.format).toBe('png')
    expect(result.bounds).toEqual([0, 0, 4, 4])

    const decoded = decodePng(result.buffer)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    // All pixels in top-left quadrant should be red
    for (let i = 0; i < 4 * 4; i++) {
      expect(decoded.data[i * 4 + 0]).toBe(255) // R
      expect(decoded.data[i * 4 + 1]).toBe(0)   // G
      expect(decoded.data[i * 4 + 2]).toBe(0)   // B
    }
  })

  it('crops to element bounds when element option is provided', async () => {
    const png = makeTestPng(8, 8)
    const driver = mockDriver(png)

    const element: Element = {
      id: 'el-1',
      role: 'button',
      label: 'Click me',
      value: null,
      enabled: true,
      focused: false,
      actions: ['click'],
      // Bottom-right quadrant: x=4, y=4, w=4, h=4
      bounds: [4, 4, 4, 4],
      parent: null,
    }

    const result = await screenshot(driver, 'web', { element })

    expect(result.bounds).toEqual([4, 4, 4, 4])
    const decoded = decodePng(result.buffer)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    // All pixels in bottom-right quadrant should be white
    for (let i = 0; i < 4 * 4; i++) {
      expect(decoded.data[i * 4 + 0]).toBe(255) // R
      expect(decoded.data[i * 4 + 1]).toBe(255) // G
      expect(decoded.data[i * 4 + 2]).toBe(255) // B
    }
  })

  it('calls driver.screenshot once for element capture', async () => {
    const png = makeTestPng(8, 8)
    const driver = mockDriver(png)
    const element: Element = {
      id: 'el-2',
      role: 'image',
      label: '',
      value: null,
      enabled: true,
      focused: false,
      actions: [],
      bounds: [0, 4, 4, 4],
      parent: null,
    }

    await screenshot(driver, 'web', { element })
    expect(driver.screenshot).toHaveBeenCalledOnce()
  })
})
