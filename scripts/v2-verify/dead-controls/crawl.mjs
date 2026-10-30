// The Node half of the dead-control crawler: a breadth-first walk over UI states.
//
// A STATE is a replayable list of steps from a fresh load (`[]` = the page as it loads). For each
// state the crawler enumerates the controls that are NEW in it (not present in its parent state),
// clicks each one for real (Playwright pointer events, across the canvas origin split) and judges
// the click by its visible effect. A click that reveals new controls (a menu, a sheet, a tab) queues
// a child state, so submenus, row ⋯ menus, settings tabs and sheets are reached without a
// hand-kept list. Between clicks the state is restored: Escape, then — if the control set no
// longer matches — a fresh load and a replay of the steps.
//
// Never clicked: a destructive control inside a confirm (it is listed `skipped-destructive`); a
// first-level destructive control is clicked once, which must open that confirm.

import { PAGE_PROBE } from './page-probe.mjs';
import { judgeKey } from './resume.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESTRUCTIVE =
  /(delete|remove|trash|\bmove\b|discard|sign out|log ?out|revoke|reset|erase|wipe|forget|leave|uninstall|disconnect|unlink|restore|revert|roll ?back|empty|clear|overwrite|replace|buy|purchase|upgrade|subscribe|billing|checkout|pay\b|quit|close project)/i;
// Controls that would end the crawl or reach real services; the first click is still judged when
// it only opens a confirm (the matcher above), these are never clicked at all.
const NEVER = /(quit maude|send report|delete forever|delete permanently|empty trash)/i;
// "Move “Hero” down" / "Move … up" reorder a list inside a sheet (nothing is saved until Save): not destructive
const isDestructive = (name) => DESTRUCTIVE.test(name) && !/^move\b.*\b(up|down)\b/i.test(name);
const SETTLE_MS = Number(process.env.CRAWL_SETTLE_MS || 750);
const FAMILY_CAP = 2;
const OPTION_CAP = 12;

const isLoopback = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return true; // data:, blob:, about:
  }
};

export function tauriStub(homeSecret) {
  // the webview label the real shell gives the page: \`home\`, or \`p-<pid>\` for a project tab
  const label = homeSecret ? 'home' : 'p-crawl';
  return `(() => {
  const calls = (window.__crawlInvokes = []);
  const invoke = (cmd, args) => {
    calls.push(String(cmd));
    if (cmd === 'home_session') return Promise.resolve({ secret: ${JSON.stringify(homeSecret ?? '')} });
    return Promise.reject(new Error('crawl-tauri-stub: ' + cmd));
  };
  window.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: '${label}' }, currentWindow: { label: 'shell' } }, invoke, transformCallback: () => 0 };
  window.__TAURI__ = {
    core: { invoke },
    event: { listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() },
    window: {}, path: {}, app: {},
  };
})();`;
}

// The crawler's own red test (`--plant-dead`): a visible button in the shell that does nothing.
// `--plant-noise` adds what a real shell does around it: a status message in a far corner, re-announced every
// 200 ms. It is not the button's doing, so the button must still come out DEAD.
export const plantDeadScript = (noisy = false) => `(() => {
  if (window.top !== window) return;
  const noisy = ${noisy ? 'true' : 'false'};
  const add = () => {
    if (!document.body || document.querySelector('[data-testid="crawl-planted-dead"]')) return;
    const b = document.createElement('button');
    b.dataset.testid = 'crawl-planted-dead';
    b.textContent = 'Planted dead';
    b.style.cssText = 'position:fixed;left:50%;top:8px;z-index:2147483647';
    document.body.appendChild(b);
    if (noisy) {
      const region = document.createElement('footer');
      region.dataset.testid = 'crawl-noise-region';
      region.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483646';
      document.body.appendChild(region);
      let n = 0;
      setInterval(() => {
        const s = document.createElement('div');
        s.setAttribute('role', 'status');
        s.textContent = 'Saved ' + ++n;
        region.replaceChildren(s);
      }, 200);
    }
  };
  document.addEventListener('DOMContentLoaded', add);
  setInterval(add, 500);
})();`;
export const PLANT_DEAD = plantDeadScript(false);

/**
 * Which errors are the rig's, not a control's: the kind gets a parenthesised tag, and report.mjs's isRigError drops those.
 * Exported so a merge can re-tag shards that ran under older rules.
 */
