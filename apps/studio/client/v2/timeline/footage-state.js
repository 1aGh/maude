// client/v2/timeline/footage-state.js — S7.16: footage that is not here yet, and footage still preparing (07 · ve-footage).
//
//   waiting    "Dron klesá · waiting for Jonas's Mac" — the file is on someone's device and has not synced. QUIET: no
//              error, no Relink… (it arrives by itself). The words are asset-placeholder.tsx `frameWords`, the one
//              place that decides whose Mac it is — a name only, never an address, "Not here yet" when unsure.
//   missing    "…· missing" — only when no device has it. This is the one state that offers Relink….
//   preparing  "IMG_4471.mov · 4K  62%" — this Mac still owes the hub the bytes (the studio's `uploading`), with the
//              share done when the studio knows it. The clip plays; the percent says it is still being prepared.
//
// Waiting is NOT missing (rule `not-here-yet-vs-missing`, Gate 0 register): the two never share a class, a word or a
// button. The state comes from the studio's own answer for the open canvas (assets/asset-state-lane.js — S8.19), the
// same one the canvas's placeholder frame and the Inspector's absent-picture box read; this file adds no request.
//
// PURE except `useFootageAnswers` (one useSyncExternalStore over the lane's answers).

import { useSyncExternalStore } from 'react';
import { frameWords } from '../../../asset-placeholder.tsx';
import {
  assetAnswersVersion,
  assetItemForSrc,
  subscribeAssetAnswers,
} from '../assets/asset-state-lane.js';

/** The words the Inspector and the Timeline say about footage (CONTRACT §3–§4: what happened, what is safe, one verb). */
export const FOOTAGE_WORDS = Object.freeze({
  file: 'File',
  status: 'Status',
  /** Under a waiting clip: the edit is not at risk. */
  safeWaiting: 'Your edit is safe. It plays once the file arrives.',
  /** Under a missing clip: still safe; the one verb is Relink…. */
  safeMissing: 'Your edit is safe. Relink the file and it plays again.',
  preparingNote: 'Still preparing — it plays while it finishes.',
  relink: 'Relink…',
  /** "3 clips still preparing" (the island header, with a sync glyph). */
  preparing: (n) => `${n} ${n === 1 ? 'clip' : 'clips'} still preparing`,
});

/** The file name a media src ends in: `assets/9f3a.mov?v=2` → `9f3a.mov`. */
export const fileNameOf = (src) =>
  String(src ?? '')
    .replace(/[?#].*$/, '')
    .split('/')
    .pop() || '';

/** "Waiting for Jonas's Mac" → "waiting for Jonas's Mac" (a state inside a clip's name reads lower-case, 07 · ve-footage). */
const lower = (line) => `${line.charAt(0).toLowerCase()}${line.slice(1)}`;

/**
 * What the studio's answer for one picture means for a clip.
 * @param {{ state?: string, who?: object, syncing?: boolean, progress?: number } | null | undefined} item
 * @returns {null | { kind: 'waiting'|'missing'|'preparing', line: string, pct: number|null, relink: boolean }}
 *   null = here (or not known): nothing to say.
 */
export function footageOf(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.state === 'uploading') {
    const p = item.progress;
    const pct =
      typeof p === 'number' && Number.isFinite(p)
        ? Math.round(Math.min(1, Math.max(0, p)) * 100)
        : null;
    return { kind: 'preparing', line: FOOTAGE_WORDS.preparingNote, pct, relink: false };
  }
  const words = frameWords(item);
  if (!words) return null;
  if (words.state === 'missing')
    return { kind: 'missing', line: words.line, pct: null, relink: true };
  return { kind: 'waiting', line: words.line, pct: null, relink: false };
}

/** The footage state of the clip whose media is `src`, in the canvas `canvas` (null = nothing to say). */
export const footageForSrc = (canvas, src) => footageOf(assetItemForSrc(canvas, src));

/**
 * A clip's drawn name: "Dron klesá · waiting for Jonas's Mac". A missing clip says only "missing" (the line under it
 * in the inspector says why); a preparing clip keeps its own name and shows the percent as a chip beside it.
 */
export function clipNameWithState(name, footage) {
  if (!footage || footage.kind === 'preparing') return name;
  if (footage.kind === 'missing') return `${name} · missing`;
  return `${name} · ${lower(footage.line)}`;
}

/** The chip on a preparing clip: "62%", or "…" while the share is not known. */
export const preparingChip = (footage) =>
  footage?.kind !== 'preparing' ? null : footage.pct == null ? '…' : `${footage.pct}%`;

/** How many of these clips are still preparing — the island header counts them. */
export const preparingCount = (list) => list.filter((f) => f?.kind === 'preparing').length;

/**
 * The rows the clip Inspector shows for footage that is not here (07 · ve-footage: File · Status · the safe line), and
 * the Advanced `status` fact. `[]` for a clip whose file is here.
 * @returns {{ rows: [string, string][], note: string|null, advanced: [string, string][], relink: boolean }}
 */
export function footageInspector(src, footage) {
  if (!footage || footage.kind === 'preparing')
    return {
      rows: footage
        ? [
            [
              FOOTAGE_WORDS.status,
              preparingChip(footage) === '…'
                ? 'Preparing'
                : `Preparing · ${preparingChip(footage)}`,
            ],
          ]
        : [],
      note: footage ? FOOTAGE_WORDS.preparingNote : null,
      advanced: [],
      relink: false,
    };
  const rows = [
    [FOOTAGE_WORDS.file, fileNameOf(src)],
    [FOOTAGE_WORDS.status, footage.line],
  ];
  return {
    rows,
    note: footage.kind === 'missing' ? FOOTAGE_WORDS.safeMissing : FOOTAGE_WORDS.safeWaiting,
    advanced: [
      [
        'status',
        footage.kind === 'missing'
          ? 'missing'
          : lower(footage.line).replace(/^waiting for /, 'waiting · on '),
      ],
    ],
    relink: footage.relink,
  };
}

/** Re-render when the studio's answers change (a waiting clip turns to here without a reload). */
export function useFootageAnswers() {
  return useSyncExternalStore(subscribeAssetAnswers, assetAnswersVersion, assetAnswersVersion);
}
