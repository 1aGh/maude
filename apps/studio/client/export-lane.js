// export-lane.js — DDR-231 (hybrid export lanes), client half.
//
// The SINGLE definition of "can the member's own browser capture this export
// request", shared by the shell ExportDialog and the bridged in-canvas
// handler in app.jsx — and unit-tested without a DOM
// (test/export-browser-lane.test.ts). If the rule forks between the two entry
// points, one dialog silently routes through the fleet the other avoids.
//
// The rule: a workspace (any non-local lane) captures png/svg of a KNOWN
// active artboard in the browser — the canvas already renders there, so the
// capture is instant and needs no render service. Everything else (other
// formats, multi-artboard scopes, selection captures) continues to the jobs
// lane: `remote` renders it on maude-render, `none` refuses with a remedy.

// ── S8.5 — cloud or this Mac, for a video (09 ex-offline, ex-advanced "Where it renders") ─────────
//
// The person's standing choice is a per-viewer convenience kept in this browser: "Suggest each
// time" (the default), "Always the cloud", "Always this Mac". Under "Suggest each time" the sheet
// ticks what the estimate's `render.suggest` says — the cloud for 4K and long videos. The server
// decides again (exporters/remote.ts `chooseRenderLane`): this is the question, not the gate.
// Images and PDFs never ask: they always export on this Mac, in seconds, offline too.

/** Advanced › Where it renders › Video — the stored choice. */
export const LANE_PREFS = ['auto', 'cloud', 'this-mac'];
const LANE_PREF_KEY = 'maude-export-video-lane';

/** The stored choice, or 'auto'. Storage may be missing or throw (private window): 'auto'. */
export function readLanePref(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(LANE_PREF_KEY);
    return LANE_PREFS.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Remember the choice for the next sheet. A storage failure only forgets it. */
export function writeLanePref(value, storage = globalThis.localStorage) {
  if (!LANE_PREFS.includes(value)) return;
  try {
    storage?.setItem(LANE_PREF_KEY, value);
  } catch {
    /* a per-viewer convenience: the export itself is unaffected */
  }
}

/** 09 ex-offline — the Render row's words, online and offline (CONTRACT §4: drawn strings). */
export const RENDER_ROW = 'Render';
export const CLOUD_TITLE = 'In the cloud';
export const THIS_MAC_TITLE = 'On this Mac';
export const CLOUD_WAITS = 'Waits for a connection, then starts by itself.';
export const CLOUD_ONLINE = 'Keeps going if this Mac sleeps.';
export const THIS_MAC_ONLINE = "Keep this window open until it's done.";
export const THIS_MAC_OFFLINE = "Starts now. Keep this window open until it's done.";
/** Why the cloud is ticked under "Suggest each time". */
export const SUGGEST_WHY = {
  '4k': 'Suggested for 4K — the cloud renders it faster.',
  long: 'Suggested for a video past a minute — the cloud renders it faster.',
};

/** "About 3 min" / "A few seconds" — the this-Mac estimate, as the option's first words (§5.5 rounding). */
function aboutTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 10) return 'A few seconds';
  if (seconds < 60) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  return `About ${Math.round(seconds / 60)} min`;
}

function thisMacSub(online, seconds) {
  const t = aboutTime(seconds);
  if (online) return t ? `${t}. ${THIS_MAC_ONLINE}` : THIS_MAC_ONLINE;
  return t ? `Starts now. ${t} — keep this window open until it's done.` : THIS_MAC_OFFLINE;
}

/**
 * The Render row for one sheet.
 * @param {{ pref?: string, render?: { cloud: boolean, suggest: string, why: string|null } | null,
 *           online?: boolean, picked?: string|null, seconds?: number|null }} o
 *   `render` = the estimate's block; `picked` = what the person clicked in this sheet (wins);
 *   `seconds` = the estimate's this-Mac time (the option says it when known).
 * @returns {{ show: boolean, lane: 'cloud'|'this-mac', suggested: boolean, why: string|null,
 *             options: Array<{ id: string, title: string, sub: string, icon: string }> }}
 */
