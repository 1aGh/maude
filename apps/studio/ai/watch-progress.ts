// ai/watch-progress.ts — S7.15: the `watch` half of a run's studio-local `progress` (V2-1.10 §5.9, S7 §2.2).
//
// "Watching 12 clips… 7 done" is answered from FILES, never from the model's prose:
//   · the clips are the footage the ask ATTACHED — the `[maude-attachments …]` block the composer appends
//     (client/v2/ai/attach.js) names each one as the Assets copy the server made, `…/assets/<sha8>.<ext>`;
//   · a clip is DONE when `assets/<sha8>.footage.json` exists and is a footage analysis (Plane B writes it,
//     skipped when present); the first clip without one is NOW, the rest WAIT;
//   · a FOUND line is a done clip's best usable shot: its second, what is in it, and the clip's name;
//   · a LEFT OUT clip is a watched clip the cut does not use, with the note of its best unusable shot
//     ("too dark", "shaky") — named, never hidden.
//
// Only the run's own view carries it (`GET /_api/ai/runs` `mine`); `publicRun` never. Reads are bounded: at
// most 48 clips, each sidecar ≤ 1 MB. Any failure is "not watched", never an error on the runs route.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  type Edl,
  type FootageAnalysis,
  type FootageShot,
  validateFootageAnalysis,
} from '../footage/schema.ts';
import type { RunProgress } from './run-lifecycle.ts';

export const MAX_CLIPS = 48;
const SIDECAR_MAX_BYTES = 1024 * 1024;
const FOUND_LINE_MAX = 80;
const WHY_MAX = 40;

export interface AttachedClip {
  /** `assets/<sha8>.<ext>` — the project's copy of the footage */
  asset: string;
  /** what the person called it, without the extension */
  name: string;
  /** the length the chip said ("Footage · 0:07"), in seconds, when it said one */
  durationSec?: number;
}

const HEADER = '[maude-attachments';
// `- footage “name” (Footage · 0:07): /abs/…/assets/<sha8>.mp4` — attach.js attachmentBlock()
const LINE = /^- footage “([^”]*)”(?: \(([^)]*)\))?: (.+)$/;
const META_LENGTH = /Footage · (\d+(?::\d{2}){1,2})\b/;
const ASSET_TAIL = /(?:^|[\\/])assets[\\/]([0-9a-f]{8,}[A-Za-z0-9_-]*\.[A-Za-z0-9]{1,5})$/;

/** "1:02" → 62, "1:02:05" → 3725; 0 when the meta names no length. */
function lengthOf(meta: string | undefined): number {
  const m = meta ? META_LENGTH.exec(meta) : null;
  if (!m) return 0;
  return (m[1] as string).split(':').reduce((t, n) => t * 60 + Number(n), 0);
}

/** The total length of the footage when every clip said its own; undefined otherwise. */
export function footageSecOf(clips: AttachedClip[]): number | undefined {
  if (!clips.length || clips.some((c) => !c.durationSec)) return undefined;
  return clips.reduce((t, c) => t + (c.durationSec as number), 0);
}

/** The footage an ask attached, from its text: the lines under the attachments header only. */
export function attachedClips(text: string | undefined | null): AttachedClip[] {
  if (typeof text !== 'string') return [];
  const at = text.indexOf(HEADER);
  if (at < 0) return [];
  const out: AttachedClip[] = [];
  const seen = new Set<string>();
  for (const raw of text.slice(at).split('\n').slice(1)) {
    const m = LINE.exec(raw.trimEnd());
    if (!m) continue;
    const tail = ASSET_TAIL.exec((m[3] as string).trim());
    if (!tail) continue;
    const asset = `assets/${tail[1]}`;
    if (seen.has(asset)) continue;
    seen.add(asset);
    const name = (m[1] as string).replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'clip';
    const durationSec = lengthOf(m[2]);
    out.push({ asset, name, ...(durationSec ? { durationSec } : {}) });
    if (out.length >= MAX_CLIPS) break;
  }
  return out;
}

