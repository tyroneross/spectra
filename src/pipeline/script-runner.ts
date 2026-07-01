import type { DemoScript, Beat } from './script.js'
import type { CdpDriver } from '../cdp/driver.js'
import { CdpConnection } from '../cdp/connection.js'
import { RuntimeDomain } from '../cdp/runtime.js'
import { InputDomain } from '../cdp/input.js'

/** The kinds a beat action can carry. */
export type ScriptActionKind = NonNullable<Beat['action']>['kind']

/** One log entry per executed beat action, in run order. */
export interface BeatActionLog {
  beatId: string
  kind: ScriptActionKind
  ok: boolean
  detail: string
}

export interface RunDemoScriptOptions {
  /**
   * WebSocket debugger URL of an already-open CDP page target to drive.
   * Mutually exclusive with `driver` — one of the two is required.
   */
  cdpUrl?: string
  /**
   * An existing CdpDriver whose page will be driven. Its connection is
   * reused (never closed here); the caller owns its lifecycle.
   */
  driver?: CdpDriver
  /**
   * Fast-forward the run clock to this offset (ms). A beat at `startMs`
   * waits `startMs - startAtMs`; beats already past it fire immediately.
   */
  startAtMs?: number
}

/** Resolved low-level execution context the runner drives. */
interface RunnerContext {
  runtime: RuntimeDomain
  input: InputDomain
  conn: CdpConnection
  sessionId?: string
  /** Set when the runner opened the connection itself and must close it. */
  ownedConnection: CdpConnection | null
}

const SEARCH_SELECTOR =
  'input[type="search"], input[type="text"], [role="searchbox"], [role="search"] input, input:not([type=hidden])'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

async function resolveContext(opts: RunDemoScriptOptions): Promise<RunnerContext> {
  if (opts.driver) {
    const { conn, sessionId } = opts.driver.getConnection()
    const sid = sessionId ?? undefined
    return {
      runtime: new RuntimeDomain(conn, sid),
      input: new InputDomain(conn, sid),
      conn,
      sessionId: sid,
      ownedConnection: null,
    }
  }
  if (opts.cdpUrl) {
    const conn = new CdpConnection()
    await conn.connect(opts.cdpUrl)
    // A page-level target ws URL takes commands directly — no session id.
    return {
      runtime: new RuntimeDomain(conn, undefined),
      input: new InputDomain(conn, undefined),
      conn,
      sessionId: undefined,
      ownedConnection: conn,
    }
  }
  throw new Error('runDemoScript requires either opts.driver or opts.cdpUrl')
}

/** Locate an element center by target text or a data-* attribute. */
async function locateTarget(
  runtime: RuntimeDomain,
  target: string,
): Promise<{ x: number; y: number; label: string } | null> {
  const expr = `(function(){
    var t = ${jsString(target)};
    function center(el){
      if(!el) return null;
      var r = el.getBoundingClientRect();
      if(r.width===0 && r.height===0) return null;
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
               label: (el.getAttribute('data-nav')||el.textContent||el.tagName||'').trim().slice(0,60) };
    }
    // 1. Data attributes commonly used for nav/targets.
    var attrs = ['data-nav','data-target','data-testid','data-action','data-tab','aria-label','name','id'];
    for (var i=0;i<attrs.length;i++){
      var el = document.querySelector('['+attrs[i]+'="'+CSS.escape(t)+'"]');
      var c = center(el);
      if(c) return c;
    }
    // 2. Visible text match (exact, then contains) on interactive elements.
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll('a,button,[role=link],[role=button],[role=tab],[role=menuitem],nav *,li'));
    var lc = t.toLowerCase();
    for (var j=0;j<nodes.length;j++){
      if((nodes[j].textContent||'').trim().toLowerCase() === lc){ var e=center(nodes[j]); if(e) return e; }
    }
    for (var k=0;k<nodes.length;k++){
      if((nodes[k].textContent||'').trim().toLowerCase().indexOf(lc) !== -1){ var f=center(nodes[k]); if(f) return f; }
    }
    return null;
  })()`
  const result = (await runtime.evaluate(expr)) as
    | { x: number; y: number; label: string }
    | null
  return result ?? null
}

