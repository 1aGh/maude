// Two machines, one project — the plumbing behind `sync-e2e`.
//
// The thing under test is a SHARED STATE between two independent processes, so
// the harness has to be honest about a distinction most test harnesses can
// ignore: the difference between "the write happened" and "the write arrived".
// Everything here exists to keep those two apart.
//
// ── The two sides ───────────────────────────────────────────────────────────
//
//   cloud    the cell — a hub in workspace mode that owns a git checkout and
//            supervises a studio child. Reached through the hub's port with a
//            browser session cookie, exactly the way a person reaches it.
//   desktop  a peer — a plain studio server over a linked project, the same
//            process the desktop app spawns as its sidecar.
//
// They are deliberately NOT symmetric in how they are built, because they are
// not symmetric in production either. What IS symmetric is the interface below:
// every scenario acts on `from` and asserts on `to`, and the runner calls it
// twice with the sides swapped. A scenario that only passes one way around is
// the bug this whole file exists to catch.
//
// ── Why the act goes through the HTTP API and the check goes through the UI ─
//
// A scenario acts by calling the same endpoint the studio's own UI calls. That
// is faithful (there is no second write path) and it is stable (no dependence
// on whether a dropdown opened). What it CANNOT tell you is whether the other
// machine's browser actually renders what arrived — a file can be byte-perfect
// on disk and still be invisible, which is precisely the class of bug the user
// hit with a missing asset. So convergence is asserted on disk AND in the
// receiving side's live DOM, and every scenario leaves a screenshot behind.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/** Longest a scenario waits for a change to cross. Generous: a cold pass on a
 *  loaded laptop is slower than a warm one, and a flaky suite is worse than a
 *  slow one. Real crossings are ~1–3 s. */
export const CONVERGE_TIMEOUT_MS = 45_000;

/** How often convergence is re-checked. */
const POLL_MS = 250;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- one side --- */

/**
 * One machine's view of the project.
 *
 * `base` is where its studio API answers and `designRoot` is where its bytes
 * land. Keeping both means a scenario can state its expectation in whichever
 * vocabulary is HONEST for it — "the tree shows a row" is a UI fact, "the file
 * is there with these bytes" is a disk fact, and conflating them is how a
 * harness ends up proving something nobody cares about.
 */
export class Side {
  constructor({ name, base, designRoot, headers = {}, browser }) {
    this.name = name;
    this.base = base.replace(/\/+$/, '');
    this.designRoot = designRoot;
    /** The design root's folder name (`.design`) — its static mount prefix. */
    this.designDirName = designRoot.split('/').filter(Boolean).at(-1);
    this.headers = headers;
    this.browser = browser; // agent-browser session name
  }

  get label() {
    return this.name === 'cloud' ? 'cloud' : 'desktop';
  }

  /** Call a studio API route. Throws with the body on a non-2xx, because a
   *  silent 403 in an act step reads downstream as "sync did not work". */
  async api(path, { method = 'GET', body, raw, contentType } = {}) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...this.headers,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(raw !== undefined ? { body: raw } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${this.label} ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  abs(rel) {
    return join(this.designRoot, rel);
  }

  has(rel) {
    return existsSync(this.abs(rel));
  }

  bytes(rel) {
    return readFileSync(this.abs(rel));
  }

  text(rel) {
    return readFileSync(this.abs(rel), 'utf8');
  }

  size(rel) {
    try {
      return statSync(this.abs(rel)).size;
    } catch {
      return null;
    }
  }

  /** Every path under the design root that is not per-machine runtime state.
   *  The parity check both directions end on. */
  tracked() {
    const out = [];
    const walk = (dir, prefix) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        // DDR-115 — the taxonomy, in its "what a person would call theirs" form.
        if (e.name.startsWith('_') || e.name === '.git') continue;
        if (e.isDirectory()) walk(join(dir, e.name), rel);
        else out.push(rel);
      }
    };
    walk(this.designRoot, '');
    return out.sort();
  }

  /** The doručenka — what this side believes about delivery. */
  sync() {
    try {
      return JSON.parse(readFileSync(join(this.designRoot, '_sync.json'), 'utf8'));
    } catch {
      return null;
    }
  }
}

/* -------------------------------------------------------- waiting well --- */

/**
 * Wait until `check()` returns truthy, then report how long it took.
 *
 * Returns `{ ok, ms, value }` rather than throwing, so a scenario can report a
 * failure WITH its timing next to the ones that passed. A sync suite where the
 * only signal is pass/fail hides the interesting regression: the one where
 * everything still arrives, but takes thirty seconds.
 */
export async function waitFor(check, { timeoutMs = CONVERGE_TIMEOUT_MS, label = '' } = {}) {
  const started = Date.now();
  for (;;) {
    let value;
    try {
      value = await check();
    } catch {
      value = false;
    }
    if (value) return { ok: true, ms: Date.now() - started, value };
    if (Date.now() - started > timeoutMs) {
      return { ok: false, ms: Date.now() - started, value: null, label };
    }
    await sleep(POLL_MS);
  }
}

/** Both sides hold identical bytes at `rel`. The strongest cheap assertion. */
export function sameBytes(a, b, rel) {
  if (!a.has(rel) || !b.has(rel)) return false;
  return a.bytes(rel).equals(b.bytes(rel));
}

/* ------------------------------------------------------------- browser --- */

