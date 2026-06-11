import { describe, expect, it } from 'vitest'
import { resolveExportOutputDir, validateExportRequestBody } from '../../lib/export-validation.js'

describe('validateExportRequestBody', () => {
  it('accepts a minimal valid production export request', () => {
    const result = validateExportRequestBody({
      format: 'production',
      template: 'docs',
      captures: [
        { captureId: 'abc123', order: 1, caption: 'First screen' },
      ],
    })

    expect(result).toEqual({
      ok: true,
      value: {
        format: 'production',
        template: 'docs',
        captures: [
          { captureId: 'abc123', order: 1, caption: 'First screen' },
        ],
      },
    })
  })

  it('rejects unsupported formats and templates', () => {
    expect(validateExportRequestBody({
      format: 'pdf',
      captures: [{ captureId: 'abc123', order: 1 }],
    })).toMatchObject({ ok: false, error: 'Unsupported export format' })

    expect(validateExportRequestBody({
      format: 'markdown',
      template: 'deck',
      captures: [{ captureId: 'abc123', order: 1 }],
    })).toMatchObject({ ok: false, error: 'Unsupported export template' })
  })

  it('rejects missing captures and unsafe capture ordering', () => {
    expect(validateExportRequestBody({
      format: 'markdown',
      captures: [],
    })).toMatchObject({ ok: false, error: 'No captures specified' })

    expect(validateExportRequestBody({
      format: 'markdown',
      captures: [{ captureId: 'abc123', order: '../../outside' }],
    })).toMatchObject({ ok: false, error: 'captures[0].order must be a positive integer' })

    expect(validateExportRequestBody({
      format: 'markdown',
      captures: [{ captureId: 'abc123', order: 1.5 }],
    })).toMatchObject({ ok: false, error: 'captures[0].order must be a positive integer' })
  })

  it('rejects invalid crop and highlight dimensions', () => {
    expect(validateExportRequestBody({
      format: 'individual',
      captures: [
        { captureId: 'abc123', order: 1, crop: { x: 0, y: 0, width: -10, height: 20 } },
      ],
    })).toMatchObject({
      ok: false,
      error: 'captures[0].crop must use non-negative coordinates and positive dimensions',
    })

    expect(validateExportRequestBody({
      format: 'individual',
      captures: [
        { captureId: 'abc123', order: 1, highlights: [{ x: 0, y: 0, width: 10001, height: 20 }] },
      ],
    })).toMatchObject({
      ok: false,
      error: 'captures[0].highlights[0] dimensions are too large',
    })
  })
})

describe('resolveExportOutputDir', () => {
  it('uses the default output directory when the request omits outputDir', () => {
    expect(resolveExportOutputDir(undefined, '/tmp/spectra-export', ['/repo/spectra', '/tmp'])).toEqual({
      ok: true,
      path: '/tmp/spectra-export',
    })
  })

  it('resolves relative output directories under the project root', () => {
    expect(resolveExportOutputDir('exports/docs', '/tmp/spectra-export', ['/repo/spectra', '/tmp'])).toEqual({
      ok: true,
      path: '/repo/spectra/exports/docs',
    })
  })

  it('rejects custom output directories outside allowed roots', () => {
    expect(resolveExportOutputDir('/var/private/out', '/tmp/spectra-export', ['/repo/spectra', '/tmp'])).toEqual({
      ok: false,
      error: 'outputDir must be inside the project or system temporary directory',
    })
  })
})
