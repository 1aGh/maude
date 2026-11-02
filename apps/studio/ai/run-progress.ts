// ai/run-progress.ts — S7.14: a run's studio-local `progress` (V2-1.15 amendment 2026-10-09, S7 §2.2).
//
// "How far is the AI cut?" is answered from FILES, never from the model's prose: the run's canvas (its scope
// and the canvases its writes touched), the comp on each of its artboards, and the cut it is placing — the
// `<designRoot>/*.edl.json` whose shots the comp holds (matched by name, video/reel-place.ts). The beats of
// the comp's music (`assets/<base>.beats.json`) say whether the shots sit on the beat.
//
// The registry asks this for YOUR runs only (`GET /_api/ai/runs` `mine`); `publicRun` — what peers see —
// never carries it. Reads are bounded: ≤ 64 EDL files of ≤ 1 MB each (parsed once per mtime), canvases
// ≤ 2 MB, one comp walk per artboard. Any failure is "no progress", never an error on the runs route.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { type Edl, validateEdl } from '../footage/schema.ts';
import { compBeats, compClips } from '../video/derive.ts';
import { type PlaceProgress, placeProgress } from '../video/reel-place.ts';
import { type BeatGrid, readBeats, sidecarRelFor } from '../video/schema.ts';
import type { RunProgress, RunRecord } from './run-lifecycle.ts';
import { footageSecOf, leftOutOf, watchOf } from './watch-progress.ts';

export const MAX_EDLS = 64;
export const EDL_MAX_BYTES = 1024 * 1024;
export const CANVAS_MAX_BYTES = 2 * 1024 * 1024;

const CANVAS_REL_RE = /^(?!_)(?!.*(?:^|\/)\.)[^\0\\]+\.tsx$/;

/** The (canvas, artboard) pairs a run works on: its scope, then what its writes touched. */
export function runTargets(rec: Pick<RunRecord, 'scope' | 'touched' | 'leases'>): Array<{
  canvas: string;
  artboards: string[];
}> {
  const out = new Map<string, Set<string>>();
  const add = (canvas: unknown, ids: unknown[]) => {
    if (typeof canvas !== 'string' || !CANVAS_REL_RE.test(canvas) || canvas.includes('..')) return;
    const set = out.get(canvas) ?? new Set<string>();
    for (const id of ids) if (typeof id === 'string' && id) set.add(id);
    out.set(canvas, set);
  };
  const leased = (rec.leases ?? []).map((l) => l.artboard);
  if (rec.scope?.canvas)
    add(rec.scope.canvas, Array.isArray(rec.scope.artboards) ? rec.scope.artboards : leased);
  for (const [canvas, ids] of Object.entries(rec.touched ?? {})) add(canvas, ids ?? []);
  return [...out].map(([canvas, ids]) => ({ canvas, artboards: [...ids] }));
}

export function createRunProgress(o: { designRoot: string }) {
  const edlCache = new Map<string, { mtime: number; edl: Edl | null }>();

  function edls(): Array<{ rel: string; mtime: number; edl: Edl }> {
    let names: string[];
    try {
      names = readdirSync(o.designRoot).filter(
        (n) => n.endsWith('.edl.json') && !n.startsWith('.')
      );
    } catch {
      return [];
    }
    const out: Array<{ rel: string; mtime: number; edl: Edl }> = [];
    for (const n of names.sort().slice(0, MAX_EDLS)) {
      const abs = path.join(o.designRoot, n);
      try {
        const st = statSync(abs);
        if (!st.isFile() || st.size > EDL_MAX_BYTES) continue;
        let hit = edlCache.get(n);
        if (!hit || hit.mtime !== st.mtimeMs) {
          const v = JSON.parse(readFileSync(abs, 'utf8'));
          hit = { mtime: st.mtimeMs, edl: validateEdl(v).ok ? (v as Edl) : null };
          edlCache.set(n, hit);
        }
        if (hit.edl) out.push({ rel: n, mtime: st.mtimeMs, edl: hit.edl });
      } catch {
        /* unreadable: not a cut */
      }
    }
    return out;
  }

  const readText = (rel: string, max: number): string | null => {
    try {
      const abs = path.join(o.designRoot, ...rel.split('/'));
      if (statSync(abs).size > max) return null;
      return readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  };

  /** The cut the run is placing, or null when none of its artboards holds a shot of any cut. */
  function placeOf(rec: RunRecord): { progress: RunProgress; edl: Edl } | null {
    const cuts = edls();
    if (!cuts.length) return null;
    let best: {
      p: PlaceProgress;
      canvas: string;
      artboard: string;
      mtime: number;
      edl: Edl;
    } | null = null;
    for (const t of runTargets(rec)) {
      const source = readText(t.canvas, CANVAS_MAX_BYTES);
      if (source === null) continue;
      const abs = path.join(o.designRoot, ...t.canvas.split('/'));
      for (const artboard of t.artboards) {
        let c: ReturnType<typeof compClips>;
        try {
          c = compClips(abs, source, artboard);
        } catch {
          continue;
        }
        if (!c.clips.some((s) => s.track === 'video')) continue;
        const grids: Record<string, BeatGrid> = {};
        for (const s of c.clips) {
          if ((s.track !== 'music' && s.track !== 'music2') || grids[s.src]) continue;
          const rel = sidecarRelFor(s.src.replace(/^\.?\//, ''), 'beats');
          const text = rel ? readText(rel, 1024 * 1024) : null;
          const r = text ? readBeats(text, rel ?? undefined) : null;
          if (r?.ok) grids[s.src] = r.value;
        }
        const beats = compBeats(c, grids);
        for (const cut of cuts) {
          const p = placeProgress(c, cut.edl, beats);
          if (!p) continue;
          if (!best || p.done > best.p.done || (p.done === best.p.done && cut.mtime > best.mtime))
            best = { p, canvas: t.canvas, artboard, mtime: cut.mtime, edl: cut.edl };
        }
      }
    }
    return best
      ? { progress: { ...best.p, canvas: best.canvas, artboard: best.artboard }, edl: best.edl }
      : null;
  }

  /**
   * The run's progress: the cut it is placing (`place`), else the footage it is watching (`watch`, S7.15 — the
   * clips its ask attached), else none. A placing run also says how many clips it watched and which the cut
   * leaves out, so "Watched all 12. Left out 3" stays true while and after the shots land.
   */
  return function progressOf(rec: RunRecord): RunProgress | null {
    const place = placeOf(rec);
    const clips = rec.attached ?? [];
    if (place) {
      if (!clips.length) return place.progress;
      return {
        ...place.progress,
        watched: clips.length,
        ...(footageSecOf(clips) ? { footageSec: footageSecOf(clips) } : {}),
        leftOut: leftOutOf(clips, o.designRoot, place.edl),
      };
    }
    if (!clips.length) return null;
    return watchOf(clips, o.designRoot, { live: rec.state !== 'ended' });
  };
}
