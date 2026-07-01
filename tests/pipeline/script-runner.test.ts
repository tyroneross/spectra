import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findChrome } from '../../src/cdp/browser.js'
import { CdpDriver } from '../../src/cdp/driver.js'
import { RuntimeDomain } from '../../src/cdp/runtime.js'
import { runDemoScript } from '../../src/pipeline/script-runner.js'
import type { DemoScript } from '../../src/pipeline/script.js'

// Same structure as the shared abc2/testpage.html: a search input whose
// `input` handler records window.__state.search, nav links (data-nav) whose
// onclick sets window.__state.panel, and a scroll handler recording scrollY.
const TEST_PAGE_HTML = `<!doctype html><html><head><title>Demo Target</title></head><body>
<input id="q" type="search" placeholder="Search"/>
<nav><a href="#" data-nav="Graph" onclick="show('Graph');return false">Graph</a>
<a href="#" data-nav="Research" onclick="show('Research');return false">Research</a></nav>
<div id="panel">home</div>
<div data-nav="foo
bar" onclick="show('newline-hit')" style="width:10px;height:10px;">Y</div>
<div id="tall" style="height:3000px">scroll region</div>
<script>
window.__state={search:'',panel:'home',scrollY:0};
document.getElementById('q').addEventListener('input',e=>window.__state.search=e.target.value);
function show(n){document.getElementById('panel').textContent=n;window.__state.panel=n;}
window.addEventListener('scroll',()=>window.__state.scrollY=window.scrollY);
</script></body></html>`

// Gate on Chrome availability, mirroring the native CDP tests' describe.skipIf.
describe.skipIf(!findChrome())('runDemoScript (integration, real Chrome)', () => {
  let driver: CdpDriver
  let tmpDir: string
  let pageUrl: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spectra-script-runner-'))
    const htmlPath = join(tmpDir, 'testpage.html')
    writeFileSync(htmlPath, TEST_PAGE_HTML)
    pageUrl = pathToFileURL(htmlPath).href

    driver = new CdpDriver({ browser: { headless: true } })
    await driver.connect({ url: pageUrl })
  }, 30_000)

  afterAll(async () => {
    await driver?.close().catch(() => {})
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('executes search, navigate and scroll beats against the live page', async () => {
    const script: DemoScript = {
      title: 'runner-integration',
      beats: [
        { id: 'search', startMs: 0, endMs: 100, action: { kind: 'search', value: 'hello agents' } },
        { id: 'graph', startMs: 30, endMs: 100, action: { kind: 'navigate', target: 'Graph' } },
        { id: 'scroll', startMs: 60, endMs: 100, action: { kind: 'scroll' } },
      ],
    }

    const log = await runDemoScript(script, { driver })

    // Every beat action executed successfully and in order.
    expect(log.map((entry) => entry.beatId)).toEqual(['search', 'graph', 'scroll'])
    expect(log.every((entry) => entry.ok)).toBe(true)

    // Read the page state the actions produced, via the CDP runtime domain.
    const { conn, sessionId } = driver.getConnection()
    const runtime = new RuntimeDomain(conn, sessionId ?? undefined)
    const state = (await runtime.evaluate('JSON.stringify(window.__state)')) as string
    const parsed = JSON.parse(state) as { search: string; panel: string; scrollY: number }

    expect(parsed.search).toBe('hello agents')
    expect(parsed.panel).toBe('Graph')
    expect(parsed.scrollY).toBeGreaterThan(0)
  }, 30_000)

  it('logs ok:false for a target that does not exist, without throwing', async () => {
    const script: DemoScript = {
      beats: [{ id: 'missing', startMs: 0, endMs: 50, action: { kind: 'click', target: 'NoSuchThing' } }],
    }
    const log = await runDemoScript(script, { driver })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ beatId: 'missing', kind: 'click', ok: false })
  }, 30_000)

  // f4: locateTarget used to build the data-attr selector as
  // `'['+attr+'='+JSON.stringify(t)+']'` — JSON string-escaping, not CSS
  // attribute-selector string-escaping. For quote/backslash content the two
  // escaping schemes happen to coincide in a real CSS tokenizer (both use a
  // bare `\<char>` escape), so this does not throw — the run must still
  // continue and simply log ok:false (target not found).
  it('logs ok:false (never throws) for a target containing a double-quote', async () => {
    const script: DemoScript = {
      beats: [{ id: 'quoted', startMs: 0, endMs: 50, action: { kind: 'click', target: 'she said "hi" to me' } }],
    }
    const log = await runDemoScript(script, { driver })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ beatId: 'quoted', kind: 'click', ok: false })
  }, 30_000)

  // f4 (discriminating case): JSON escapes a literal newline as the two
  // characters `\n`; a CSS string tokenizer reads `\` + non-hex-digit `n` as
  // the LITERAL character 'n' (not a newline), so the old selector silently
  // matched the wrong (non-existent) value and never found the element —
  // no throw, just a false negative. CSS.escape() emits the CSS hex escape
  // `\a ` for a control character, which round-trips correctly. This is a
  // real old-vs-new behavior difference, confirmed by running both selector-
  // building strategies against a live element in headless Chrome.
  it('finds a data-nav target containing an embedded newline (CSS.escape round-trips control chars; JSON quoting did not)', async () => {
    const { conn, sessionId } = driver.getConnection()
    const runtime = new RuntimeDomain(conn, sessionId ?? undefined)
    // Earlier tests in this shared-page describe block scroll the document;
    // reset so the target div's getBoundingClientRect() is viewport-visible.
    await runtime.evaluate('window.scrollTo(0,0)')

    const script: DemoScript = {
      beats: [{ id: 'newline-target', startMs: 0, endMs: 50, action: { kind: 'click', target: 'foo\nbar' } }],
    }
    const log = await runDemoScript(script, { driver })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ beatId: 'newline-target', kind: 'click', ok: true })

    const panel = (await runtime.evaluate('window.__state.panel')) as string
    expect(panel).toBe('newline-hit')
  }, 30_000)
})
