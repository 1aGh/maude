// client/v2/ds/master-write.js — S10.10: a component master edited in place becomes waiting declaration patches
// (13 · ds-edit-master). Nothing here writes a CSS file. An edit is `POST /_api/ds/pending {ds, components}`: it waits
// as `dsPending.components[<Master>][.<class>][<prop>]` ("1 change waiting" in the Design system bar) and reaches
// canvases only through "Update N canvases" (S10.8), where the engine writes it into `preview/_components.css`
// (ds/generate.ts `generateComponentsCss`: replaced in the matching top-level rule, appended to it, or the rule
// appended at the end). The same functions back the registry action `ds.set-master`, so the panel and an agent do
// one thing.
//
// Unlike a token, a master's patches MERGE per declaration on the server — no `expect`/clash dance: two people
// editing different properties of the same master never meet, and the later edit of the same property wins.

import { fetchBoard } from './token-write.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

/** The four things a master's panel changes, in the order it draws them. */
export const MASTER_ROWS = Object.freeze([
  { prop: 'border-radius', label: 'Corners', unit: 'px' },
  { prop: 'background', label: 'Fill', unit: null },
  { prop: 'color', label: 'Text', unit: null },
  { prop: 'height', label: 'Height', unit: 'px' },
]);
const PROPS = new Set(MASTER_ROWS.map((r) => r.prop));

export const MASTER_WORDS = Object.freeze({
  forbidden: 'You can look here; ask to edit.',
  offline: 'Not changed. This Mac isn’t connected; try again.',
  invalid: 'That isn’t a value this can take.',
  unknown: 'This component isn’t in the system.',
  unreachable: 'Not changed. The studio could not be reached; try again.',
  failed: 'Not changed; try again.',
  converted: 'Turn this folder into a Design system canvas first.',
  noClass: 'This component has no style to change.',
});

export function masterWords(code) {
  switch (code) {
    case 'forbidden':
      return MASTER_WORDS.forbidden;
    case 'ds-kernel-unavailable':
      return MASTER_WORDS.offline;
    case 'ds-pending-invalid':
      return MASTER_WORDS.invalid;
    case 'ds-not-converted':
      return MASTER_WORDS.converted;
    case 'unreachable':
      return MASTER_WORDS.unreachable;
    default:
      return MASTER_WORDS.failed;
  }
}

/** The value text the person typed, as one declaration value; a bare number is px where a length is meant. */
export function cleanMasterValue(prop, raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let v = String(raw).trim();
  if (!v || v.length > 240) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  if (/[;{}<>\\@]|\/\*|url\s*\(/i.test(v) || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return null;
  const row = MASTER_ROWS.find((r) => r.prop === prop);
  if (row?.unit && /^-?\d+(\.\d+)?$/.test(v) && Number(v) !== 0) v = `${v}${row.unit}`;
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return null;
  }
  return depth === 0 ? v : null;
}

/** The master's selector — the class `components.json` declares for it. */
export const selectorOf = (master) =>
  master?.className && /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(master.className)
    ? `.${master.className}`
    : null;

/** What a row shows: a waiting edit over the file's own value. */
export function currentMasterValue(master, prop) {
  const sel = selectorOf(master);
  const waiting = sel
    ? (master.patches ?? []).filter((p) => p.selector === sel && p.prop === prop).pop()
    : null;
  return waiting?.value ?? master?.look?.[prop] ?? '';
}

/** The patch after one edit, or a word. `edit` = { prop, value }. */
export function buildMasterPatch(master, edit) {
  if (!master) return { refused: MASTER_WORDS.unknown };
  const selector = selectorOf(master);
  if (!selector) return { refused: MASTER_WORDS.noClass };
  if (!PROPS.has(edit?.prop)) return { refused: MASTER_WORDS.invalid };
  const value = cleanMasterValue(edit.prop, edit.value);
  if (value === null) return { refused: MASTER_WORDS.invalid };
  return {
    components: { [master.name]: { [selector]: { [edit.prop]: { value } } } },
    selector,
    value,
  };
}

async function postPending(ds, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl('/_api/ds/pending', {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ds, ...body }),
    });
  } catch {
    return { ok: false, code: 'unreachable' };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by status */
  }
  return res.ok
    ? { ok: true, body: json }
    : { ok: false, code: json?.code ?? (res.status === 403 ? 'forbidden' : 'failed') };
}

/**
 * Write one edit. `model` is the board the person saw; without it (an action an agent runs) the board is read
 * right now.
 * @returns {Promise<{ ok: true, master: any } | { ok: false, code: string, message: string }>}
 */
export async function writeMaster({ ds, name, edit, model = null }, fetchImpl = globalThis.fetch) {
  const board = model ?? (await fetchBoard(ds, fetchImpl));
  if (!board) return { ok: false, code: 'unreachable', message: MASTER_WORDS.unreachable };
  const master = board.components.find((c) => c.name === name) ?? null;
  const built = buildMasterPatch(master, edit);
  if (built.refused) return { ok: false, code: 'refused', message: built.refused };
  const r = await postPending(ds, { components: built.components }, fetchImpl);
  return r.ok
    ? { ok: true, master }
    : { ok: false, code: r.code, message: masterWords(r.code) };
}

/** Registry `ds.set-master` (menu-runner): the same write, a sentence back. */
export async function runMasterAction(p, fetchImpl = globalThis.fetch) {
  const ds = typeof p?.ds === 'string' ? p.ds : '';
  const name = typeof p?.component === 'string' ? p.component : '';
  if (!ds || !name) return { ok: false, message: MASTER_WORDS.failed };
  const r = await writeMaster({ ds, name, edit: { prop: p?.prop, value: p?.value } }, fetchImpl);
  return r.ok ? { ok: true, message: '1 change waiting.' } : { ok: false, message: r.message };
}