const footageRel = (asset: string) => asset.replace(/\.[^./]+$/, '.footage.json');

function readAnalysis(designRoot: string, asset: string): FootageAnalysis | null {
  try {
    const abs = path.join(designRoot, ...footageRel(asset).split('/'));
    if (statSync(abs).size > SIDECAR_MAX_BYTES) return null;
    const v = JSON.parse(readFileSync(abs, 'utf8'));
    return validateFootageAnalysis(v).ok ? (v as FootageAnalysis) : null;
  } catch {
    return null;
  }
}

const quality = (s: FootageShot) => (typeof s.quality === 'number' ? s.quality : 0);

/** The best usable shot: highest quality, the earliest on a tie. */
export function bestShot(a: FootageAnalysis): FootageShot | null {
  let best: FootageShot | null = null;
  for (const s of a.shots ?? []) {
    if (s.usable === false) continue;
    if (!best || quality(s) > quality(best)) best = s;
  }
  return best;
}

/** Why a clip was left out: the note of its best unusable shot (the longest, then the first). */
export function whyLeftOut(a: FootageAnalysis): string | undefined {
  let pick: FootageShot | null = null;
  for (const s of a.shots ?? []) {
    if (s.usable !== false || !s.note?.trim()) continue;
    if (!pick || s.end - s.start > pick.end - pick.start) pick = s;
  }
  const note = pick?.note?.trim().replace(/\s+/g, ' ').replace(/[.]+$/, '');
  return note ? note.slice(0, WHY_MAX) : undefined;
}

function foundLine(shot: FootageShot, name: string): string {
  const what = shot.subject?.trim() || shot.note?.trim();
  return (what ? `${what} — ${name}` : name).slice(0, FOUND_LINE_MAX);
}

/** The run's watch progress: how many attached clips have been watched, and what was found in them. */
export function watchOf(
  clips: AttachedClip[],
  designRoot: string,
  o: { live: boolean }
): RunProgress & {
  kind: 'watch';
  clips: NonNullable<RunProgress['clips']>;
  found: NonNullable<RunProgress['found']>;
} {
  const rows: NonNullable<RunProgress['clips']> = [];
  const found: NonNullable<RunProgress['found']> = [];
  let done = 0;
  let nowSet = false;
  for (const c of clips) {
    const a = readAnalysis(designRoot, c.asset);
    if (a) {
      done += 1;
      rows.push({ asset: c.asset, name: c.name, state: 'done' });
      const s = bestShot(a);
      if (s) found.push({ asset: c.asset, name: c.name, at: s.start, line: foundLine(s, c.name) });
    } else if (o.live && !nowSet) {
      nowSet = true;
      rows.push({ asset: c.asset, name: c.name, state: 'now' });
    } else {
      rows.push({ asset: c.asset, name: c.name, state: 'wait' });
    }
  }
  const total = clips.length;
  return {
    kind: 'watch',
    done,
    total,
    label:
      done >= total && total > 0
        ? `Watched all ${total}.`
        : `Watching ${total} ${total === 1 ? 'clip' : 'clips'}… ${done} done`,
    clips: rows,
    found,
    ...(footageSecOf(clips) ? { footageSec: footageSecOf(clips) } : {}),
  };
}

/** The watched clips a cut does not use, each with the reason its footage gave (when it gave one). */
export function leftOutOf(
  clips: AttachedClip[],
  designRoot: string,
  edl: Edl
): NonNullable<RunProgress['leftOut']> {
  const used = new Set((edl.beats ?? []).map((b) => b.clip));
  const out: NonNullable<RunProgress['leftOut']> = [];
  for (const c of clips) {
    if (used.has(c.asset)) continue;
    const a = readAnalysis(designRoot, c.asset);
    if (!a) continue; // not watched: not "left out" yet
    const why = whyLeftOut(a);
    out.push({ asset: c.asset, name: c.name, ...(why ? { why } : {}) });
  }
  return out;
}
