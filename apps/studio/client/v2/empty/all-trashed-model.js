// client/v2/empty/all-trashed-model.js — S11.5: "Every artboard moved to the trash", as data and words (pure; no React).
//
// 05 Empty States › es-all-trashed. The canvas has no artboards left, the Trash holds them (S1.7: items of kind
// 'artboard', newest first), and this module turns that list into what the card says and does:
//   - which items are this canvas's, and the words for them ("Jonas moved all four to the trash 10 min ago.");
//   - Restore N: one `POST /_api/trash/restore { id }` per artboard, in order, each id once (S1.13's splice puts an
//     artboard back where it was; the route is the one the Trash view uses). The answers' action ids are kept so the
//     toast's Undo takes all of them back in ONE undo step (`POST /_api/project/undo { actionIds }`);
//   - the outlines the canvas keeps (ghosts): where each artboard stood, read from the canvas as it was one version
//     before the trash action (`GET /_api/project/source`), because a trash item carries no position.
//
// Names and labels come from the server's own list. Nothing here is taken from the canvas (DDR-054): the canvas is
// told what to draw (`trashed-artboards`), it never says what is in the Trash.
// Words follow CONTRACT §3 (artboard, "moved to the trash") and §4 (counts read for 1 and for many; "You").

/** The app shell relays the bus's `trash:changed { seq }` as this window event (S1.8's `use-trash.js`). */
export const TRASH_CHANGED_EVENT = 'maude:trash-changed';

