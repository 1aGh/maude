// timeline-parse.js — DDR-148. Parse a video-comp's sequence + keyframe
// structure from its raw .tsx source, so the Timeline panel can draw one row
// per sequence (positioned by frame) with the animation (interpolate) windows
// marked on it. Pure + dependency-free → unit-tested without a DOM.
//
// This is a pragmatic regex parser tuned to the shapes the video-comp skill
// teaches (literal or const `durationInFrames`/`from`, <TransitionSeries> with
// its overlap math, components referenced by name). It degrades gracefully:
// an unparseable comp yields `{ sequences: [] }` and the panel shows a scrub-
// only track. It is NOT a general TSX parser.

import { describeKeyframes, interpolateCalls } from '../../video/keyframes.ts';

/**
 * Collect top-level numeric consts so `durationInFrames={A}` resolves. Two
 * passes: literal ints first, then expression consts built from them
 * (`const TOTAL = A + B - XF;`) so a derived total resolves too.
 */
function collectConsts(source) {
  const consts = {};
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*;/g)) {
    consts[m[1]] = Number(m[2]);
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g)) {
      const name = m[1];
      if (Object.hasOwn(consts, name)) continue;
      const v = resolveNum(m[2], consts);
      if (v != null) consts[name] = v;
    }
  }
  return consts;
}

/** Resolve a `{...}` expression to an integer: a literal, a const, or simple arithmetic of them. */
function resolveNum(raw, consts) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  if (Object.hasOwn(consts, t)) return consts[t];
  const expr = t.replace(/[A-Za-z_$][\w$]*/g, (id) =>
    Object.hasOwn(consts, id) ? String(consts[id]) : id
  );
  if (/^[-+*/()\d\s.]+$/.test(expr) && /\d/.test(expr)) {
    try {
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict";return (${expr});`)();
      if (Number.isFinite(v)) return Math.round(v);
    } catch {
      /* not arithmetic */
    }
  }
  return null;
}

/**
 * Animation (interpolate-of-frame) windows inside a named component's body: `kf` is what the marker overview
 * draws, `info` (S7.18) is parallel to it and says what each window moves and what curve it has — the Advanced
 * panel's rows. Both come from the same calls (video/keyframes.ts), so the k-th marker is the k-th window.
 */
function keyframesForComponent(source, compName, consts, seqFrom) {
  if (!compName) return { kf: [], info: [] };
  const calls = interpolateCalls(source, compName);
  if (calls.length === 0) return { kf: [], info: [] };
  const details = describeKeyframes(source, compName);
  const kf = [];
  const info = [];
  for (const call of calls) {
    const a = resolveNum(call.from, consts);
    const b = resolveNum(call.to, consts);
    if (a != null && b != null && b >= a) {
      kf.push({ from: seqFrom + a, to: seqFrom + b });
      info.push(details.find((d) => d.index === call.index));
    }
  }
  return { kf, info };
}

/** The `keyframes` + `keyframeInfo` fields of one sequence row. */
function keyframeFields(src, compName, consts, seqFrom) {
  const { kf, info } = keyframesForComponent(src, compName, consts, seqFrom);
  return { keyframes: kf, keyframeInfo: info };
}

/**
 * Parse the comp's timeline. `totalFrames` (from the comp meta) is the
 * authoritative total; the parser only positions the sequences within it.
 * Returns `{ total, sequences: [{ label, from, duration, keyframes[] }] }`.
 */
/** The source slice of a named component's definition body (heuristic bounds). */
function componentBody(src, name) {
  if (!name) return null;
  const def = src.search(new RegExp(`\\b(?:const|function)\\s+${name}\\b`));
  if (def < 0) return null;
  const rest = src.slice(def + name.length + 1);
  const next = rest.search(/\n(?:const|function|export)\s+[A-Za-z]/);
  return rest.slice(0, next > 0 ? next : rest.length);
}

/** The `<VideoComp component={X} …>` usages in a canvas, each tagged with the id
 *  of its enclosing `<DCArtboard id="…">` (nearest preceding) so the Timeline can
 *  scope to whichever artboard the user selected. */
