import { createServer } from 'node:http'
import { readFile, realpath, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { BrowserManager } from '../cdp/browser.js'
import { CdpConnection } from '../cdp/connection.js'
import { TargetDomain } from '../cdp/target.js'
import { requireFfmpeg } from '../media/ffmpeg.js'
import { regularFile, runProcess } from './story-process.js'

const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

/** Trusted authored HTML only. No wall-clock playback, remote assets or user profile. */
export async function renderHtmlFrames(options: {
  entry: string; width: number; height: number; fps: number; frames: number; seed: number;
  frameDir: string; signal?: AbortSignal; sampleFrames?: number[]; props?: Record<string, unknown>;
}): Promise<string[]> {
  const entry = await regularFile(options.entry)
  const root = await realpath(dirname(entry))
  const token = randomUUID()
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname)
      if (!path.startsWith(`/${token}/`)) throw new Error('Denied')
      const file = await realpath(join(root, path.slice(token.length + 2)))
      const rel = relative(root, file)
      if (rel === '..' || rel.startsWith(`..${sep}`) || !mime[extname(file)]) throw new Error('Denied')
      res.setHeader('Content-Type', mime[extname(file)])
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
      res.end(await readFile(file))
    } catch { res.writeHead(403); res.end('Asset outside composition or unsupported asset type') }
  })
  const browser = new BrowserManager()
  const conn = new CdpConnection({ timeoutMs: 5000 })
  const profile = await mkdtemp(join(tmpdir(), 'spectra-story-profile-'))
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as { port: number }
    const origin = `http://127.0.0.1:${address.port}`
    const prefix = `${origin}/${token}/`
    await conn.connect(await browser.launch({ headless: true, port: 0, userDataDir: profile, debuggerTimeoutMs: 15000 }))
    const targets = new TargetDomain(conn)
    const target = await targets.createPage('about:blank')
    const session = await targets.attach(target)
    const send = <T = unknown>(method: string, params?: Record<string, unknown>) => conn.send<T>(method, params, session)
    conn.on('Fetch.requestPaused', event => {
      const request = event as { requestId: string; request: { url: string } }
      void send(request.request.url.startsWith(prefix) ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: request.requestId, ...(request.request.url.startsWith(prefix) ? {} : { errorReason: 'BlockedByClient' }),
      }).catch(() => {})
    })
    await send('Page.enable')
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false })
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      let time = 0, state = ${options.seed >>> 0};
      const RealDate = Date;
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } };
      Object.defineProperty(performance, 'now', { value: () => time });
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      window.__spectraSeek = ms => { time = ms; state = (${options.seed >>> 0} ^ Math.round(ms * 1000)) >>> 0; };
    })();` })
    async function evaluate(expression: string) {
      const result = await send<{ exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    let loadedHandler: (() => void) | undefined
    let loadTimer: ReturnType<typeof setTimeout> | undefined
    const loaded = new Promise<void>((resolve, reject) => {
      loadedHandler = () => { clearTimeout(loadTimer); resolve() }
      conn.on('Page.loadEventFired', loadedHandler)
      loadTimer = setTimeout(() => reject(new Error('HTML load timed out')), 5000)
    })
    try {
      await send('Page.navigate', { url: prefix + encodeURIComponent(relative(root, entry)) })
      await loaded
    } finally {
      clearTimeout(loadTimer)
      if (loadedHandler) conn.off('Page.loadEventFired', loadedHandler)
    }
    // Navigation completion and fonts are event-based, not a guessed sleep.
    await evaluate(`new Promise((resolve) => document.readyState === 'complete' ? resolve() : window.addEventListener('load', resolve, {once:true})).then(() => document.fonts.ready).then(() => { if(typeof window.renderFrame !== 'function') throw new Error('HTML must define window.renderFrame(ms)'); })`)
    await mkdir(options.frameDir, { recursive: true })
    async function capture(frame: number) {
      options.signal?.throwIfAborted()
      if (frame < 0 || frame >= options.frames) throw new Error('Frame outside scene')
      const ms = frame * 1000 / options.fps
      await evaluate(`(async () => { window.__spectraSeek(${ms}); await window.renderFrame(${ms}, ${JSON.stringify({ width: options.width, height: options.height, props: options.props ?? {} })}); for(const a of document.getAnimations()){a.pause(); a.currentTime=${ms};} await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`)
      const screenshot = await send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      return Buffer.from(screenshot.data, 'base64')
    }
    // Catch common stateful renderers before encoding: seek out of order and repeat.
    const first = await capture(0)
    await capture(options.frames - 1)
    const repeated = await capture(0)
    const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
    if (digest(first) !== digest(repeated)) {
      const a = join(options.frameDir, 'seek-first.png'), b = join(options.frameDir, 'seek-repeated.png')
      await writeFile(a, first); await writeFile(b, repeated)
      // Chrome dithers gradients by one 8-bit level across compositor passes.
      // Compare every RGB byte, allowing only that bounded raster noise.
      let changed = false
      await runProcess(requireFfmpeg(), ['-v', 'error', '-i', a, '-i', b, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=difference,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], options.signal, 0, chunk => { for (const byte of chunk) if (byte > 1) changed = true })
      if (changed) throw new Error('renderFrame is not seekable: frame zero changed after seeking to the end')
      await rm(a); await rm(b)
    }
    const files: string[] = []
    for (const [index, frame] of (options.sampleFrames ?? Array.from({ length: options.frames }, (_, i) => i)).entries()) {
      const pixels = await capture(frame)
      const file = join(options.frameDir, `${String(options.sampleFrames ? index : frame).padStart(6, '0')}.png`)
      await writeFile(file, pixels)
      files.push(file)
    }
    return files
  } finally {
    await conn.close()
    await browser.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    // Chrome may finish exiting just after close(); retry transient file handles.
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
