// client/v2/assets/takes.js — a generated picture's takes, the shell half (S8.16; 12 · ia-gen-placed).
//
// The studio says which takes a placed picture has (`GET /_api/generate-takes/of?asset=&canvas=` — the takes in
// generation order, "Take 3 of 4" and its Made by AI line). This file keeps one answer per (canvas, picture) the
// person selected (`pictureOfSelection`), tells the open canvas which of its pictures have other takes
// (`gen-takes`, so ← → there are a take step and not a nudge), and steps: `stepTake('next' | 'prev')` is the
// `image.replace` edit-op aimed at the neighbouring take — one src rewrite, one write, one undo step (decision
// maude/v2-S8.16-take-switch-is-image-replace). Nothing here throws.

import { neighbourTake } from '../../../generation/takes.ts';
import { legacyRecordPayload } from '../../edit-op-relay.ts';

const ASSET_RE = /assets\/[0-9a-f]{8}\.[A-Za-z0-9]{1,8}/;
const ASSET_RE_G = new RegExp(ASSET_RE.source, 'g');

/**
 * The picture a shell selection points at — the same reading as the inspector's `photoAssetOfSelection`
 * (inspector-panel.jsx; not imported: that module's graph imports this one): the stamped `photoAsset`, else the one
 * `data-photo-asset` / content-addressed `<img>` inside a wrapper, else the `<img>`'s own src.
 */