function videoCompUsages(src, consts) {
  const out = [];
  for (const m of src.matchAll(/<VideoComp\b([^>]*?)\/?>/g)) {
    const a = m[1];
    const comp = a.match(/component=\{([A-Za-z_$][\w$]*)\}/);
    if (!comp) continue;
    const before = src.slice(0, m.index);
    const boards = [...before.matchAll(/<DCArtboard\b[^>]*?\bid=["']([^"']+)["']/g)];
    out.push({
      compName: comp[1],
      artboardId: boards.length ? boards[boards.length - 1][1] : null,
      duration: resolveNum(a.match(/durationInFrames=\{([^}]+)\}/)?.[1], consts),
      fps: resolveNum(a.match(/fps=\{([^}]+)\}/)?.[1], consts) || 30,
    });
  }
  return out;
}

export function parseCompTimeline(source, totalFrames, selectedArtboardId) {
  const src = String(source ?? '');
  const consts = collectConsts(src);

  // A canvas can hold SEVERAL video-comps (one per artboard). Scope the parse to
  // ONE composition's body so a 2-comp canvas doesn't merge every sequence into
  // one track. Preference: the artboard the user SELECTED (so the Timeline
  // follows the canvas), then a comp with real media, then a duration match,
  // then the first — and read fps/total from it.
  let scope = src;
  let scopedTotal = totalFrames;
  let scopedFps = 0;
  let scopedArtboardId = null;
  const usages = videoCompUsages(src, consts)
    .map((u) => ({ ...u, body: componentBody(src, u.compName) }))
    .filter((u) => u.body);
  if (usages.length) {
    const target =
      (selectedArtboardId && usages.find((u) => u.artboardId === selectedArtboardId)) ||
      usages.find((u) => /<(?:Maude)?(?:Audio|OffthreadVideo|Video)\b/.test(u.body)) ||
      usages.find((u) => u.duration != null && u.duration === totalFrames) ||
      usages[0];
    scope = target.body;
    if (target.duration != null) scopedTotal = target.duration;
    scopedFps = target.fps;
    scopedArtboardId = target.artboardId ?? null;
  }

  const items = [];
  // Spans of clip bodies — used below to spot LOOSE media (a bare
  // <OffthreadVideo>/<Img> sibling outside every Sequence), which previously
  // never showed on the timeline at all (dogfood 2026-07-30).
  const clipSpans = [];
  const tagRe =
    /<(TransitionSeries\.Sequence|TransitionSeries\.Transition|Series\.Sequence|Sequence)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(scope))) {
    const kind = m[1];
    const attrs = m[2];
    const openEnd = tagRe.lastIndex;
    if (/Transition$/.test(kind)) {
      const d = attrs.match(/durationInFrames:\s*([^,}\s)]+)/);
      // S7.10 — which of the six the join plays (the picker highlights it): fade() · slide() · wipe() · flip() ·
      // clockWipe(…) · none()
      const pm = attrs.match(/presentation=\{\s*([A-Za-z]+)\s*\(/);
      items.push({
        type: 'transition',
        dur: resolveNum(d?.[1], consts) ?? 0,
        presentation: pm ? (pm[1] === 'clockWipe' ? 'clock-wipe' : pm[1]) : null,
      });
    } else {
      const dm = attrs.match(/durationInFrames=\{([^}]+)\}/);
      const fm = attrs.match(/from=\{([^}]+)\}/);
      // Bound the media/child sniff to THIS clip's own body — up to its close
      // tag — never the fixed 240-char window that used to bleed into a
      // following loose <Audio> and badge the wrong row (dogfood: EndCard showed
      // a phantom audio). FALLBACK badge only; the enumerator (comp-clips)
      // overlays authoritative media by index (incl. wrapper-component media).
      const closeIdx = scope.indexOf(`</${kind}>`, openEnd);
      clipSpans.push([m.index, closeIdx >= 0 ? closeIdx : openEnd + 240]);
      const bound = closeIdx >= 0 ? Math.min(closeIdx, openEnd + 400) : openEnd + 240;
      const after = scope.slice(openEnd, bound);
      const lm = after.match(/<([A-Z][A-Za-z0-9]*)\b/);
      // Media child sniff (badge + replace affordance): the first
      // <Video|OffthreadVideo|Audio|Img src="…"> DIRECTLY inside the clip body.
      const mm = after.match(
        /<(?:Maude)?(Video|OffthreadVideo|Audio|Img)\b[^>]*src=["']([^"']+)["']/
      );
      const nameM = attrs.match(/name=["']([^"']+)["']/);
      items.push({
        type: 'seq',
        // DDR-150 dogfood fix: a `from` on a SERIES clip is a lie — Remotion's
        // TransitionSeries/Series compute their own offsets and IGNORE the prop
        // (one shipped drag-move used to insert it). Never let it position the
        // row; series rows always flow from the cumulative cursor, exactly like
        // the render.
        series: kind !== 'Sequence',
        dur: resolveNum(dm?.[1], consts),
        from: kind === 'Sequence' && fm ? resolveNum(fm[1], consts) : null,
        compName: nameM ? nameM[1] : lm ? lm[1] : null,
        mediaTag: mm ? mm[1] : null,
        mediaSrc: mm ? mm[2] : null,
      });
    }
  }

  let cursor = 0;
  const sequences = [];
  // Task 5 (enhanced-video-editing) — seam transitions between series beats,
  // so the storyline lane can draw its ⧓ chips: { afterIndex, dur } where
  // afterIndex is the sequence-row index the transition FOLLOWS.
  const transitions = [];
  let pendingTransition = null;
  for (const it of items) {
    if (it.type === 'transition') {
      cursor -= it.dur || 0;
      if (sequences.length > 0)
        pendingTransition = {
          afterIndex: sequences.length - 1,
          dur: it.dur || 0,
          presentation: it.presentation ?? null,
        };
      continue;
    }
    const from = it.from != null ? it.from : cursor;
    const duration = it.dur != null ? it.dur : 30;
    if (pendingTransition) {
      transitions.push(pendingTransition);
      pendingTransition = null;
    }
    sequences.push({
      label: it.compName ?? `Seq ${sequences.length + 1}`,
      series: !!it.series,
      mediaTag: it.mediaTag,
      mediaSrc: it.mediaSrc,
      from: Math.max(0, from),
      duration: Math.max(1, duration),
      ...keyframeFields(src, it.compName, consts, Math.max(0, from)),
    });
    cursor = from + duration;
  }

  const derived = sequences.length ? Math.max(...sequences.map((s) => s.from + s.duration)) : 30;
  const total = Number.isFinite(scopedTotal) && scopedTotal > 0 ? scopedTotal : derived;

  // Audio/music beds — their OWN rows (a `<Audio>` isn't a Sequence, so it never
  // shows up above). Spans the whole comp unless it carries from/durationInFrames.
  const audio = [];
  for (const m of scope.matchAll(/<Audio\b([^>]*)>/g)) {
    const attrs = m[1];
    const srcM = attrs.match(/src=["']([^"']+)["']/);
    const fromM = attrs.match(/from=\{([^}]+)\}/);
    const durM = attrs.match(/durationInFrames=\{([^}]+)\}/);
    const from = fromM ? (resolveNum(fromM[1], consts) ?? 0) : 0;
    const dur = durM ? resolveNum(durM[1], consts) : null;
    const name = srcM ? String(srcM[1]).split(/[\\/]/).pop() : 'audio';
    audio.push({
      kind: 'audio',
      label: name,
      src: srcM ? srcM[1] : null,
      from: Math.max(0, from),
      duration: dur != null ? Math.max(1, dur) : Math.max(1, total - from),
    });
  }

  // Loose VISUAL media — a bare <OffthreadVideo>/<Video>/<Img> sibling outside
  // every clip span. Remotion renders it from frame 0 for the whole comp, so
  // show it as a read-only overlay row (`loose: true` — no clip ops; it has no
  // enumerator identity). Dogfood 2026-07-30: these were invisible before.
  for (const lm of scope.matchAll(/<(?:Maude)?(OffthreadVideo|Video|Img)\b([^>]*?)\/?>/g)) {
    const at = lm.index ?? 0;
    if (clipSpans.some(([s2, e2]) => at >= s2 && at <= e2)) continue;
    const srcM = lm[2].match(/src=["']([^"']+)["']/);
    if (!srcM) continue;
    const name = String(srcM[1]).split(/[\\/]/).pop();
    sequences.push({
      label: name || lm[1],
      series: false,
      loose: true,
      mediaTag: lm[1],
      mediaSrc: srcM[1],
      from: 0,
      duration: Math.max(1, total),
      keyframes: [],
    });
  }

  // `artboardId` is the DCArtboard the timeline scoped to — the shell passes it
  // to /_api/comp-clips + every clip op so the enumerator targets the SAME comp
  // (on a multi-comp canvas its own fallback picks a different one — the
  // showreel badge/replace mis-scoped to the wrong comp without this).
  return {
    total,
    fps: scopedFps || undefined,
    sequences,
    audio,
    transitions,
    artboardId: scopedArtboardId,
  };
}