export function renderChoice({
  pref = 'auto',
  render = null,
  online = true,
  picked = null,
  seconds = null,
} = {}) {
  const show = !!render?.cloud;
  if (!show) return { show: false, lane: 'this-mac', suggested: false, why: null, options: [] };
  let lane;
  let suggested = false;
  if (picked === 'cloud' || picked === 'this-mac') lane = picked;
  else if (pref === 'cloud' || pref === 'this-mac') lane = pref;
  else {
    // 09 ex-offline: with no connection the cloud card only waits, so "Suggest each time" ticks this Mac; a standing
    // choice (or a click) above still wins
    lane = online && render.suggest === 'cloud' ? 'cloud' : 'this-mac';
    suggested = lane === 'cloud';
  }
  const why = suggested && render.why ? (SUGGEST_WHY[render.why] ?? null) : null;
  return {
    show,
    lane,
    suggested,
    why,
    options: [
      {
        id: 'cloud',
        title: CLOUD_TITLE,
        sub: online ? CLOUD_ONLINE : CLOUD_WAITS,
        icon: online ? 'cloud' : 'offline',
      },
      {
        id: 'this-mac',
        title: THIS_MAC_TITLE,
        sub: thisMacSub(online, seconds),
        icon: 'laptop',
      },
    ],
  };
}

/** The spec the button sends: the chosen lane on a video that asked; untouched otherwise. */
export function withRenderLane(spec, choice) {
  if (!choice?.show) return spec;
  return { ...spec, options: { ...(spec.options ?? {}), lane: choice.lane } };
}

/** Formats the canvas-lib export-capture bridge can produce today. */
export const BROWSER_CAPTURE_FORMATS = new Set(['png', 'svg']);

/**
 * Formats a workspace can serve WITHOUT the render service thanks to the
 * browser lane — the dialog's card-blocking check on lane `none`. pptx rides
 * the capture bridge for its PNGs and the in-cell assemble route
 * (`/_api/export-assemble`) for composition.
 */
export const BROWSER_SERVABLE_FORMATS = new Set(['png', 'svg', 'pptx']);

/**
 * @param {{ exportLane?: string, format?: string, scope?: string, artboardId?: unknown }} req
 * @returns {boolean}
 */
export function browserCaptureEligible({ exportLane, format, scope, artboardId }) {
  if (exportLane === 'local' || exportLane === undefined) return false;
  if (BROWSER_CAPTURE_FORMATS.has(format)) return scope === 'artboard' && !!artboardId;
  // The deck: every artboard captured as PNG in the browser, composed in-cell.
  if (format === 'pptx') return scope === 'canvas-as-separate';
  return false;
}

/**
 * DDR-231 — the pptx browser lane, shared by the shell ExportDialog and the
 * bridged in-canvas handler: capture EVERY artboard as PNG via the bridge,
 * POST them to the in-cell assemble route, hand back the finished deck.
 * 3× mirrors the desktop PNG-deck fallback's FALLBACK_SCALE (crisp in
 * non-vector viewers).
 *
 * @param {{ capture: Function, name?: string, scale?: number, onProgress?: Function,
 *           onAssemble?: Function }} args
 * @returns {Promise<{ filename: string, blob: Blob }>}
 */
export async function captureDeckViaBrowser({
  capture,
  name = 'export',
  scale = 3,
  onProgress,
  onAssemble,
}) {
  const items = await capture({
    format: 'png',
    artboardIds: null,
    scale,
    onProgress,
    timeoutMs: 300_000,
  });
  if (!items || !items.length) throw new Error('capture returned nothing');
  const fd = new FormData();
  fd.set('format', 'pptx');
  fd.set('scale', String(scale));
  fd.set('name', name);
  for (const it of items) fd.append('image', it.blob, it.name);
  // Composition is a distinct, non-instant phase — tell the caller so the
  // status stops claiming the capture is still running.
  onAssemble?.();
  const r = await fetch('/_api/export-assemble', { method: 'POST', body: fd });
  if (!r.ok) throw new Error((await r.text()) || `deck assembly failed (${r.status})`);
  const disp = r.headers.get('content-disposition') || '';
  const filename = /filename="([^"]+)"/.exec(disp)?.[1] || `${name}.pptx`;
  return { filename, blob: await r.blob() };
}

const SAFE_CAPTURE_MIME = { png: 'image/png', svg: 'image/svg+xml' };
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A forged reply can't be allowed to drive an unbounded number of downloads or
// buffer an arbitrary blob into the member's browser (DDR-231 adversarial pass,
// F1 caps). A png/svg export targets ONE artboard, so these are generous.
export const MAX_CAPTURE_ITEMS = 64;
export const MAX_CAPTURE_TOTAL_BYTES = 96 * 1024 * 1024;