/**
 * A thin agent-browser wrapper.
 *
 * Sessions are how two independent browser contexts coexist: `--session cloud`
 * and `--session desktop` keep cookies and pages apart, so signing in to one
 * does not sign in to the other and a screenshot is unambiguous about which
 * machine it came from.
 */
export class Browser {
  constructor({ session, shotDir, quiet = false }) {
    this.session = session;
    this.shotDir = shotDir;
    this.quiet = quiet;
    mkdirSync(shotDir, { recursive: true });
  }

  run(args, { timeoutMs = 60_000 } = {}) {
    return new Promise((resolve) => {
      const p = spawn('agent-browser', ['--session', this.session, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      p.stdout.on('data', (d) => {
        out += d;
      });
      p.stderr.on('data', (d) => {
        err += d;
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, out: out.trim(), err: err.trim() });
      });
      p.on('error', () => {
        clearTimeout(timer);
        resolve({ code: -1, out: '', err: 'agent-browser not found' });
      });
    });
  }

  open(url) {
    return this.run(['open', url]);
  }

  reload() {
    return this.run(['reload']);
  }

  /**
   * Evaluate JS in the page and return the VALUE.
   *
   * `--json` wraps it as `{success, data: {origin, result}, error}`, and
   * returning that envelope is worse than returning nothing: `{…}` is truthy,
   * so every `present()` check silently passed and every count compared an
   * object against a number. Unwrap here, once, or every caller re-learns it.
   */
  async eval(js) {
    const { code, out } = await this.run(['eval', js, '--json']);
    if (code !== 0) return null;
    try {
      const parsed = JSON.parse(out);
      if (parsed && parsed.success === false) return null;
      return parsed?.data?.result ?? parsed?.result ?? parsed?.value ?? null;
    } catch {
      return out || null;
    }
  }

  async shot(name) {
    const path = join(this.shotDir, `${name}.png`);
    const { code } = await this.run(['screenshot', path]);
    return code === 0 ? path : null;
  }

  /**
   * Does the page hold an element matching `selector`?
   *
   * Deliberately a DOM query rather than a screenshot diff: "the row is in the
   * tree" is a claim a person can check, and a pixel comparison of a file tree
   * would fail on a scrollbar.
   */
  async present(selector) {
    const v = await this.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
    return v === true || v === 'true';
  }

  /** Wait for a selector to appear, giving the receiving UI time to notice. */
  waitPresent(selector, opts = {}) {
    return waitFor(() => this.present(selector), { label: selector, ...opts });
  }

  /** How many elements match. */
  async count(selector) {
    const n = await this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    return Number(n) || 0;
  }

  click(selector) {
    return this.run(['click', selector]);
  }

  close() {
    return this.run(['close']);
  }
}

/* --------------------------------------------------------------- assets --- */

/**
 * A deterministic little PNG, unique per `seed`.
 *
 * Assets are content-addressed, so a fixture image reused across runs dedupes
 * to a path that is already there — and a scenario that asserts "the file
 * arrived" would pass without anything crossing at all. Varying the bytes is
 * what makes the assertion mean something.
 */
export function makePng(seed) {
  const w = 8;
  const h = 8;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      row[1 + x * 4] = (seed * 37 + x * 11) & 0xff;
      row[2 + x * 4] = (seed * 53 + y * 17) & 0xff;
      row[3 + x * 4] = (seed * 7) & 0xff;
      row[4 + x * 4] = 255;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** CRC-32, for Node builds whose zlib does not expose one. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/* ----------------------------------------------------------- annotations --- */

/**
 * An annotations-v2 board (DDR-242) carrying one element per requested shape:
 * `{"format":"maude.annotations","v":2,"elements":[…]}`, one element per line.
 *
 * Records use the registry's own field names and canonical key order (head
 * `id,type,index`, then the type's fields), so the studio's validator keeps
 * every one of them and the sender's canonical write is what the receiver
 * compares byte-for-byte. Ids and fractional `index` keys are fixed per
 * position, so the same shapes always build the same board.
 */
export function annotationBoard(shapes) {
  const elements = shapes.map((s, i) => {
    const head = { id: `e2e_${i}`, type: '', index: `a${i}` };
    switch (s.kind) {
      case 'sticky':
        return { ...head, type: 'sticky', x: s.x, y: s.y, w: 180, h: 120, text: s.text };
      case 'rect':
        return {
          ...head,
          type: 'shape',
          x: s.x,
          y: s.y,
          w: 200,
          h: 120,
          color: '#2b6cb0',
          width: 3,
        };
      case 'arrow':
        return {
          ...head,
          type: 'arrow',
          start: { x: s.x, y: s.y },
          end: { x: s.x + 160, y: s.y + 90 },
          color: '#c53030',
          width: 4,
        };
      case 'section':
        return { ...head, type: 'section', x: s.x, y: s.y, w: 420, h: 300, label: s.text };
      case 'image':
        // NO leading slash: the registry keeps an image `href` only when it
        // matches `^assets/<name>.<ext>$` (relative, single segment, raster
        // extension) and blanks anything else. A `/assets/…` here would be
        // rewritten on write, and the scenario would then "fail" against a
        // value the product changed on purpose.
        return { ...head, type: 'image', x: s.x, y: s.y, w: 120, h: 120, href: s.href };
      default:
        return { ...head, type: 'pen', points: [s.x, s.y, s.x + 60, s.y + 40], width: 3 };
    }
  });
  const lines = elements.map((e) => JSON.stringify(e)).join(',\n');
  return `{"format":"maude.annotations","v":2,"elements":[\n${lines}\n]}\n`;
}