export function pictureOfSelection(el) {
  if (!el || Array.isArray(el)) return null;
  if (typeof el.photoAsset === 'string') return el.photoAsset;
  const html = typeof el.html === 'string' ? el.html : '';
  const tagged = [...new Set([...html.matchAll(/data-photo-asset="([^"]+)"/g)].map((m) => m[1]))];
  if ((el.tag || '').toLowerCase() !== 'img') {
    const imgs = [...new Set(html.match(ASSET_RE_G) || [])];
    if (tagged.length === 1) return tagged[0];
    if (tagged.length === 0 && imgs.length === 1 && /<img/i.test(html)) return imgs[0];
    return null;
  }
  if (tagged[0]) return tagged[0];
  const m = ASSET_RE.exec(`${el.attrs?.src || ''} ${html}`);
  return m ? m[0] : null;
}

/** `${canvas}\n${asset}` → the `/of` answer ({ takes, index, of, label, madeByAi }) */
const answers = new Map();
/** in-flight asks, so one picture is asked once */
const asking = new Map();
const subs = new Set();
/** the last step per picture ref: the canvas re-selects after the write, until then the selection still names `from` */
const stepped = new Map();

const keyOf = (canvas, asset) => `${canvas}\n${asset}`;
const notify = () => {
  for (const fn of subs) {
    try {
      fn();
    } catch {
      /* a listener's fault is its own */
    }
  }
};

/** Tests only. */
export function resetTakes() {
  answers.clear();
  asking.clear();
  stepped.clear();
  notify();
}

export function subscribeTakes(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** `assets/<sha8>.<ext>` of a path the studio or the canvas wrote (`/assets/…`, `/.design/assets/…`). */
export function assetPath(src) {
  const m = ASSET_RE.exec(String(src ?? ''));
  return m ? m[0] : null;
}

const refKey = (ref) =>
  ref ? `${ref.artboard}\u0000${ref.element}\u0000${ref.occurrence ?? 0}` : '';

/**
 * The one selected picture: its asset and its ref (what the edit-op names), or null.
 * `selected` is what the shell holds (one element, an array, or null).
 */
export function selectedPicture(selected) {
  const el = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  if (!el || !el.id) return null;
  const asset = assetPath(pictureOfSelection(el));
  const ref =
    Array.isArray(el.refs) && el.refs[0]
      ? el.refs[0]
      : el.artboardId
        ? {
            artboard: el.artboardId,
            element: el.id,
            ...(Number.isInteger(el.index) && el.index > 0 ? { occurrence: el.index } : {}),
          }
        : null;
  if (!asset || !ref) return null;
  const s = stepped.get(refKey(ref));
  return { asset: s && s.from === asset ? s.to : asset, ref };
}

/** The answer we hold for this picture (sync), or null. */
export function cachedTakes(canvas, asset) {
  return (canvas && asset && answers.get(keyOf(canvas, asset))) || null;
}

/** The takes of `asset` on `canvas`: asked once, then held. Null when the studio has none to say. */
export async function takesOf(canvas, asset, opts = {}) {
  if (!canvas || !asset) return null;
  const k = keyOf(canvas, asset);
  if (answers.has(k)) return answers.get(k);
  if (asking.has(k)) return asking.get(k);
  const get = opts.fetch ?? globalThis.fetch;
  const p = (async () => {
    try {
      const q = new URLSearchParams({ asset, canvas });
      const r = await get(`/_api/generate-takes/of?${q}`);
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (!j?.ok || !Array.isArray(j.takes)) return null;
      const a = {
        takes: j.takes.filter((t) => typeof t === 'string'),
        index: Number.isInteger(j.index) ? j.index : -1,
        of: Number.isInteger(j.of) ? j.of : j.takes.length,
        label: typeof j.label === 'string' ? j.label : null,
        madeByAi: j.madeByAi && typeof j.madeByAi === 'object' ? j.madeByAi : null,
      };
      answers.set(k, a);
      notify();
      return a;
    } catch {
      return null;
    } finally {
      asking.delete(k);
    }
  })();
  asking.set(k, p);
  return p;
}

/**
 * Hold what a finished group says for every take at once (Generate placed the best: no `/of` round trip is needed for
 * ← → to work right away). `madeByAi` is the group's line.
 */
export function primeTakes(canvas, takes, madeByAi = null) {
  if (!canvas || !Array.isArray(takes) || takes.length === 0) return;
  takes.forEach((asset, index) => {
    answers.set(keyOf(canvas, asset), {
      takes: takes.slice(),
      index,
      of: takes.length,
      label: takes.length > 1 ? `Take ${index + 1} of ${takes.length}` : null,
      madeByAi,
    });
  });
  notify();
}

/** The pictures of `canvas` that have other takes — what `gen-takes` sends. */
export function takeAssetsOf(canvas) {
  const out = new Set();
  for (const [k, a] of answers) {
    if (!k.startsWith(`${canvas}\n`) || a.takes.length < 2) continue;
    for (const t of a.takes) out.add(t);
  }
  return [...out].sort().slice(0, 256);
}

/** The registry fact `selectionHasTakes`: the one selected picture has other takes (as far as we know yet). */
export function selectionHasTakes(selected, canvas) {
  const pic = selectedPicture(selected);
  const a = pic ? cachedTakes(canvas, pic.asset) : null;
  return !!a && a.takes.length > 1;
}

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. That is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
};

/**
 * ← / → on the selected picture: put the previous / next take in its place.
 * @param {'next' | 'prev'} dir
 * @param {{ canvas: string, selected: unknown, fetch?: typeof fetch, record?: (payload: object) => void }} env
 * @returns {Promise<{ ok: true, asset: string, label: string } | { ok: false, message?: string }>}
 */
export async function stepTake(dir, env) {
  const canvas = env?.canvas;
  const pic = selectedPicture(env?.selected);
  if (!canvas || !pic) return { ok: false };
  const a = cachedTakes(canvas, pic.asset) ?? (await takesOf(canvas, pic.asset, env));
  const n = a ? neighbourTake(a.takes, pic.asset, dir === 'prev' ? 'prev' : 'next') : null;
  if (!n) return { ok: false };
  const get = env.fetch ?? globalThis.fetch;
  let res;
  let body = null;
  try {
    res = await get('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: canvas,
        op: 'image.replace',
        targets: [pic.ref],
        params: { asset: n.asset },
      }),
    });
    body = await res.json().catch(() => null);
  } catch {
    return { ok: false, message: 'Not changed. The studio could not be reached; try again.' };
  }
  if (!body?.ok) return { ok: false, message: SAID[body?.code] ?? body?.message ?? undefined };
  const payload = legacyRecordPayload(body, n.label);
  if (payload) env.record?.(payload);
  stepped.set(refKey(pic.ref), { from: pic.asset, to: n.asset });
  answers.set(keyOf(canvas, n.asset), {
    ...a,
    index: n.index,
    of: n.of,
    label: n.label,
  });
  notify();
  return { ok: true, asset: n.asset, label: n.label };
}
