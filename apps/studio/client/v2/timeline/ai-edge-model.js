// client/v2/timeline/ai-edge-model.js — S7.14: what the timeline shows of an AI cut (07 · ve-ai-scrub,
// ve-ai-proposal). Pure — the hook in ai-edge.jsx feeds it the run list and the open video.
//
// Everything here comes from the run's `progress` (V2-1.15 amendment), which the studio DERIVES from the
// files the run wrote (ai/run-progress.ts): how many shots are on the video, the AI edge (end frame of the
// last one), the shot that just landed. Never from the model's words. The AI edge is the run's; your
// playhead is yours — nothing here reads or writes the playhead.

import { sameCanvas } from '../ai/made-by-ai.js';
import { TAG_CUTTING } from '../ai/runs-model.js';

const LIVE = new Set(['waiting', 'starting', 'running', 'needs-you']);

export const CHIP_CUTTING = TAG_CUTTING;
export const KEEP_GOING = 'Keep going';
export const madeByAiChip = (n) => `Made by AI · ${n} ${n === 1 ? 'shot' : 'shots'}`;
export const placedOfChip = (done, total) => `Placed ${done} of ${total} shots.`;
/** 3 → "0:03", 4.5 → "0:04.5", 11.5 → "0:11.5" */
export function clock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rest = Math.round((s - m * 60) * 10) / 10;
  const whole = Math.floor(rest);
  const tenth = Math.round((rest - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}${tenth ? `.${tenth}` : ''}`;
}

/** `assets/caaftv-tackle.mp4` → "caaftv-tackle"; a content-hash name says nothing → null. */
export function clipName(clip) {
  const base = String(clip ?? '')
    .replace(/^.*\//, '')
    .replace(/\.[A-Za-z0-9]{1,8}$/, '');
  return !base || /^[a-f0-9]{6,16}$/i.test(base) ? null : base;
}

/** The landing island's two lines: "Placing shot 7 · Tackle 2" / "caaftv-tackle, 0:03–0:04.5 · on the beat at 0:11.5". */
export function landingLines(shot, fps) {
  if (!shot) return null;
  const f = Number(fps) > 0 ? Number(fps) : 30;
  const name = clipName(shot.clip);
  const range = `${clock(shot.srcIn)}–${clock(shot.srcOut)}`;
  const at = `${shot.onBeat ? 'on the beat at' : 'at'} ${clock(shot.at / f)}`;
  return {
    title: `Placing shot ${shot.n} · ${shot.name}`,
    line: `${name ? `${name}, ` : ''}${range} · ${at}`,
  };
}

/**
 * The AI cut on this video, or null.
 *   { state: 'cutting', runId, done, total, edge, fps, landing, lines, chip }   a live run placing shots
 *   { state: 'stopped', runId, done, total, chip, keepGoing: true }            Stop kept the shots placed
 *   { state: 'made',    runId, done, total, chip }                             the cut is on the video
 * `madeByAi` = the artboard still carries "Made by AI" (S5.15: your next edit clears it), which is when an
 * ended cut's chip still says something true.
 */
export function aiCutModel(view, { activePath, artboardId, madeByAi = false } = {}) {
  if (!artboardId) return null;
  const on = (r) =>
    r?.progress?.kind === 'place' &&
    r.progress.artboard === artboardId &&
    sameCanvas(r.progress.canvas, activePath);
  const mine = Array.isArray(view?.mine) ? view.mine : [];
  const live = mine.filter((r) => LIVE.has(r.state) && on(r)).pop();
  if (live) {
    const p = live.progress;
    return {
      state: 'cutting',
      runId: live.runId,
      done: p.done,
      total: p.total,
      edge: Number.isFinite(p.edge) ? p.edge : null,
      fps: p.fps || 30,
      landing: p.shot?.stableId ?? null,
      lines: landingLines(p.shot, p.fps),
      chip: CHIP_CUTTING,
    };
  }
  if (!madeByAi) return null;
  const ended = mine
    .filter((r) => r.state === 'ended' && on(r))
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    .pop();
  if (!ended) return null;
  const { done, total } = ended.progress;
  if (ended.outcome === 'stopped' && done < total)
    return {
      state: 'stopped',
      runId: ended.runId,
      done,
      total,
      chip: placedOfChip(done, total),
      keepGoing: true,
    };
  if (ended.outcome === 'done' || ended.outcome === 'stopped')
    return { state: 'made', runId: ended.runId, done, total, chip: madeByAiChip(done) };
  return null;
}

/** A live run of mine on this artboard that may be placing (before its first shot has landed too). */
export function liveRunOn(view, { activePath, artboardId } = {}) {
  const mine = Array.isArray(view?.mine) ? view.mine : [];
  return mine.some(
    (r) =>
      LIVE.has(r.state) &&
      (r.progress?.artboard === artboardId ||
        (Array.isArray(r.scope?.artboards) &&
          r.scope.artboards.includes(artboardId) &&
          sameCanvas(r.scope.canvas, activePath)))
  );
}
