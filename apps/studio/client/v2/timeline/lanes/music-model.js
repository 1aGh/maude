// client/v2/timeline/lanes/music-model.js — S7.12: the Music lane's and the Music inspector's pure parts
// (07 · ve-music: "Music knows its beat and steps aside for speech").
//
//   Lane       waveform · "Hype instrumental · 120 BPM" · a tick on every beat (a tall one every bar)
//              · the volume line dipping under speech, labelled "Lower under speech"
//   Inspector  Volume · Lower under speech · Snap to the beat · Fade in · out · Song (Change…)
//              Advanced: bpm 120 (detected) [Half · Double] · duck −12 dB · 200 ms · gainDb −2
//
// Everything is READ from `GET /_api/comp-media` (`music[]`, `speech[]`) — the same derivation the canvas
// build and the verbs use, so the lane can not disagree with what plays (V2-1.10 §5.4). Nothing here
// stores a beat or a dip: they follow every trim, move and speed change with no write.
//
// No DOM, no React: words in, numbers out.

import { duckGain, msToFrames } from '../../../../video/framing.ts';

/** Bar ticks are drawn tall only at or above this bar confidence; below it every tick is alike (Q8). */
export const BAR_CONFIDENCE = 0.4;
/** A tempo strength under this is "no clear beat": Snap stays off, Cut to the beat has nothing to land on. */
export const CLEAR_BEAT = 0.15;
/** The tempo `maude design beats --bpm` accepts. */
export const BPM_MIN = 20;
export const BPM_MAX = 400;

/** The Music inspector's and lane's words (CONTRACT §3–§4: designer's words, no jargon). */
export const MUSIC_WORDS = Object.freeze({
  duck: 'Lower under speech',
  snap: 'Snap to the beat',
  volume: 'Volume',
  fade: 'Fade in · out',
  song: 'Song',
  change: 'Change…',
  findBeat: 'Find the beat',
  finding: 'Finding the beat…',
  cutToBeat: 'Cut to the beat',
  noClearBeat: 'No clear beat in this song.',
  noBeatYet: 'No beat found yet.',
  beatsFailed: 'Couldn’t find the beat. The song stays as it is.',
  half: 'Half',
  double: 'Double',
});

const MINUS = '−';
const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const signed = (n) => (n < 0 ? `${MINUS}${num(-n)}` : num(n));

/** The song's name on the lane: the file's base name; a content-hash name reads as "Music". */
export function songName(src) {
  const base = String(src ?? '')
    .split('/')
    .pop()
    ?.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  if (!base) return 'Music';
  if (/^[a-f0-9]{6,16}$/i.test(base)) return 'Music';
  return base.replace(/[-_]+/g, ' ');
}

/** Does the grid carry a pulse worth snapping to? */
export const hasClearBeat = (grid) =>
  !!grid && grid.tempoStrength >= CLEAR_BEAT && Array.isArray(grid.beats) && grid.beats.length >= 2;

/** "Hype instrumental · 120 BPM" — the lane's label; no tempo is claimed for a song with no clear beat. */
export function laneLabel(src, grid) {
  const name = songName(src);
  return hasClearBeat(grid) ? `${name} · ${Math.round(grid.bpm)} BPM` : name;
}

/** The ticks of one clip's grid: `{ frame, bar }` — a bar tick only where the analysis was sure (Q8). */
export function beatTicks(grid) {
  if (!grid || !Array.isArray(grid.beats)) return [];
  const bars = new Set(grid.barConfidence >= BAR_CONFIDENCE ? grid.bars : []);
  return grid.beats.map((frame) => ({ frame, bar: bars.has(frame) }));
}

// ── Snap to the beat (Q6) ───────────────────────────────────────────────────────────────────────────────
/**
 * `artboardMeta[id].snap`, or its default: ON when the comp has a music clip with a clear beat, off otherwise.
 * A song with no clear beat keeps Snap off whatever the file says ("Snap to the beat stays off", §5.2).
 * @param {'beat'|'off'|null|undefined} stored
 * @param {object[]} music `music[]` of comp-media
 */
export function snapMode(stored, music) {
  if (!(music ?? []).some((m) => hasClearBeat(m.grid))) return 'off';
  return stored === 'off' || stored === 'beat' ? stored : 'beat';
}

/** The comp frames a drag snaps to when Snap to the beat is on: every clear grid's beats, sorted, once. */
export function snapBeatFrames(music, mode) {
  if (mode !== 'beat') return [];
  const seen = new Set();
  for (const m of music ?? []) if (hasClearBeat(m.grid)) for (const f of m.grid.beats) seen.add(f);
  return [...seen].sort((a, b) => a - b);
}