/** Safe download basename for a captured item: path-stripped, charset-limited,
 * with the requested format's extension forced on. */
function safeCaptureName(name, format) {
  const ext = format === 'svg' ? 'svg' : 'png';
  const raw = typeof name === 'string' ? name : '';
  let base = raw
    .replace(/^.*[\\/]/, '') // drop any path
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(new RegExp(`\\.${ext}$`, 'i'), '');
  if (!base || /^\.+$/.test(base)) base = 'artboard';
  return `${base.slice(0, 200)}.${ext}`;
}

/** True iff `bytes` actually begins with the requested format's signature —
 * PNG 8-byte magic, or SVG/XML text for svg. */
function magicMatches(bytes, format) {
  if (format === 'png') return PNG_MAGIC.every((b, i) => bytes[i] === b);
  // svg: allow a leading BOM/whitespace, then `<svg` or `<?xml`.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, 64))
    .replace(/^﻿/, '')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<svg') || head.startsWith('<?xml');
}

/**
 * DDR-231 security (adversarial pass, F1) — the capture bridge lives in the
 * CANVAS iframe, and tenant-authored TSX executes in that same window, so
 * tenant code can FORGE an `export-capture-done` reply carrying arbitrary bytes
 * + name that passes the shell's `e.source` check. Before the shell writes any
 * of it to disk, treat the whole reply as untrusted DATA:
 *   - cap the item count and total bytes (a forged reply must not drive 1000
 *     downloads or buffer a giant blob);
 *   - for each item, SNIFF the leading magic bytes and reject anything that
 *     isn't actually the requested format (an HTML/exe payload disguised as a
 *     `.png` is dropped, not merely relabelled);
 *   - derive the filename from the request, not the reply, and force the
 *     format's extension + MIME.
 *
 * @param {Array<{ name?: string, blob: Blob }>} items
 * @param {string} format 'png' | 'svg'
 * @returns {Promise<Array<{ name: string, blob: Blob }>>}
 */
export async function sanitizeCapturedItems(items, format) {
  if (!Array.isArray(items) || !items.length) throw new Error('capture returned nothing');
  if (items.length > MAX_CAPTURE_ITEMS)
    throw new Error(`capture returned too many items (${items.length})`);
  const mime = SAFE_CAPTURE_MIME[format] || 'application/octet-stream';
  const out = [];
  let total = 0;
  for (const item of items) {
    if (!(item?.blob instanceof Blob)) throw new Error('capture item is not a blob');
    total += item.blob.size;
    if (total > MAX_CAPTURE_TOTAL_BYTES) throw new Error('capture payload too large');
    const head = new Uint8Array(await item.blob.slice(0, 64).arrayBuffer());
    if (!magicMatches(head, format))
      throw new Error(`capture item is not a valid ${format} — refusing to download`);
    out.push({
      name: safeCaptureName(item.name, format),
      // Re-wrap so the download Content-Type is the format's MIME regardless of
      // what the (untrusted) reply claimed.
      blob: new Blob([item.blob], { type: mime }),
    });
  }
  return out;
}

/**
 * Fold the dialog's resolution options (scale multiplier OR physical dpi —
 * dpi wins, mirroring exporters/png.ts resolveDeviceScale) into the capture
 * bridge's deviceScale, clamped to the raster guard's 1–8 window
 * (capture-core.ts assertRasterSizeOk enforces the byte/side ceilings).
 *
 * @param {{ dpi?: number, scale?: number }} [options]
 * @returns {number}
 */
export function captureScale(options = {}) {
  return Math.max(1, Math.min(8, options.dpi ? options.dpi / 96 : options.scale || 1));
}

/**
 * Record a browser-lane export in the cell's ledger so it shows up in the
 * Recent tab and the notification center like every other export.
 *
 * DDR-231 Phase 2 T6: the browser lane produces the file in the member's own
 * browser, so there is no job to complete and nothing wrote a history row —
 * the reported symptom was "the modal just closes and I see nothing in the
 * export dialog". Best-effort by design: the member already HAS the file, so a
 * failed ledger write must never surface as a failed export.
 *
 * @param {{ format: string, scope: string, filename: string }} entry
 * @returns {Promise<void>}
 */
export async function recordBrowserExport(entry) {
  try {
    await fetch('/_api/export-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    /* the file is already saved — the ledger is a convenience, not the export */
  }
}