const COUNT_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/** The ghosts the canvas is told about are capped; the card's count is not. */
export const GHOSTS_MAX = 200;

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "just now" · "10 min ago" · "3 h ago" · "yesterday" · "on 6 Oct, 14:05" (CONTRACT §4: relative first, 24-hour). */
export function agoWord(at, now = Date.now()) {
  const d = new Date(at);
  const n = new Date(now);
  if (Number.isNaN(d.getTime())) return 'earlier';
  const gone = now - at;
  if (gone < 60_000) return 'just now';
  if (gone < 3_600_000) return `${Math.floor(gone / 60_000)} min ago`;
  if (sameDay(d, n)) return `${Math.floor(gone / 3_600_000)} h ago`;
  const yesterday = new Date(n);
  yesterday.setDate(n.getDate() - 1);
  if (sameDay(d, yesterday)) return 'yesterday';
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `on ${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "You" when this session trashed it, else the name the server sent; nobody nameable reads "Someone". */
export function whoWord(item) {
  if (item?.mine === true) return 'You';
  if (typeof item?.who === 'string' && item.who) return item.who;
  if (typeof item?.actor === 'string' && item.actor.startsWith('local:')) return 'You';
  return 'Someone';
}

/** "four" for the sentence ("moved all four"); one artboard reads "of it", past ten the digits. */
export function countWord(n) {
  if (n === 1) return 'of it';
  return n >= 2 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

/** "Restore 4 artboards" · "Restore 1 artboard" — the real noun for 1 and for many. */
export function restoreLabel(n) {
  return `Restore ${n} ${n === 1 ? 'artboard' : 'artboards'}`;
}

/** The Trash's artboard items that belong to this canvas (design-root-relative path) and can be restored alone. */
export function canvasTrashedItems(items, canvasPath) {
  if (!Array.isArray(items) || !canvasPath) return [];
  return items.filter(
    (i) =>
      i &&
      i.kind === 'artboard' &&
      i.canvasTrashed !== true &&
      i.path === canvasPath &&
      typeof i.id === 'string'
  );
}

/** The canvas's name for the card: no folder, no extension. */
export function canvasNameOf(path) {
  return (
    String(path || '')
      .split('/')
      .pop()
      .replace(/\.(tsx|jsx|html)$/i, '') || 'This canvas'
  );
}

/**
 * What the card shows, or null when this canvas has nothing of its own in the Trash.
 * The newest item speaks for the moment ("Jonas … 10 min ago"); the count is every artboard of this canvas.
 */
export function allTrashedModel(items, canvasPath, now = Date.now()) {
  const mine = canvasTrashedItems(items, canvasPath);
  if (mine.length === 0) return null;
  const newest = mine.reduce((a, b) => (b.at > a.at ? b : a));
  return {
    canvasPath,
    items: mine,
    count: mine.length,
    restoreLabel: restoreLabel(mine.length),
    vars: {
      canvas: canvasNameOf(canvasPath),
      who: whoWord(newest),
      countWord: countWord(mine.length),
      ago: agoWord(newest.at, now),
      count: mine.length,
    },
  };
}

/** Should the card be drawn? The canvas holds no artboard, it has loaded, and the Trash has some of its own. */
export function showAllTrashed({ artboardCount, ready, model }) {
  return ready === true && artboardCount === 0 && model != null;
}

/* ----------------------------------------------------------------------------------- Restore N */

async function postJson(fetchImpl, url, body) {
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/**
 * Restore every item, one `POST /_api/trash/restore` each, in order and each id once (each splice reads the head
 * the one before it left). A refusal stops nothing: the rest still come back, and the line says how many did.
 * @returns {Promise<{ restored: string[], failed: { id: string, status: number, reason: string, line: string|null }[], actionIds: string[] }>}
 */
export async function restoreAll(items, { fetchImpl = globalThis.fetch } = {}) {
  const restored = [];
  const failed = [];
  const actionIds = [];
  for (const item of items) {
    const { status, data } = await postJson(fetchImpl, '/_api/trash/restore', { id: item.id });
    if (status >= 200 && status < 300 && data?.ok !== false) {
      restored.push(item.id);
      if (typeof data?.actionId === 'string') actionIds.push(data.actionId);
    } else {
      failed.push({
        id: item.id,
        status,
        reason:
          typeof data?.reason === 'string' ? data.reason : status === 0 ? 'unreachable' : 'refused',
        line: typeof data?.line === 'string' ? data.line : null,
      });
    }
  }
  return { restored, failed, actionIds };
}

const noun = (n) => `${n} ${n === 1 ? 'artboard' : 'artboards'}`;

/**
 * The toast / the card's foot for an outcome: what happened · what is safe · one verb (CONTRACT §4).
 * `undo` is the action ids the toast's Undo takes back together — only when every restore named its action.
 */
export function restoreOutcome(result, asked) {
  const { restored, failed, actionIds } = result;
  if (failed.length === 0) {
    const undo = actionIds.length === restored.length && actionIds.length > 0 ? actionIds : null;
    return {
      ok: true,
      line: `${noun(restored.length)} ${restored.length === 1 ? 'is' : 'are'} back where ${restored.length === 1 ? 'it was' : 'they were'}.`,
      undo,
    };
  }
  const first = failed[0];
  const why = first.line ?? REFUSALS[first.reason] ?? 'It could not be put back.';
  if (restored.length === 0) return { ok: false, line: `${why} Nothing was changed.`, undo: null };
  return {
    ok: false,
    line: `${restored.length} of ${asked} came back. ${why} The rest are still in the trash.`,
    undo: actionIds.length === restored.length ? actionIds : null,
  };
}

const REFUSALS = {
  forbidden: 'Your role in this project can’t restore artboards.',
  'not-in-scope': 'Your role in this project can’t restore artboards.',
  'canvas-trashed': 'The canvas is in the trash too — restore it first.',
  'not-in-trash': 'Someone already restored it.',
  cleared: 'It was cleared out of the trash.',
  unreachable: 'The team server did not answer.',
  'not-yet': 'Restoring one artboard comes with Version history.',
};

/** The toast's Undo: every restore of this card as ONE step. Resolves to whether it went through. */
export async function undoRestore(actionIds, { fetchImpl = globalThis.fetch } = {}) {
  const { status, data } = await postJson(fetchImpl, '/_api/project/undo', { actionIds });
  return status >= 200 && status < 300 && data?.ok !== false;
}

/* --------------------------------------------------------------------------------------- Ghosts */

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dimOf(tag, name) {
  const m = new RegExp(`\\b${name}=(?:\\{\\s*(\\d+(?:\\.\\d+)?)\\s*\\}|"(\\d+(?:\\.\\d+)?)")`).exec(
    tag
  );
  return m ? Number(m[1] ?? m[2]) : null;
}

/**
 * Where each artboard stood, from the canvas as it was before it moved to the trash: x / y from the meta lane's
 * `layout.artboards[]` (DDR-027: positions only), width / height from the JSX (`<DCArtboard id width height>` is
 * size-authoritative). An artboard whose place or size cannot be read gets `rect: null` — the card still shows,
 * only that outline is left out.
 * @param {string|null} metaText @param {string|null} htmlText @param {string[]} ids
 * @returns {Record<string, {x:number,y:number,w:number,h:number}|null>}
 */
export function rectsFromVersion(metaText, htmlText, ids) {
  let layout = [];
  try {
    const j = JSON.parse(metaText ?? 'null');
    if (Array.isArray(j?.layout?.artboards)) layout = j.layout.artboards;
  } catch {
    /* unreadable meta: no places */
  }
  const out = {};
  for (const id of ids) {
    const at = layout.find((a) => a && a.id === id);
    const q = escapeRe(id);
    const tag = new RegExp(
      `<DCArtboard\\b[^>]*?\\bid=(?:"${q}"|\\{\\s*["']${q}["']\\s*\\})[^>]*>`,
      's'
    ).exec(htmlText ?? '')?.[0];
    const w = tag ? dimOf(tag, 'width') : null;
    const h = tag ? dimOf(tag, 'height') : null;
    out[id] = at && num(at.x) && num(at.y) && w && h ? { x: at.x, y: at.y, w, h } : null;
  }
  return out;
}

const rectCache = new Map();

/** Forget the places already read (a test seam; a real session keeps them — a trash action never changes). */
export function resetGhostCache() {
  rectCache.clear();
}

async function laneAt(fetchImpl, path, rev, lane) {
  try {
    const r = await fetchImpl(
      `/_api/project/source?path=${encodeURIComponent(path)}&at=${encodeURIComponent(`r${rev}`)}&lane=${lane}`
    );
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.ok === true && typeof j.source === 'string' ? j.source : null;
  } catch {
    return null;
  }
}

/**
 * The outlines to keep: `[{ id, label, rect }]` for the card's items. One read pair per trash action (all four
 * artboards usually went in one). A person who cannot export (Can view) is refused the source: every rect is null
 * and the canvas draws no outline — the card still tells them what happened.
 */
export async function loadGhosts(model, { fetchImpl = globalThis.fetch } = {}) {
  const byRev = new Map();
  for (const item of model.items) {
    const list = byRev.get(item.rev) ?? [];
    list.push(item);
    byRev.set(item.rev, list);
  }
  const ghosts = [];
  for (const [rev, items] of byRev) {
    const key = `${model.canvasPath}@${rev}:${items.map((i) => i.artboard).join(',')}`;
    let rects = rectCache.get(key);
    if (!rects) {
      const before = Math.max(0, Number(rev) - 1);
      const [meta, html] = await Promise.all([
        laneAt(fetchImpl, model.canvasPath, before, 'meta'),
        laneAt(fetchImpl, model.canvasPath, before, 'html'),
      ]);
      rects = rectsFromVersion(
        meta,
        html,
        items.map((i) => i.artboard)
      );
      if (meta !== null && html !== null) {
        rectCache.set(key, rects);
        if (rectCache.size > 64) rectCache.delete(rectCache.keys().next().value);
      }
    }
    for (const i of items) {
      ghosts.push({
        id: i.artboard,
        label: (i.label || i.artboard || '').slice(0, 200),
        rect: rects[i.artboard] ?? null,
      });
    }
  }
  return ghosts.slice(0, GHOSTS_MAX);
}