// ── Lower under speech (Q5) ─────────────────────────────────────────────────────────────────────────────
/**
 * The volume line of one ducked clip: `{ f, depth }` break points over the frames it plays — depth 0 is full
 * volume, 1 the full dip (straight in dB between them, exactly as `<Duck>` plays it). Sparse: four points per
 * region, so a long clip is a handful of numbers, not one per frame.
 * @param {{ speech: Array<[number, number]>, duck: { db: number, attackMs: number, releaseMs: number } | null,
 *   fps: number, from: number, durationInFrames: number }} o
 */
export function duckPoints({ speech, duck, fps, from, durationInFrames }) {
  if (!duck || !duck.db || duck.db >= 0) return [];
  const end = from + durationInFrames;
  const attackFrames = msToFrames(duck.attackMs, fps);
  const releaseFrames = msToFrames(duck.releaseMs, fps);
  const o = { db: duck.db, attackFrames, releaseFrames };
  const marks = new Set([from, end]);
  for (const [s, e] of speech ?? []) {
    if (e + releaseFrames < from || s - attackFrames > end) continue;
    for (const f of [s - attackFrames, s, e, e + releaseFrames])
      marks.add(Math.min(end, Math.max(from, f)));
  }
  const depthAt = (f) => {
    const g = duckGain(f, speech ?? [], o);
    return g >= 1 ? 0 : Math.min(1, Math.max(0, (20 * Math.log10(g)) / duck.db));
  };
  return [...marks]
    .sort((a, b) => a - b)
    .map((f) => ({ f, depth: Math.round(depthAt(f) * 1000) / 1000 }));
}

/** Is there a dip to show at all (some speech inside the clip)? */
export const dipsAnywhere = (points) => points.some((p) => p.depth > 0);

/**
 * Q5: "Lower under speech" is ON by default when the comp has clips with speech regions. A bed that has
 * no `<Duck>` yet gets one when music is first added to such a comp — never on a later look, so a person who
 * turned it off keeps it off.
 */
export const shouldDuckByDefault = ({ speech, music }) =>
  (speech ?? []).length > 0 && (music ?? []).length > 0 && music.every((m) => !m.duck);

// ── the inspector's numbers ─────────────────────────────────────────────────────────────────────────────
/** "120 (detected)" / "120 (set)" — Advanced's bpm, in the words the canvas draws. */
export function bpmValue(grid) {
  if (!grid) return MUSIC_WORDS.noBeatYet;
  if (grid.tempoStrength < CLEAR_BEAT) return MUSIC_WORDS.noClearBeat;
  const how = grid.bpmSource === 'detected' ? 'detected' : 'set';
  return `${num(Math.round(grid.bpm * 100) / 100)} (${how})`;
}

/** Half and Double fix an octave error: the new tempo, or null when it falls outside what can be tracked. */
export function halfDouble(bpm) {
  const ok = (n) => (n >= BPM_MIN && n <= BPM_MAX ? Math.round(n * 100) / 100 : null);
  return { half: ok(bpm / 2), double: ok(bpm * 2) };
}

/** "−12 dB · 200 ms" — Advanced's duck (the attack; the release is in the file). */
export const duckValue = (duck) => (duck ? `${signed(duck.db)} dB · ${duck.attackMs} ms` : 'off');

/** gainDb: the Volume slider read in decibels ("−2" for 80 %), "−∞" for silence, "0" for full. */
export function gainDbValue(volume) {
  const v = Number.isFinite(volume) ? volume : 1;
  if (v <= 0) return `${MINUS}∞`;
  const db = Math.round(20 * Math.log10(v));
  return db === 0 ? '0' : signed(db);
}

/** The Volume slider's percent. */
export const volumePercent = (volume) =>
  Math.round(Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1)) * 100);

// ── Cut to the beat ─────────────────────────────────────────────────────────────────────────────────────
/**
 * The edit-op body of "Cut to the beat": the music's beats (comp frames) and the lengths of the sources the
 * cuts roll through. A source whose length is not known is left out — its cuts are then kept, never stretched.
 */
export function cutToBeatParams({ music, sources }) {
  const beats = snapBeatFrames(music, 'beat');
  const clean = {};
  for (const [k, v] of Object.entries(sources ?? {}))
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) clean[k] = v;
  return { beats, every: 1, sources: clean };
}

/** The toast after Cut to the beat: what moved, what stayed and why (the length never changes). */
export function cutToBeatWords(detail) {
  const moved = Number(detail?.moved) || 0;
  const kept = Array.isArray(detail?.kept) ? detail.kept.length : 0;
  if (moved === 0 && kept === 0) return 'Every cut is already on a beat.';
  const head = moved
    ? `Moved ${moved} cut${moved === 1 ? '' : 's'} to the beat.`
    : 'No cut could move to a beat.';
  const tail = kept
    ? ` ${kept} stayed where ${kept === 1 ? 'it was' : 'they were'} — no footage to spare.`
    : '';
  return `${head}${tail} The video is the same length.`;
}