export function tagErrorKind(kind, text) {
  if (
    /\)$/.test(kind) &&
    /\((native stub|blocked external|cloud offline|no hub|fixture media|server restarting|not signed in|canvas removed|fixed)/.test(
      kind
    )
  )
    return kind;
  if (/crawl-tauri-stub/.test(text)) kind = `${kind} (native stub)`;
  // the rig blocks every non-loopback request (web fonts …): its console line is the rig's, not the product's
  else if (/ERR_BLOCKED_BY_CLIENT/.test(text)) kind = `${kind} (blocked external)`;
  // the rig's cloud is a dead loopback port and nobody is signed in: a cloud route answering 401/502 is the rig
  else if (/ERR_CONNECTION_REFUSED/.test(text)) kind = `${kind} (server restarting)`;
  // the rig is signed in nowhere: GitHub's repo list answers 401
  else if (/\/_api\/github\//.test(text) && /401/.test(`${kind} ${text}`))
    kind = `${kind} (not signed in)`;
  // a click moved the OPEN canvas to the trash / renamed / moved it (the walk clicks every first-level destructive
  // control once): the frame's own late requests for that file answer 404
  else if (
    /404/.test(`${kind} ${text}`) &&
    /(\.design\/ui\/[^\s]+\.tsx|\/_api\/(asset-state|canvas-errors)\?canvas=|\[canvas-shell\] HTTP 404)/.test(
      text
    )
  )
    kind = `${kind} (canvas removed)`;
  // the fixture design system ships no components.json and its timeline clips name media it does not ship
  else if (
    /404/.test(`${kind} ${text}`) &&
    /(\/\.design\/system\/[^/\s]+\/components\.json|\/_api\/timeline-media\?key=)/.test(text)
  )
    kind = `${kind} (fixture media)`;
  // the tree is read while the server restarts under a reset
  else if (/failed to load tree/i.test(text) && /Failed to fetch/.test(text))
    kind = `${kind} (server restarting)`;
  // the fixture's video canvases name media files the fixture does not ship (assets/aaaa1111.mp4, song.mp3):
  // the server refuses them and the player throws — the rig's gap, not a control's
  else if (
    /\/assets\/[\w.-]+\.(mp4|mp3|webm|wav|m4a)/.test(text) ||
    /MediaPlaybackError|MediaError/.test(text)
  )
    kind = `${kind} (fixture media)`;
  // the hub-link state hands the shell a status message, but the rig's server has no hub: Resync / Download all
  // reach their real routes and the server answers 409 "not linked"
  else if (/\/_api\/sync\/(offline|resync)/.test(text) && /409/.test(`${kind} ${text}`))
    kind = `${kind} (no hub)`;
  // the Design system tab (SYSTEM_TAB) was asked about as if it were a canvas file: fixed in p8-sweep-advanced
  else if (/__system__/.test(text) && /(edit-instance|edit-scope)/.test(text))
    kind = `${kind} (fixed: Design system tab)`;
  else if (/\/_api\/cloud\//.test(text) && /(401|502|503|504)/.test(`${kind} ${text}`))
    kind = `${kind} (cloud offline)`;
  return kind;
}

export class Crawler {
  constructor({
    browser,
    mode,
    url,
    homeSecret,
    readySel,
    label,
    maxDepth = 4,
    maxStates = 600,
    budgetMs = 25 * 60_000,
    log = (m) => console.error(m),
    onResult = null,
    plantDead = false,
    plantNoise = false,
    reset = null,
  }) {
    Object.assign(this, {
      browser,
      mode,
      url,
      homeSecret,
      readySel,
      label,
      maxDepth,
      maxStates,
      budgetMs,
      log,
      onResult,
      plantDead,
      plantNoise,
      reset,
    });
    this.results = [];
    this.errors = [];
    this.context = null;
    this.page = null;
    this.current = '<load>';
    this.reqCount = 0;
    this.bgPaths = new Set();
    this.reqPaths = [];
    this.external = [];
    this.popups = [];
    this.clicked = new Map(); // keys already judged (in any state) → where — each control judged once
    this.queued = new Set();
    this.prefixFp = new Map(); // steps signature → the control set that state showed
    this.redone = []; // the stale states this run judged again
    this.statesDone = []; // the states this run entered (a state with nothing new to judge writes no row)
  }

  /** Continue from earlier shards (`planResume`): what they judged is a twin here, their child states are known. */
  resume({ judged, queued, seeds = [], redone = [] }) {
    this.seedNames = new Set(seeds); // a seed that is also a child of another seed is crawled once
    this.enteredSeeds = new Set();
    this.redone = redone.map((surface) => ({ mode: this.mode, surface }));
    for (const [k, where] of judged) if (!this.clicked.has(k)) this.clicked.set(k, where);
    for (const q of queued) this.queued.add(q);
  }

  async open() {
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
    // a clipboard read would otherwise wait on a permission prompt headless Chromium never answers
    await this.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    if (this.mode === 'tauri') await this.context.addInitScript(tauriStub(this.homeSecret));
    if (this.homeSecret)
      await this.context.addInitScript(
        `try { sessionStorage.setItem('maude-home-page-secret', ${JSON.stringify(this.homeSecret)}); } catch {}`
      );
    await this.context.addInitScript(PAGE_PROBE);
    if (this.plantDead) await this.context.addInitScript(plantDeadScript(this.plantNoise));
    await this.context.route('**/*', (route) => {
      const u = route.request().url();
      if (isLoopback(u)) return route.continue();
      this.external.push({ control: this.current, url: u });
      return route.abort('blockedbyclient');
    });
    this.page = await this.context.newPage();
    this.context.on('page', async (p) => {
      if (p === this.page) return;
      this.popups.push({ control: this.current, url: p.url() });
      await p.close().catch(() => {});
    });
    this.page.on('filechooser', (fc) => {
      this.popups.push({
        control: this.current,
        url: `file chooser${fc.isMultiple() ? ' (multiple)' : ''}`,
      });
    });
    this.page.on('dialog', (d) => {
      this.popups.push({
        control: this.current,
        url: `native ${d.type()}: ${d.message().slice(0, 80)}`,
      });
      d.dismiss().catch(() => {});
    });
    this.page.on('pageerror', (e) => this.err('pageerror', String(e.stack || e).slice(0, 900)));
    this.page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const loc = m.location();
      this.err(
        'console.error',
        `${m.text().slice(0, 900)}${loc?.url ? `\n    at ${loc.url}:${loc.lineNumber}` : ''}`
      );
    });
    this.page.on('request', (r) => {
      if (!isLoopback(r.url())) return;
      this.reqCount++;
      const p = new URL(r.url()).pathname;
      this.reqPaths.push(p);
    });
    this.page.on('response', (r) => {
      const u = r.url();
      if (!isLoopback(u) || r.status() < 400) return;
      const e = this.err(
        `http ${r.status()}`,
        `${r.request().method()} ${new URL(u).pathname}${new URL(u).search.slice(0, 80)}`
      );
      // p8-sweep-errors — the studio's own words for the refusal, on a second line (errors group by the first),
      // so a 4xx the crawl meets names its cause instead of needing a replay to find it
      r.text()
        .then((b) => {
          const said = String(b).replace(/\s+/g, ' ').trim().slice(0, 300);
          if (said) e.text += `\n  answer: ${said}`;
        })
        .catch(() => {});
    });
  }

  err(kind, text) {
    kind = tagErrorKind(kind, text);
    const e = { surface: this.label, mode: this.mode, control: this.current, kind, text };
    this.errors.push(e);
    return e;
  }

  async close() {
    await this.context?.close().catch(() => {});
  }

  frames() {
    return this.page.frames();
  }

  async evalAll(fn, arg) {
    const out = [];
    for (const f of this.frames()) {
      try {
        out.push({ frame: f, value: await f.evaluate(fn, arg) });
      } catch {
        /* detached / not ready */
      }
    }
    return out;
  }

  frameTag(f) {
    return f === this.page.mainFrame() ? 'shell' : 'canvas';
  }

  async controls() {
    const all = [];
    for (const { frame, value } of await this.evalAll(() => window.__crawl?.enumerate() ?? [])) {
      const tag = this.frameTag(frame);
      for (const c of value) all.push({ ...c, frame: tag, id: `${tag}|${c.key}|${c.occ}` });
    }
    return all;
  }

  fingerprint(ctrls) {
    return ctrls
      .map((c) => c.id)
      .sort()
      .join('\n');
  }

  async load() {
    this.current = '<load>';
    // A fresh load must be the page as a NEW context shows it: a click earlier in the walk may have folded a
    // panel or flipped a view switch, and the studio keeps those per Mac in localStorage — a reload would then
    // open a different shell and every control of the state would read 'vanished'. Clear the origin's storage
    // (the Home secret lives in sessionStorage and is re-set by the init script).
    await this.page
      .evaluate(() => {
        try {
          localStorage.clear();
        } catch {
          /* about:blank, no storage */
        }
      })
      .catch(() => {});
    await this.page.goto(this.url, { waitUntil: 'load', timeout: 60_000 });
    if (this.readySel)
      await this.page.waitForSelector(this.readySel, { timeout: 30_000 }).catch(() => {});
    await sleep(900);
  }

  frameOf(tag) {
    return tag === 'shell'
      ? this.page.mainFrame()
      : (this.frames().find((f) => f !== this.page.mainFrame()) ?? null);
  }

  /** Perform one replay step. Returns false when the step's control is not there. */
  async step(s) {
    if (s.kind === 'key') {
      await this.page.keyboard.press(s.key);
    } else if (s.kind === 'eval') {
      // fixture state that needs no click: run a script in the frame (e.g. hand the shell a hub-link status)
      const f = this.frameOf(s.frame ?? 'shell');
      if (!f) return false;
      await f.evaluate(s.script).catch(() => {});
    } else if (s.kind === 'select') {
      const f = this.frameOf(s.frame);
      if (!f) return false;
      const ok = await f
        .locator(s.selector)
        .first()
        .click({ timeout: 4000 })
        .then(
          () => true,
          () => false
        );
      if (!ok) return false;
    } else if (s.kind === 'click') {
      const f = this.frameOf(s.frame);
      if (!f) return false;
      // a list that fills in late (recent canvases, thumbnails) can lack the row for a moment: look a few times
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        if (attempt) await sleep(1000);
        ok = await f
          .evaluate(([k, o]) => window.__crawl?.mark(k, o) ?? false, [s.key, s.occ])
          .catch(() => false);
      }
      if (!ok) return false;
      await f
        .locator('[data-crawl-target]')
        .first()
        .click({ timeout: 2500 })
        .catch(() => {});
    }
    await sleep(s.wait ?? 700);
    return true;
  }

  /**
   * Bring the page into the state `steps` describes. Soft first: Escape twice, then continue from
   * the longest step prefix whose control set matches what is on screen; a fresh load otherwise.
   */
  async replay(steps, hard = false) {
    let from = -1;
    if (this.prefixFp.size && !hard) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.keyboard.press('Escape').catch(() => {});
      await sleep(300);
      const fp = this.fingerprint(await this.controls());
      for (let i = steps.length; i >= 0; i--) {
        if (this.prefixFp.get(this.stepsSig(steps.slice(0, i))) === fp) {
          from = i;
          break;
        }
      }
    }
    if (from < 0) {
      // a hard replay starts from the frozen project, not from whatever the clicks so far left behind
      if (hard && this.reset && this.resetEnabled !== false)
        this.url = (await this.reset()) ?? this.url;
      await this.load();
      from = 0;
      this.prefixFp.set(this.stepsSig([]), this.fingerprint(await this.controls()));
    }
    for (let i = from; i < steps.length; i++) {
      const s = steps[i];
      this.current = `<open ${s.label ?? s.key}>`;
      if (!(await this.step(s))) {
        this.lastMissing = `step ${i + 1}/${steps.length} (${s.label ?? s.key}) is not on screen`;
        return false;
      }
      this.prefixFp.set(
        this.stepsSig(steps.slice(0, i + 1)),
        this.fingerprint(await this.controls())
      );
    }
    await sleep(200);
    return true;
  }

  /**
   * The key a control is judged once under. A submenu row's testid is its LABEL ('Advanced' in Edit, View and
   * Diagnostics is one testid), so it is scoped to the menu it sits in — otherwise the first Advanced fold
   * judged hides the other two, and every row inside them is never reached.
   */
  judgeKeyOf(c, surface) {
    return judgeKey(c.frame, c.key, surface);
  }

  /** The click step of `st` that is this control, if any. */
  stepOf(st, c) {
    return st.steps.find((s) => s.kind === 'click' && s.frame === c.frame && s.key === c.key);
  }

  stepsSig(steps) {
    return steps
      .map((s) => `${s.kind}:${s.frame ?? ''}:${s.key ?? s.selector ?? s.name}:${s.occ ?? ''}`)
      .join('>');
  }

  /** Crawl from the given root states (each a list of steps). */
  async run(roots) {
    const queue = roots.map((r) => ({
      steps: r.steps,
      name: r.name,
      parentIds: null,
      depth: 0,
      popup: false,
      quiet: !!r.quiet,
    }));
    await this.drain(queue);
  }

  /** Crawl the queued states in order until the queue, the time budget or the state cap runs out. */
  async drain(queue) {
    const deadline = Date.now() + this.budgetMs;
    let states = 0;
    while (queue.length) {
      const st = queue.shift();
      if (Date.now() > deadline || states >= this.maxStates) {
        for (const q of [st, ...queue])
          this.results.push({
            mode: this.mode,
            surface: q.name,
            control: '(surface)',
            effect: 'unreachable',
            note:
              Date.now() > deadline ? 'time budget spent before this state' : 'state cap reached',
          });
        break;
      }
      states++;
      this.log(
        `[${this.mode}] ${this.label} · state ${states} (${queue.length} queued): ${st.name}`
      );
      await this.crawlState(st, queue);
    }
  }

  /**
   * `--resume`: crawl the states earlier shards never entered (`seeds` = their ' › '-joined paths), then the child
   * states those open. A seed that cannot be walked to again is listed unreachable with the reason.
   */
  async runSeeds(roots, seeds) {
    const queue = [];
    for (const path of seeds) {
      try {
        queue.push(await this.walkPath(roots, path, true));
      } catch (e) {
        this.results.push({
          mode: this.mode,
          surface: path,
          control: '(surface)',
          effect: 'unreachable',
          note: `a resumed state could not be walked to again: ${String(e.message).slice(0, 300)}`,
        });
      }
    }
    await this.drain(queue);
  }

  /**
   * A state path (' › '-joined names, as the report prints them) → the queued state it names: its steps, name, the
   * controls of the state it was opened from, depth and popup flag. A path's first segment names a root; each later
   * segment is the control clicked in the state before. `probe` reads the popup flag the way the crawl did (one real
   * click, classified) instead of guessing it from the control's role.
   */
  async walkPath(roots, path, probe = false) {
    // a root's own name may hold ' › ' ('canvas Landing › element selected'): the longest root name that
    // opens the path is the root, the rest are control names
    const root = roots
      .filter((r) => path === r.name || path.startsWith(`${r.name} › `))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!root) throw new Error(`--replay: no root named by "${path}"`);
    const rootName = root.name;
    const segs = path
      .slice(rootName.length)
      .split(' › ')
      .map((x) => x.trim())
      .filter(Boolean);
    let steps = [...root.steps];
    let name = rootName;
    let parentIds = null;
    // a root that only adds a fixture condition: what the plain page already shows is not judged again
    if (root.quiet && !segs.length) {
      await this.replay([]);
      parentIds = new Set((await this.controls()).map((x) => x.id));
    }
    let popup = false;
    for (const [i, seg] of segs.entries()) {
      if (!(await this.replay(steps))) throw new Error(`--replay: could not reach "${name}"`);
      const here = await this.controls();
      const c = here.find((x) => (x.tid || x.name) === seg);
      if (!c)
        throw new Error(
          `--replay: "${seg}" is not in the state "${name}" (there: ${here
            .map((x) => x.tid || x.name)
            .slice(0, 400)
            .join(' | ')})`
        );
      parentIds = new Set(here.map((x) => x.id));
      steps = [
        ...steps,
        { kind: 'click', frame: c.frame, key: c.key, occ: c.occ, label: c.tid || c.name },
      ];
      name = `${name} › ${seg}`;
      popup = !!c.haspopup || /^menuitem/.test(c.role);
      if (probe && i === segs.length - 1) {
        this.current = `<probe ${seg}>`;
        popup = this.classify(await this.measure(c, null), null, c).popup;
        this.current = '<idle>';
      }
    }
    return { steps, name, parentIds, depth: segs.length, popup, quiet: !!root.quiet };
  }

  /**
   * `--replay`: walk the given state paths (' › '-joined names, as the report prints them) and judge only the
   * last one. A path's first segment names a root; each later segment is the control clicked in the state before.
   */
  async runPaths(roots, paths) {
    // the judged state's parent is read FIRST, before any setup path changes the fixture: a control a setup
    // path creates (the Desktop artboard) is then new in the judged state, as it is in a full crawl
    // setup paths change the fixture on purpose; a reset would undo them
    if (paths.length > 1) this.resetEnabled = false;
    const last = await this.walkPath(roots, paths[paths.length - 1]);
    for (const p of paths.slice(0, -1)) {
      // reaching a state executes its clicks, so a setup path (create an artboard) takes effect right here
      const st = await this.walkPath(roots, p);
      await this.replay(st.steps);
    }
    this.log(`[${this.mode}] ${this.label} · replay: ${last.name}`);
    if (await this.replay(last.steps)) {
      const here = await this.controls();
      const fresh = here.filter((c) => !last.parentIds?.has(c.id));
      const modes = await this.page
        .evaluate(() =>
          [...document.querySelectorAll('[data-testid^="palette-mode-"]')]
            .map(
              (e) =>
                `${e.dataset.testid.slice(13)}=${e.getAttribute('aria-pressed') ?? e.getAttribute('aria-selected') ?? e.getAttribute('aria-checked')}`
            )
            .join(' ')
        )
        .catch(() => '?');
      this.log(`[${this.mode}] ${this.label} · replay canvas mode: ${modes}`);
      this.log(
        `[${this.mode}] ${this.label} · replay state shows ${here.length} controls, ${fresh.length} new; artboard labels: ${
          here
            .filter((c) => /^Artboard /.test(c.name))
            .map((c) => c.name)
            .join(', ') || 'none'
        }`
      );
    }
    await this.crawlState(last, []);
  }

  async crawlState(st, queue) {
    const surface = st.name;
    if (this.seedNames?.has(surface)) {
      if (this.enteredSeeds.has(surface)) return;
      this.enteredSeeds.add(surface);
    }
    if (!(await this.replay(st.steps, !!this.reset)) && !(await this.replay(st.steps, true))) {
      this.results.push({
        mode: this.mode,
        surface,
        control: '(surface)',
        effect: 'unreachable',
        note: `a replay step was not found, also after a fresh load${this.lastMissing ? `: ${this.lastMissing}` : ''}`,
      });
      return;
    }
    this.statesDone.push({ mode: this.mode, surface });
    const ctrls = await this.controls();
    let fp = this.fingerprint(ctrls);
    const parent = st.parentIds;
    const fresh = ctrls.filter((c) => !parent?.has(c.id));
    if (!fresh.some((c) => !this.clicked.has(this.judgeKeyOf(c, surface)))) return; // nothing new to judge here
    // the noise floor of this state, per frame
    const bgStart = this.reqPaths.length;
    const idle = await this.evalAll(() => window.__crawl?.idle(700) ?? 0);
    this.noiseFloor = Math.ceil(Math.max(0, ...idle.map((i) => i.value)) * 1.5) + 4;
    for (const p of this.reqPaths.slice(bgStart)) this.bgPaths.add(p);
    // a popup state (menu, sheet): what does merely CLOSING it look like? A menu row that only closes
    // its menu is dead, so that signature is subtracted from every row's effect.
    let closeSig = null;
    if (st.popup) {
      closeSig = await this.measure(null, async () => this.page.keyboard.press('Escape'));
      await this.replay(st.steps);
      fp = this.fingerprint(await this.controls());
    }
    let forceHard = false;
    const famCount = new Map();
    const famLast = new Map(); // family → the control of it that was clicked last
    // destructive first-level controls last, so a deletion cannot hide later controls
    fresh.sort((a, b) => Number(isDestructive(a.name)) - Number(isDestructive(b.name)));
    for (const c of fresh) {
      const judgeKey = this.judgeKeyOf(c, surface);
      const row = {
        mode: this.mode,
        surface,
        control: c.tid || c.name || c.key,
        key: c.key,
        frame: c.frame,
        role: c.role || c.tag,
      };
      // judged once: the same control seen again (in another menu, a second state) is listed as the twin of
      // the one that was clicked, so every control found ends in a class
      if (this.clicked.has(judgeKey)) {
        // a state that only adds a fixture condition (a hub link) repeats every shell control: not listed again
        if (st.quiet) continue;
        this.results.push({
          ...row,
          effect: 'twin',
          twin: this.clicked.get(judgeKey),
          note: 'the same control, already clicked',
        });
        continue;
      }
      const fam = c.family ? `${c.frame}|${c.family}` : null;
      if (fam) {
        const n = famCount.get(fam) ?? 0;
        const cap = c.role === 'option' || c.role === 'treeitem' ? OPTION_CAP : FAMILY_CAP;
        if (n >= cap) {
          this.results.push({
            ...row,
            effect: 'twin',
            twin: famLast.get(fam) ?? fam,
            note: `one of a repeated family (${c.family}), sampled ${cap}`,
          });
          continue;
        }
        famCount.set(fam, n + 1);
      }
      this.clicked.set(judgeKey, `${surface} · ${row.control}`);
      if (fam) famLast.set(fam, `${surface} · ${row.control}`);
      if (c.disabled) {
        this.results.push({ ...row, effect: 'disabled', note: c.reason || '' });
        continue;
      }
      if (
        NEVER.test(c.name) ||
        (c.inDialog && isDestructive(c.name) && !/^(cancel|close|keep|back|not now)/i.test(c.name))
      ) {
        this.results.push({
          ...row,
          effect: 'skipped-destructive',
          note: c.inDialog ? 'confirm inside a dialog — not clicked' : 'never clicked',
        });
        continue;
      }
      if (c.tag === 'input' && /file/.test(c.key)) {
        this.results.push({
          ...row,
          effect: 'skipped-file-picker',
          note: 'opens the OS file picker',
        });
        continue;
      }
      // restore the state when it drifted
      const now = await this.controls();
      if (forceHard || this.fingerprint(now) !== fp || !now.some((x) => x.id === c.id)) {
        // the click before opened something (the URL moved): the control set can look the same while the
        // thing it acts on is already open — go back to a fresh project and the state
        await this.replay(st.steps, forceHard);
        forceHard = false;
        let again = await this.controls();
        if (!again.some((x) => x.id === c.id)) {
          // second chance: a fresh load and the whole walk from the root, not the soft restore
          await this.replay(st.steps, true);
          again = await this.controls();
          // rows that land a moment after the page (runtime files, the recents list): give them a few looks
          for (let look = 0; look < 3 && !again.some((x) => x.id === c.id); look++) {
            await sleep(1200);
            again = await this.controls();
          }
        }
        fp = this.fingerprint(again);
        if (!again.some((x) => x.id === c.id)) {
          this.results.push({
            ...row,
            effect: 'vanished',
            note: `not present after a fresh load and a replay of the state${
              this.lastMutator
                ? `; the last click that changed the fixture: ${this.lastMutator}`
                : ''
            }`,
          });
          continue;
        }
      }
      this.current = `${c.frame}:${c.tid || c.name || c.key}`;
      const raw = await this.measure(c, null);
      const res = this.classify(
        raw,
        /^(menuitem|menuitemcheckbox|menuitemradio|option)$/.test(c.role) ? closeSig : null,
        c
      );
      // A checkbox row closes its menu on a click, so the flip itself is not on screen after it: open the menu
      // again and read the row (the proof a toggle row worked, not that the menu closed).
      if (c.role === 'menuitemcheckbox' && !c.disabled) {
        this.current = `<read ${c.tid || c.name} again>`;
        if (await this.replay(st.steps)) {
          const was = c.current;
          const nowC = (await this.controls()).find((x) => x.id === c.id);
          if (nowC && nowC.current !== was) {
            const flip = `toggled ${was ? 'on' : 'off'}→${nowC.current ? 'on' : 'off'}`;
            res.effect = res.effect === 'DEAD' ? flip : `${res.effect} ${flip}`;
          }
        }
      }
      // A no-op after sibling clicks proves nothing: a segmented choice already set by the sibling, an option the
      // sibling made moot. Judge it again first-in-state on a fresh project; only a click that does nothing there
      // is DEAD.
      if (
        res.effect === 'DEAD' &&
        !c.current &&
        !raw.note.startsWith('pointer blocked') &&
        !raw.note.startsWith('a select with one option') &&
        !this.stepOf(st, c)
      ) {
        this.current = `<again, clean: ${c.tid || c.name}>`;
        if (await this.replay(st.steps, true)) {
          const fresh2 = (await this.controls()).find((x) => x.id === c.id);
          if (fresh2) {
            const raw2 = await this.measure(fresh2, null);
            const res2 = this.classify(
              raw2,
              /^(menuitem|menuitemcheckbox|menuitemradio|option)$/.test(c.role) ? closeSig : null,
              fresh2
            );
            if (res2.effect !== 'DEAD') {
              res.effect = res2.effect;
              res.opens = res2.opens;
              res.popup = res2.popup;
              raw.note = `no effect after earlier clicks in the state; first in a clean state it has one`;
            }
          }
        }
      }
      // the control that OPENED this state (the canvas row of a canvas root): clicking it again is a no-op
      if (res.effect === 'DEAD' && this.stepOf(st, c)) {
        res.effect = 'current';
        raw.note = 'the control that opened this state — clicking it again is a no-op';
      }
      this.current = '<idle>';
      const destructive = isDestructive(c.name);
      const out = { ...row, effect: res.effect, note: raw.note };
      if (res.effect === 'DEAD' && c.current) {
        out.effect = 'current';
        out.note = 'already the selected/pressed choice — clicking it again is a no-op';
      } else if (res.effect === 'DEAD' && c.frame === 'canvas' && /^Artboard /.test(c.name)) {
        // an artboard's label on an artboard that is ALREADY selected (a just-made one is): clear the selection
        // the way the shell does (run-action select.none, from the parent) and click again. An effect then =
        // the label works and was the current choice; still nothing = a real dead label.
        await this.page
          .evaluate(() => {
            for (const f of document.querySelectorAll('iframe'))
              f.contentWindow?.postMessage({ dgn: 'run-action', v: 1, id: 'select.none' }, '*');
          })
          .catch(() => {});
        await sleep(SETTLE_MS);
        const again = this.classify(await this.measure(c, null), null, c);
        if (again.effect !== 'DEAD') {
          out.effect = 'current';
          out.note = `the artboard was already selected — after select.none the same click: ${again.effect}`;
        }
      } else if (res.effect === 'DEAD' && raw.note === 'a select with one option') {
        out.effect = 'single-option';
      } else if (res.effect === 'DEAD' && raw.note.startsWith('pointer blocked')) {
        // under an overlay (an armed tool's draw surface, a scrim): the person cannot reach it either —
        // listed on its own, not as a dead control
        out.effect = 'covered';
      }
      if (destructive && res.effect !== 'DEAD') {
        out.note = `destructive first click → ${res.effect}${raw.note ? `; ${raw.note}` : ''}`;
        out.destructive = true;
      }
      this.results.push(out);
      if (/\burl\b/.test(out.effect)) forceHard = true;
      if (/net\(/.test(out.effect)) this.lastMutator = `${surface} · ${row.control}`;
      this.onResult?.(out);
      // a click that revealed a place of its own → a child state
      if (res.opens && st.depth < this.maxDepth && !destructive) {
        const childSteps = [
          ...st.steps,
          { kind: 'click', frame: c.frame, key: c.key, occ: c.occ, label: c.tid || c.name },
        ];
        const sig = `${surface}>${c.key}`;
        if (!this.queued.has(sig)) {
          this.queued.add(sig);
          queue.push({
            steps: childSteps,
            name: `${surface} › ${c.tid || c.name}`,
            parentIds: new Set(ctrls.map((x) => x.id)),
            depth: st.depth + 1,
            popup: res.popup,
            quiet: st.quiet,
          });
        }
      }
      if (res.effect === 'DEAD') continue;
      // restore: Escape; a toggle that hid part of the state (Hide panels) is clicked once more
      await this.page.keyboard.press('Escape').catch(() => {});
      await sleep(250);
      const back = await this.controls();
      const backIds = new Set(back.map((x) => x.id));
      const lost = ctrls.filter((x) => !backIds.has(x.id)).length;
      if (lost >= 3 && backIds.has(c.id) && !destructive && !c.inDialog) {
        this.current = `<re-toggle ${c.tid || c.name}>`;
        await this.step({ kind: 'click', frame: c.frame, key: c.key, occ: c.occ, wait: 600 });
        await this.page.keyboard.press('Escape').catch(() => {});
        await sleep(200);
      }
    }
  }

  /** One click (or `action`) inside an observation window; the raw signals it produced. */
  async measure(c, action) {
    const f = c ? this.frameOf(c.frame) : null;
    const before = await this.controls();
    const beforeIds = new Set(before.map((x) => x.id));
    for (const fr of this.frames()) {
      await fr
        .evaluate(
          ([k, o, mine]) => {
            if (!window.__crawl) return false;
            if (mine) window.__crawl.mark(k, o);
            else window.__crawl.mark('\u0000', 0);
            return window.__crawl.start();
          },
          [c?.key, c?.occ, !!c && fr === f]
        )
        .catch(() => {});
    }
    const invokes0 = await this.page
      .evaluate(() => (window.__crawlInvokes ?? []).length)
      .catch(() => 0);
    const req0 = this.reqPaths.length;
    const ext0 = this.external.length;
    const pop0 = this.popups.length;
    const url0 = this.page.url();
    let note = '';
    if (action) await action();
    else if (c.tag === 'select') {
      // a native <select> opens an OS popup the DOM never shows: pick another option instead
      const loc = f.locator('[data-crawl-target]').first();
      const next = await loc
        .evaluate(
          (el) => [...el.options].find((o) => !o.disabled && o.value !== el.value)?.value ?? null
        )
        .catch(() => null);
      if (next === null) note = 'a select with one option';
      else await loc.selectOption(next, { timeout: 2500 }).catch(() => {});
    } else {
      try {
        await f.locator('[data-crawl-target]').first().click({ timeout: 2500 });
      } catch (e) {
        // a covered control: say so and dispatch the click directly
        note = `pointer blocked (${
          String(e.message)
            .split('\n')
            .find((l) => /intercepts|not visible|outside|not stable/.test(l))
            ?.trim()
            .slice(0, 120) ?? 'timeout'
        }); clicked via el.click()`;
        await f
          .evaluate(() => document.querySelector('[data-crawl-target]')?.click())
          .catch(() => {});
      }
    }
    await sleep(SETTLE_MS);
    const stops = await this.evalAll(() => window.__crawl?.stop() ?? null);
    const invokes = await this.page
      .evaluate((n) => (window.__crawlInvokes ?? []).slice(n), invokes0)
      .catch(() => []);
    const reqs = [
      ...new Set(
        this.reqPaths
          .slice(req0)
          .filter((p) => !this.bgPaths.has(p) && !/^\/(_ws|_health|_events)/.test(p))
      ),
    ];
    const after = await this.controls();
    const afterIds = new Set(after.map((x) => x.id));
    const raw = {
      note,
      newIds: after.filter((x) => !beforeIds.has(x.id)).map((x) => x.id),
      removed: before.filter((x) => !afterIds.has(x.id)).length,
      muts: 0,
      aria: [],
      popupsDelta: 0,
      opens: [],
      clips: [],
      value: false,
      url: this.page.url() !== url0,
      focus: null,
      reqs,
      external: this.external.slice(ext0).map((e) => e.url),
      windows: this.popups.slice(pop0).map((e) => e.url),
      invokes,
    };
    for (const s of stops) {
      const v = s.value;
      if (!v) continue;
      raw.muts += v.muts;
      raw.aria.push(...v.aria);
      raw.popupsDelta += v.popupsDelta;
      raw.opens.push(...v.opens);
      raw.clips.push(...(v.clips ?? []));
      if (v.checkedChanged || v.valueChanged || v.fieldsChanged) raw.value = true;
      if (v.triggerChanged) raw.label = true;
      raw.announced = (raw.announced ?? 0) + (v.announced ?? 0);
      if (v.urlChanged && s.frame === this.page.mainFrame()) raw.url = true;
      if (v.focusMoved && (s.frame === f || !c)) raw.focus = v.focusRegion;
    }
    return raw;
  }

  /** Raw signals → effect kinds, minus what merely closing the state's popup produces. */
  classify(raw, sig, c) {
    const kinds = [];
    const sigAria = new Set(sig?.aria ?? []);
    const aria = raw.aria.filter((a) => !sigAria.has(a));
    if (aria.length) kinds.push(`aria(${aria[0]})`);
    if (raw.popupsDelta > 0) kinds.push('popup');
    if (raw.opens.length) kinds.push(`window.open(${raw.opens[0].slice(0, 60)})`);
    if (raw.value) kinds.push('value');
    if (raw.announced > (sig?.announced ?? 0)) kinds.push('announce');
    // a radio pick that relabels its menu's trigger (only a pick can: Esc never relabels it)
    if (raw.label && /^(menuitemradio|option)$/.test(c?.role ?? '')) kinds.push('label');
    if (raw.clips.length) kinds.push(`clipboard(${raw.clips[0]})`);
    if (raw.url && !sig?.url) kinds.push('url');
    // inside a popup state focus always moves when the popup closes — not an effect on its own
    if (raw.focus && !sig) kinds.push(`focus→${raw.focus}`);
    if (raw.newIds.length) kinds.push(`+${raw.newIds.length} controls`);
    if (raw.removed > (sig ? sig.removed : 0) + 1) kinds.push(`-${raw.removed} controls`);
    const floor = Math.max(4, this.noiseFloor ?? 0) + (sig ? sig.muts : 0);
    if (raw.muts > floor) kinds.push(`dom(${raw.muts})`);
    const sigReqs = new Set(sig?.reqs ?? []);
    const reqs = raw.reqs.filter((r) => !sigReqs.has(r));
    if (reqs.length) kinds.push(`net(${reqs.slice(0, 2).join(',')})`);
    if (raw.external.length) kinds.push(`external(${raw.external[0].slice(0, 60)})`);
    if (raw.windows.length) kinds.push(`window(${raw.windows[0].slice(0, 60)})`);
    if (raw.invokes.length) kinds.push(`native(${raw.invokes.slice(0, 2).join(',')})`);
    // a link to another program (maude://…, mailto:): the browser hands it to the OS, which nothing on the page shows
    if (c?.href && /^(?!https?:|#|\/)[a-z][a-z0-9+.-]*:/i.test(c.href))
      kinds.push(`opens another app(${c.href.slice(0, 40)})`);
    const popup =
      raw.popupsDelta > 0 ||
      aria.some((a) => a.startsWith('aria-expanded') || a.startsWith('aria-selected'));
    // a child state only when the click revealed a place of its own (a popup, a tab, a sheet), not
    // when it swapped one label for another (Pin → Unpin)
    // …and not when it navigated (a new canvas, another place): a new root, not a sheet of this one
    const opens =
      raw.newIds.length > 0 &&
      !raw.url &&
      (popup || c.role === 'tab' || !!c.haspopup || raw.newIds.length >= 3);
    return { effect: kinds.length ? kinds.join(' ') : 'DEAD', opens, popup: popup || !!c.haspopup };
  }
}
