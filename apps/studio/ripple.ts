// ripple.ts — pure ripple engine (feature-enhanced-video-editing, Phase 0).
//
// When a clip's length changes (trim, speed, split, insert, remove), everything
// AFTER the edit point must shift so the cut stays gapless — the "magnetic"
// contract. Series clips (`TransitionSeries.Sequence` / `Series.Sequence`)
// need no `from` shift (Remotion computes their offsets), but the comp TOTAL
// still moves; standalone `<Sequence from={…}>` clips shift their `from`.
//
// The engine is PURE (source in → source out) and deliberately conservative:
//   • literal ints rewrite in place (`from={90}` → `from={102}`);
//   • additive const-arithmetic rewrites by merging the trailing integer term
//     (`from={A + B - 20}` +12 → `from={A + B - 8}`) or appending one
//     (`from={A}` +12 → `from={A + 12}`) — the symbolic form survives;
//   • an expression it can't RESOLVE (function call, ternary, unknown ident)
//     is refused loudly with a structured RippleError naming the clip — the UI
//     renders that as guidance, never a silent mis-shift.
//
// Double-shift guard: the comp TOTAL is bumped FIRST (const-preferring, so a
// shared `const TOTAL = A + B` updates every user consistently). Each
// downstream `from` expression is then evaluated under the ORIGINAL and the
// POST-TOTAL const environments — an expression that already moved by the
// delta (e.g. `from={TOTAL - 60}` on an end card) is SKIPPED, one that didn't
// move gets the textual shift, and one that moved by anything else (partial
// coupling) is refused rather than guessed at.

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { assertCompSemantics, CanvasEditError, enumerateClips } from './canvas-edit.ts';

/** Structured refusal — a subclass so the api layer's `instanceof
 *  CanvasEditError → 422` mapping (and its error message plumbing) applies. */
export class RippleError extends CanvasEditError {
  /** The unrewritable expression, when that's what was refused. */
  readonly expr: string | null;
  constructor(message: string, info: { canvas: string; id: string; expr?: string | null }) {
    super(message, info);
    this.name = 'RippleError';
    this.expr = info.expr ?? null;
  }
}

export interface RippleResult {
  source: string;
  /** stableIds of clips whose `from` was textually shifted. */
  shifted: string[];
  /** True when the comp duration (attr or its const) was rewritten. */
  totalEdited: boolean;
}

export interface RippleOptions {
  /** Shift downstream standalone `from` attrs (default true). */
  shiftFroms?: boolean;
  /** Bump the comp's durationInFrames / its const (default true). */
  bumpTotal?: boolean;
  /**
   * Ripple like an editor: shift only standalone pieces that START at or after
   * this frame (the edited clip's OLD end), wherever they sit in the source.
   * A piece that starts inside the edited clip's span stays where it is. Left
   * unset, every standalone piece AFTER the clip in source order shifts (the
   * pre-Phase-8 behaviour, which the insert / remove / transition callers rely on).
   */
  fromFrame?: number;
}

// ---------------------------------------------------------------------------
// Const resolution (mirrors timeline-parse.js — literal pass, then up to 3
// expression passes so `const TOTAL = A + B - XF` resolves).

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const SAFE_EXPR_RE = /^[A-Za-z0-9_$+\-*/()\s.]+$/;

export function collectConsts(source: string): Record<string, number> {
  const consts: Record<string, number> = {};
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*;/g)) {
    consts[m[1] as string] = Number(m[2]);
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/g)) {
      const name = m[1] as string;
      if (Object.hasOwn(consts, name)) continue;
      const v = resolveNum(m[2] as string, consts);
      if (v != null) consts[name] = v;
    }
  }
  return consts;
}

/** Resolve an expression to an integer: a literal, a known const, or simple
 *  arithmetic of them. `null` when not resolvable. */
export function resolveNum(raw: string, consts: Record<string, number>): number | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (IDENT_RE.test(t)) return Object.hasOwn(consts, t) ? (consts[t] as number) : null;
  if (!SAFE_EXPR_RE.test(t)) return null;
  const substituted = t.replace(/[A-Za-z_$][\w$]*/g, (id) =>
    Object.hasOwn(consts, id) ? String(consts[id]) : id
  );
  if (!/^[-+*/()\d\s.]+$/.test(substituted) || !/\d/.test(substituted)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict";return (${substituted});`)() as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  } catch {
    return null;
  }
}

/**
 * Shift an additive-friendly expression by `delta`, preserving its symbolic
 * form: a literal rewrites in place; a trailing integer term merges
 * (`A + B - 20` +12 → `A + B - 8`); anything else valid gets ` + delta`
 * appended. Returns null for an expression outside the safe charset — the
 * caller refuses those (resolvability is checked separately).
 */