async function runSearch(ctx: RunnerContext, value: string): Promise<{ ok: boolean; detail: string }> {
  // Focus the search field and capture its center for a real click-to-focus.
  const located = (await ctx.runtime.evaluate(`(function(){
    var el = document.querySelector(${jsString(SEARCH_SELECTOR)});
    if(!el) return null;
    el.focus();
    try { el.value = ''; } catch(e){}
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
             id: el.id || el.tagName };
  })()`)) as { x: number; y: number; id: string } | null

  if (!located) return { ok: false, detail: 'search input not found' }

  // Real click to focus, then real keystrokes through the Input domain.
  await ctx.input.click(located.x, located.y)
  await ctx.input.type(value)
  // Dispatch Enter as real key events.
  await ctx.conn.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r' }, ctx.sessionId)
  await ctx.conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, ctx.sessionId)

  // Verify the value landed; if real typing didn't stick, set it + fire input.
  const readback = (await ctx.runtime.evaluate(`(function(){
    var el = document.querySelector(${jsString(SEARCH_SELECTOR)});
    return el ? String(el.value) : null;
  })()`)) as string | null

  if (readback !== value) {
    await ctx.runtime.evaluate(`(function(){
      var el = document.querySelector(${jsString(SEARCH_SELECTOR)});
      if(!el) return;
      el.value = ${jsString(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    return { ok: true, detail: `typed "${value}" into ${located.id} (via value+input event fallback)` }
  }
  return { ok: true, detail: `typed "${value}" into ${located.id}` }
}

async function runClick(ctx: RunnerContext, target: string): Promise<{ ok: boolean; detail: string }> {
  const hit = await locateTarget(ctx.runtime, target)
  if (!hit) return { ok: false, detail: `target "${target}" not found` }
  await ctx.input.click(hit.x, hit.y)
  return { ok: true, detail: `clicked "${hit.label}" at (${hit.x},${hit.y})` }
}

async function runScroll(ctx: RunnerContext): Promise<{ ok: boolean; detail: string }> {
  // Real mouse-wheel scroll near the viewport center.
  const size = (await ctx.runtime.evaluate(
    `({ w: window.innerWidth, h: window.innerHeight, before: window.scrollY })`,
  )) as { w: number; h: number; before: number }
  const cx = Math.max(1, Math.round(size.w / 2))
  const cy = Math.max(1, Math.round(size.h / 2))
  await ctx.input.scroll(cx, cy, 0, 600)
  // The document's 'scroll' event is dispatched asynchronously — yield the
  // event loop so any scroll handler has run before we read the position back.
  await sleep(60)

  let after = (await ctx.runtime.evaluate('window.scrollY')) as number
  if (!(after > (size.before ?? 0))) {
    // Wheel didn't move the document (headless quirk) — fall back to a real
    // programmatic scroll, which still fires the page's scroll handler.
    await ctx.runtime.evaluate('window.scrollBy(0, 600)')
    await sleep(60)
    after = (await ctx.runtime.evaluate('window.scrollY')) as number
    return { ok: after > 0, detail: `scrolled to y=${after} (via scrollBy fallback)` }
  }
  return { ok: true, detail: `scrolled to y=${after}` }
}

/**
 * Execute a DemoScript's beat actions against a live browser page via the
 * existing CDP client. Beats run in order; each action waits for its
 * `startMs` (relative to run start, offset by `startAtMs`) before firing.
 * Missing elements are logged (ok:false) and never throw the run.
 */
export async function runDemoScript(
  script: DemoScript,
  opts: RunDemoScriptOptions,
): Promise<BeatActionLog[]> {
  const startAtMs = opts.startAtMs ?? 0
  const ctx = await resolveContext(opts)
  const log: BeatActionLog[] = []

  // Anchor the clock so a beat at `startMs` fires at (startMs - startAtMs).
  const clockStart = Date.now() - startAtMs

  try {
    for (const beat of script.beats) {
      const action = beat.action
      if (!action) continue

      const waitMs = beat.startMs - (Date.now() - clockStart)
      if (waitMs > 0) await sleep(waitMs)

      try {
        let result: { ok: boolean; detail: string }
        switch (action.kind) {
          case 'search':
            result = await runSearch(ctx, action.value ?? '')
            break
          case 'navigate':
          case 'click':
            result = action.target
              ? await runClick(ctx, action.target)
              : { ok: false, detail: `${action.kind} requires a target` }
            break
          case 'scroll':
            result = await runScroll(ctx)
            break
          case 'hold':
            result = { ok: true, detail: 'held' }
            break
          default:
            result = { ok: false, detail: `unknown action kind: ${String(action.kind)}` }
        }
        log.push({ beatId: beat.id, kind: action.kind, ok: result.ok, detail: result.detail })
      } catch (err) {
        log.push({
          beatId: beat.id,
          kind: action.kind,
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } finally {
    if (ctx.ownedConnection) {
      await ctx.ownedConnection.close().catch(() => {})
    }
  }

  return log
}
