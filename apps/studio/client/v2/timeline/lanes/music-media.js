// client/v2/timeline/lanes/music-media.js — S7.12: what the Music lane and the Music inspector read, in one store.
//
//   · `GET /_api/comp-media?canvas&artboard` → `music[]` (each Music clip with its beats, bars, bpm, volume and
//     dip), `speech[]`, `fps` — the server's own derivation (video/derive.ts), so the lane can not disagree with
//     what the canvas build and the export play;
//   · `artboardMeta[id].snap` through `GET /_api/canvas-meta` and `PATCH /_api/present-meta { snap }` (the S7.8
//     poster route: Can edit and up, refused below that by the server whatever the UI shows);
//   · "Find the beat": `POST /_api/media-analysis { asset, kind: "beats", bpm? }`, then the sidecar shows up in the
//     next comp-media read. Half · Double send the new `bpm` (the beats verb re-tracks and keeps the bar phase).
//
// A plain module store (like `poster.js`): the Timeline feeds it, the lane and the inspector subscribe to it.
// No DOM; every function takes its `fetch`.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { MUSIC_WORDS } from './music-model.js';

const keyOf = (canvas, artboardId) => `${canvas}\u0000${artboardId ?? ''}`;
const media = new Map(); // key → comp-media answer
const snaps = new Map(); // key → 'beat' | 'off' | null (null = the default)
const finding = new Set(); // `${canvas}\u0000${src}` while a beat search runs
const subs = new Set();
let version = 0;
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};
const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
const snapshot = () => version;

/** Re-renders when the media, a snap choice or a beat search changes. */
export function useMusicVersion() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export const compMediaUrl = (canvas, artboardId) =>
  `/_api/comp-media?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboard=${encodeURIComponent(artboardId)}` : ''}`;

/** The last comp-media answer for a video artboard, or null. */
export const mediaOf = (canvas, artboardId) => media.get(keyOf(canvas, artboardId)) ?? null;

/** The Music clip with this stable id (a clip's own, or a loose bed's `loose:…`), or null. */
export function musicEntry(canvas, artboardId, stableId) {
  return (mediaOf(canvas, artboardId)?.music ?? []).find((m) => m.stableId === stableId) ?? null;
}

/** Fetch and keep the media of one video artboard. Resolves the answer, or null (never throws). */
export async function loadCompMedia(canvas, artboardId, fetchImpl = globalThis.fetch) {
  if (!canvas) return null;
  try {
    const r = await fetchImpl(compMediaUrl(canvas, artboardId));
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    if (!body || !Array.isArray(body.music)) throw new Error('shape');
    const key = keyOf(canvas, artboardId);
    if (JSON.stringify(media.get(key)) !== JSON.stringify(body)) {
      media.set(key, body);
      notify();
    }
    return body;
  } catch {
    return null; // an older server answers no `music`: the lane simply draws no ticks
  }
}

// ── Snap to the beat (`video.snap`, artboardMeta.snap) ─────────────────────────────────────────────────
/** The stored choice for this artboard (`null` = the default, which `snapMode` resolves). */
export const storedSnap = (canvas, artboardId) => snaps.get(keyOf(canvas, artboardId)) ?? null;

export async function loadSnap(canvas, artboardId, fetchImpl = globalThis.fetch) {
  if (!canvas || !artboardId) return;
  try {
    const r = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(canvas)}`);
    if (!r.ok) throw new Error(String(r.status));
    const meta = await r.json();
    const s = meta?.artboardMeta?.[artboardId]?.snap;
    const next = s === 'beat' || s === 'off' ? s : null;
    if (snaps.get(keyOf(canvas, artboardId)) !== next) {
      snaps.set(keyOf(canvas, artboardId), next);
      notify();
    }
  } catch {
    // the default stays
  }
}

/** Store the choice (`null` = back to the default). Resolves `{ ok, message }` — the words are the toast's. */
export async function saveSnap(canvas, artboardId, mode, fetchImpl = globalThis.fetch) {
  const key = keyOf(canvas, artboardId);
  const before = snaps.get(key) ?? null;
  snaps.set(key, mode);
  notify();
  try {
    const r = await fetchImpl('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: canvas, snap: { [artboardId]: mode } }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    const kept = body?.snap?.[artboardId];
    snaps.set(key, kept === 'beat' || kept === 'off' ? kept : null);
    notify();
    return { ok: true, message: '' };
  } catch (e) {
    snaps.set(key, before);
    notify();
    return {
      ok: false,
      message: /403/.test(String(e?.message))
        ? 'Your role can’t change Snap to the beat.'
        : 'Not saved — Snap to the beat stays as it was.',
    };
  }
}

// ── Find the beat (`video.music.beats`) ────────────────────────────────────────────────────────────────
const findKey = (canvas, src) => `${canvas}\u0000${src}`;
export const isFinding = (canvas, src) => finding.has(findKey(canvas, src));

/**
 * Ask the studio to find the beat of one song (and to re-track it at `bpm` when given), then wait for the
 * sidecar to show up in the comp's media. Resolves `{ ok, message }`; never throws.
 * @param {{ canvas: string, artboardId?: string, src: string, bpm?: number, fetchImpl?: typeof fetch,
 *   wait?: (ms: number) => Promise<void>, tries?: number }} o
 */
export async function findBeats({
  canvas,
  artboardId,
  src,
  bpm,
  fetchImpl = globalThis.fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  tries = 40,
}) {
  const key = findKey(canvas, src);
  if (finding.has(key)) return { ok: true, message: '' };
  finding.add(key);
  notify();
  try {
    const before = (mediaOf(canvas, artboardId)?.music ?? []).find((m) => m.src === src)?.grid;
    const r = await fetchImpl('/_api/media-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asset: src, kind: 'beats', ...(bpm ? { bpm } : {}) }),
    });
    if (!r.ok) throw new Error(String(r.status));
    for (let i = 0; i < tries; i++) {
      const m = await loadCompMedia(canvas, artboardId, fetchImpl);
      const g = (m?.music ?? []).find((x) => x.src === src)?.grid;
      if (g && (!before || (bpm ? Math.abs(g.bpm - bpm) < 0.5 : true)))
        return { ok: true, message: '' };
      await wait(1500);
    }
    return { ok: false, message: MUSIC_WORDS.beatsFailed };
  } catch (e) {
    return {
      ok: false,
      message: /403/.test(String(e?.message))
        ? 'Your role can’t find the beat.'
        : MUSIC_WORDS.beatsFailed,
    };
  } finally {
    finding.delete(key);
    notify();
  }
}

/**
 * The Timeline's feed: keeps the media and the snap choice of the followed artboard current while the comp has
 * any music (`enabled`), refetching when the comp's shape (`rev`) changes. Returns the media (or null).
 */
export function useCompMedia({ canvas, artboardId, enabled, rev, fetchImpl }) {
  const v = useMusicVersion();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !canvas || !artboardId) return undefined;
    let live = true;
    void loadCompMedia(canvas, artboardId, fetchImpl).then(() => live && setTick((n) => n + 1));
    void loadSnap(canvas, artboardId, fetchImpl);
    return () => {
      live = false;
    };
    // `rev` is the comp's own signature: a trim, a move or a new song changes it
  }, [canvas, artboardId, enabled, rev, fetchImpl]);
  void v;
  return enabled && canvas && artboardId ? mediaOf(canvas, artboardId) : null;
}

/** Test seam: forget everything the store holds. */
export function resetMusicMedia() {
  media.clear();
  snaps.clear();
  finding.clear();
  notify();
}