export function shiftExpression(expr: string, delta: number): string | null {
  const t = String(expr ?? '').trim();
  if (!t || !SAFE_EXPR_RE.test(t)) return null;
  if (delta === 0) return t;
  if (/^-?\d+$/.test(t)) return String(Number(t) + delta);
  const trailing = t.match(/^(.*?)([+-])\s*(\d+)\s*$/);
  if (trailing) {
    const base = (trailing[1] as string).trim();
    // Only merge when the trailing int is a TERM of a top-level sum — a base
    // ending in an operator or '(' means the int is an operand of * / ( … ),
    // where merging would change the math. Fall through to append instead.
    if (base && !/[+\-*/(]$/.test(base)) {
      const cur = (trailing[2] === '-' ? -1 : 1) * Number(trailing[3]);
      const next = cur + delta;
      if (next === 0) return base;
      return `${base} ${next < 0 ? '-' : '+'} ${Math.abs(next)}`;
    }
  }
  return delta < 0 ? `${t} - ${-delta}` : `${t} + ${delta}`;
}

// ---------------------------------------------------------------------------
// Attr helpers — regex over ONE opening tag's text (the retimeAttr house style).

export interface AttrSpan {
  /** Absolute span of the inner expression (between the braces). */
  start: number;
  end: number;
  inner: string;
}

/** Locate `name={…}` inside the opening tag that starts at `tagStart`. */
export function attrExprSpan(source: string, tagStart: number, name: string): AttrSpan | null {
  const gt = source.indexOf('>', tagStart);
  const tag = source.slice(tagStart, gt < 0 ? source.length : gt + 1);
  const m = tag.match(new RegExp(`\\b${name}=\\{\\s*([^}]*?)\\s*\\}`));
  if (!m || m.index == null) return null;
  const braceRel = m[0].indexOf('{');
  const innerRel = m[0].indexOf(m[1] as string, braceRel);
  // Empty inner (`from={}` is invalid JSX anyway) — treat as absent.
  if ((m[1] as string) === '') return null;
  const start = tagStart + m.index + innerRel;
  return { start, end: start + (m[1] as string).length, inner: m[1] as string };
}

// ---------------------------------------------------------------------------
// TOTAL rewrite (const-preferring, mirrors retimeAttr's preference order).

function findVideoCompTagStart(source: string, compName: string): number | null {
  const re = /<VideoComp\b[^>]*>/g;
  let m: RegExpExecArray | null = re.exec(source);
  while (m) {
    if (new RegExp(`component=\\{\\s*${compName}\\s*\\}`).test(m[0])) return m.index;
    m = re.exec(source);
  }
  return null;
}

/** Plan the TOTAL bump on a scratch copy; returns the edited source or null
 *  when there is nothing to bump (no comp usage / no durationInFrames attr). */
function bumpTotal(
  canvasAbsPath: string,
  source: string,
  compName: string,
  delta: number
): string | null {
  const tagStart = findVideoCompTagStart(source, compName);
  if (tagStart == null) return null;
  const attr = attrExprSpan(source, tagStart, 'durationInFrames');
  if (!attr) return null;
  const s = new MagicString(source);
  const inner = attr.inner.trim();
  if (IDENT_RE.test(inner)) {
    // durationInFrames={TOTAL} — rewrite the const so every other user of it
    // (end-card `from={TOTAL - 60}`, interpolate windows) follows consistently.
    const cm = source.match(new RegExp(`\\bconst\\s+${inner}\\s*=\\s*([^;\\n]+);`));
    if (!cm || cm.index == null) {
      throw new RippleError(
        `comp duration is {${inner}} but no \`const ${inner} = …\` was found to rewrite`,
        { canvas: canvasAbsPath, id: compName, expr: inner }
      );
    }
    const init = (cm[1] as string).trim();
    const initStart = cm.index + (cm[0] as string).indexOf(cm[1] as string);
    const consts = collectConsts(source);
    if (resolveNum(init, consts) == null) {
      throw new RippleError(
        `cannot ripple the comp duration: \`const ${inner} = ${init}\` is not simple arithmetic — adjust it by hand`,
        { canvas: canvasAbsPath, id: compName, expr: init }
      );
    }
    const next = shiftExpression(init, delta);
    if (next == null) {
      throw new RippleError(`cannot ripple the comp duration expression \`${init}\``, {
        canvas: canvasAbsPath,
        id: compName,
        expr: init,
      });
    }
    s.overwrite(initStart, initStart + (cm[1] as string).length, next);
    return s.toString();
  }
  const consts = collectConsts(source);
  if (resolveNum(inner, consts) == null) {
    throw new RippleError(
      `cannot ripple the comp duration: \`durationInFrames={${inner}}\` is not simple arithmetic`,
      { canvas: canvasAbsPath, id: compName, expr: inner }
    );
  }
  const next = shiftExpression(inner, delta);
  if (next == null) {
    throw new RippleError(`cannot ripple the comp duration expression \`${inner}\``, {
      canvas: canvasAbsPath,
      id: compName,
      expr: inner,
    });
  }
  s.overwrite(attr.start, attr.end, next);
  return s.toString();
}

// ---------------------------------------------------------------------------
// The engine.

/**
 * Ripple everything after `afterStableId` by `deltaFrames` (positive = the
 * clip grew / one was inserted; negative = it shrank / was removed). Pure —
 * returns the new source; the caller owns disk writes and locking. Throws
 * `RippleError` (a `CanvasEditError`) with a user-renderable message when an
 * expression can't be rewritten safely.
 */
export function applyRippleAfterClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  afterStableId: string,
  deltaFrames: number,
  options: RippleOptions = {}
): RippleResult {
  const shiftFroms = options.shiftFroms !== false;
  const doTotal = options.bumpTotal !== false;
  const delta = Math.round(deltaFrames);
  if (delta === 0) return { source, shifted: [], totalEdited: false };

  const before = enumerateClips(canvasAbsPath, source, artboardId);
  const targetIdx = before.clips.findIndex((c) => c.stableId === afterStableId);
  if (targetIdx < 0) {
    throw new CanvasEditError(`clip "${afterStableId}" not found`, {
      canvas: canvasAbsPath,
      id: afterStableId,
    });
  }
  const compName = before.compName;

  const consts0 = collectConsts(source);

  // Stage 1 — TOTAL (const-preferring, so shared users follow consistently).
  let mid = source;
  let totalEdited = false;
  if (doTotal && compName) {
    const bumped = bumpTotal(canvasAbsPath, mid, compName, delta);
    if (bumped != null) {
      mid = bumped;
      totalEdited = true;
    }
  }
  const consts1 = collectConsts(mid);

  // Stage 2 — downstream standalone `from` shifts (fresh spans post-Stage-1).
  const shifted: string[] = [];
  if (shiftFroms) {
    const after = enumerateClips(canvasAbsPath, mid, artboardId);
    const idx = after.clips.findIndex((c) => c.stableId === afterStableId);
    const fromFrame = options.fromFrame;
    // With a threshold the source order no longer decides: a title written BEFORE the clip
    // in the file but starting after its old end follows it too.
    const downstream = (fromFrame == null ? after.clips.slice(idx + 1) : after.clips).filter(
      (c) => c.kind === 'sequence' && (fromFrame == null || c.stableId !== afterStableId)
    );
    const s = new MagicString(mid);
    let touched = false;
    for (const clip of downstream) {
      if (clip.tag !== 'Sequence') continue; // series clips position themselves
      const attr = attrExprSpan(mid, clip.start, 'from');
      if (!attr) continue; // cursor-implicit — follows the flow by construction
      const v0 = resolveNum(attr.inner, consts0);
      const v1 = resolveNum(attr.inner, consts1);
      if (fromFrame != null) {
        // Unresolvable and written before the clip: it was never shifted, don't start refusing now.
        if (after.clips.indexOf(clip) < idx && (v0 == null || v1 == null)) continue;
        if (v0 != null && v0 < fromFrame) continue; // starts inside the edited span: stays
      }
      if (v0 == null || v1 == null) {
        throw new RippleError(
          `cannot ripple "${clip.stableId}": \`from={${attr.inner.trim()}}\` is not simple arithmetic — move it by hand, then retry`,
          { canvas: canvasAbsPath, id: clip.stableId, expr: attr.inner.trim() }
        );
      }
      if (v1 - v0 === delta) continue; // already follows the bumped const
      if (v1 !== v0) {
        throw new RippleError(
          `cannot ripple "${clip.stableId}": \`from={${attr.inner.trim()}}\` is partially coupled to the comp duration — adjust it by hand`,
          { canvas: canvasAbsPath, id: clip.stableId, expr: attr.inner.trim() }
        );
      }
      if (v0 + delta < 0) {
        throw new RippleError(
          `cannot ripple "${clip.stableId}": it would start at frame ${v0 + delta} (before 0)`,
          { canvas: canvasAbsPath, id: clip.stableId }
        );
      }
      const next = shiftExpression(attr.inner, delta);
      if (next == null) {
        throw new RippleError(
          `cannot ripple "${clip.stableId}": \`from={${attr.inner.trim()}}\` can't be rewritten`,
          { canvas: canvasAbsPath, id: clip.stableId, expr: attr.inner.trim() }
        );
      }
      s.overwrite(attr.start, attr.end, next);
      shifted.push(clip.stableId);
      touched = true;
    }
    if (touched) mid = s.toString();
  }

  if (mid === source) return { source, shifted, totalEdited };

  const parsed = parseSync(canvasAbsPath, mid, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `ripple produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
      { canvas: canvasAbsPath, id: afterStableId }
    );
  }
  assertCompSemantics(canvasAbsPath, mid);
  return { source: mid, shifted, totalEdited };
}
