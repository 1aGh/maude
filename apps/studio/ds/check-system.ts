// ds/check-system.ts — S10.19 (S10 Q9, Q10): "Check the system" (13 · ds-advanced).
//
// Deterministic first: the schema level (`ds-check`), a contrast matrix over both themes (the pairs rule of
// ds/contrast.ts) and completeness (the seven sections, both modes, reduced motion). Every line the card
// draws is computed here from those facts — nothing is typed — and the whole answer is kept in
// `_state/ds-check/<ds>.json` (per Mac, ignored with the rest of `_state/`) so the card can say "ran 1 min
// ago" and an agent can read what the person saw. Agents are optional depth ("Ask AI to review") and never
// part of this answer.
//
//   maude design ds check-system <ds> --json   →   maude.ds-system-check/1

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';
import { buildBoardModel } from './board/build-model.ts';
import { checkSystem } from './check.ts';
import { contrastMatrix, ratioWords } from './contrast.ts';
import { deriveSectionStates } from './make.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { diskFs, loadSystem, type SystemConfig } from './system.ts';

export const CHECK_FORMAT = 'maude.ds-system-check';
export const CHECK_V = 1;
/** how many failing pairs the card names before it says "and N more" */
export const FAILS_SHOWN = 4;

export type LineId = 'contrast' | 'pair' | 'complete' | 'schema';

/** One row of the card, already in the person's words. */
export interface CheckLine {
  id: LineId;
  ok: boolean;
  /** the bold word: "Contrast" · "Quiet on Well" · "Complete" · "Schema" */
  title: string;
  text: string;
  /** a failing pair: the token to show on the Design system canvas ("Show") */
  show?: string;
}

export interface PairFail {
  theme: string;
  fg: string;
  bg: string;
  fgLabel: string;
  bgLabel: string;
  need: number;
  ratio: number;
}

export interface SystemCheck {
  format: typeof CHECK_FORMAT;
  v: typeof CHECK_V;
  ds: string;
  at: string;
  schema: { level: 0 | 10 | 11; reasons: string[] };
  contrast: {
    themes: string[];
    total: number;
    pass: number;
    /** pairs a side of which is not a plain colour (a gradient, a missing name) — not judged */
    unjudged: number;
    fails: PairFail[];
  };
  complete: {
    sections: { done: number; of: number; waiting: string[] };
    bothModes: boolean;
    reducedMotion: boolean;
  };
  lines: CheckLine[];
}

const cap = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s);
const joinWords = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

const REDUCED_RE = /@media[^{]*prefers-reduced-motion\s*:\s*reduce/i;

/** The sections' words on the canvas (ds/board/types.ts SECTIONS), for "Motion is waiting". */
const SECTION_LABEL: Readonly<Record<string, string>> = {
  brand: 'Brand',
  colour: 'Colour',
  type: 'Type',
  space: 'Space & shape',
  motion: 'Motion',
  components: 'Components',
  patterns: 'Patterns',
};

/** What the schema level says, in words. */
export function schemaWords(level: 0 | 10 | 11): { ok: boolean; text: string } {
  if (level === 0)
    return {
      ok: true,
      text: 'Follows the schema — switches cleanly with any system that does',
    };
  if (level === 10)
    return {
      ok: false,
      text: 'Follows the schema except a few names — a switch fills the gaps with defaults',
    };
  return {
    ok: false,
    text: 'Off the schema — canvases here cannot switch to another system yet',
  };
}

/** Why a pair is short, in words: close enough for big text, or plainly too low. */
export function shortWords(f: Pick<PairFail, 'theme' | 'ratio' | 'need'>): string {
  const big = f.need >= 4.5 && f.ratio >= 3;
  return `${cap(f.theme)}: ${ratioWords(f.ratio)} — ${big ? 'large text only' : `below ${f.need}:1`}`;
}

/** The lines the card draws, from the facts. Pure. */
export function linesOf(c: Omit<SystemCheck, 'lines' | 'format' | 'v' | 'ds' | 'at'>): CheckLine[] {
  const out: CheckLine[] = [];
  const themes = joinWords(c.contrast.themes.map(cap));
  const judged = c.contrast.total;
  if (judged === 0) {
    out.push({
      id: 'contrast',
      ok: true,
      title: 'Contrast',
      text: 'No text pairs to judge yet',
    });
  } else if (!c.contrast.fails.length) {
    out.push({
      id: 'contrast',
      ok: true,
      title: 'Contrast',
      text:
        judged === 1
          ? `The one text pair passes, ${themes}`
          : `All ${judged} text pairs pass, ${themes}`,
    });
  } else {
    out.push({
      id: 'contrast',
      ok: false,
      title: 'Contrast',
      text: `${c.contrast.pass} of ${judged} text pairs pass, ${themes}`,
    });
    // the worst first, one row per pair; the rest is one quiet "and N more"
    const worst = [...c.contrast.fails].sort((a, b) => a.ratio - b.ratio);
    for (const f of worst.slice(0, FAILS_SHOWN))
      out.push({
        id: 'pair',
        ok: false,
        title: `${f.fgLabel} on ${f.bgLabel}`,
        text: shortWords(f),
        show: f.fg,
      });
    if (worst.length > FAILS_SHOWN)
      out.push({
        id: 'pair',
        ok: false,
        title: 'And more',
        text: `${worst.length - FAILS_SHOWN} more pairs fall short`,
      });
  }
  const { done, of, waiting } = c.complete.sections;
  const missing: string[] = [];
  if (done < of) missing.push(`${done} of ${of} sections`);
  if (!c.complete.bothModes) missing.push('one mode only');
  if (!c.complete.reducedMotion) missing.push('no reduced motion');
  const complete = done === of && c.complete.bothModes && c.complete.reducedMotion;
  out.push({
    id: 'complete',
    ok: complete,
    title: 'Complete',
    text: complete
      ? `${of} sections, both modes, reduced motion`
      : `${joinWords(missing)}${waiting.length ? ` — ${joinWords(waiting)} waiting` : ''}`,
  });
  const s = schemaWords(c.schema.level);
  out.push({ id: 'schema', ok: s.ok, title: 'Schema', text: s.text });
  return out;
}

/** Where the answer is kept (a plain system name only). */
export function checkFileOf(designRootAbs: string, ds: string): string | null {
  if (!/^[\w .-]{1,64}$/.test(ds) || ds.startsWith('.')) return null;
  return path.join(designRootAbs, '_state', 'ds-check', `${ds}.json`);
}

/** Run the check over the system's files as they are now. Pure of writes. */
export function computeSystemCheck(
  designRootAbs: string,
  sys: SystemConfig,
  now: () => Date = () => new Date()
): SystemCheck {
  const idx = indexRegistry(loadRegistry());
  const model = loadSystem(diskFs(designRootAbs), sys);
  const report = checkSystem(model, idx);
  const board = buildBoardModel(designRootAbs, sys, idx);
  const labels = new Map(board.tokens.map((t) => [t.css, t.label]));
  const labelOf = (css: string) => labels.get(css) ?? css.replace(/^--/, '').replace(/-/g, ' ');
  const themeNames = board.themes.dark
    ? [board.themes.light, board.themes.dark]
    : [board.themes.light];

  // the matrix, per theme: the files' values (a waiting edit is not the system yet)
  let total = 0;
  let pass = 0;
  let unjudged = 0;
  const fails: PairFail[] = [];
  for (const theme of themeNames) {
    const values: Record<string, string> = {};
    for (const t of board.tokens) {
      const v = t.values[theme] ?? t.values[board.themes.default];
      if (typeof v === 'string') values[t.css] = v;
    }
    for (const r of contrastMatrix(values)) {
      if (r.ratio === null) {
        unjudged++;
        continue;
      }
      total++;
      if (r.pass) pass++;
      else
        fails.push({
          theme,
          fg: r.fg,
          bg: r.bg,
          fgLabel: labelOf(r.fg),
          bgLabel: labelOf(r.bg),
          need: r.need,
          ratio: r.ratio,
        });
    }
  }

  // completeness: the seven sections (ds-check by group, Q7), both modes, reduced motion
  const states = deriveSectionStates(report, new Set(), (n) => idx.roles.get(n)?.group);
  const kinds = Object.keys(states) as Array<keyof typeof states>;
  const waiting = kinds.filter((k) => states[k] !== 'done').map((k) => SECTION_LABEL[k] ?? k);
  const bothModes =
    sys.themes.length >= 2 &&
    sys.themes.every((t) => model.themeRules.some((r) => r.themes.includes(t))) &&
    !report.reasons.includes('single-theme') &&
    !report.reasons.includes('theme-gap');
  const reducedMotion = REDUCED_RE.test(model.css ?? '');

  const core = {
    schema: { level: report.exit, reasons: report.reasons },
    contrast: { themes: themeNames, total, pass, unjudged, fails },
    complete: {
      sections: { done: kinds.length - waiting.length, of: kinds.length, waiting },
      bothModes,
      reducedMotion,
    },
  };
  return {
    format: CHECK_FORMAT,
    v: CHECK_V,
    ds: sys.name,
    at: now().toISOString(),
    ...core,
    lines: linesOf(core),
  };
}

/** Run it and keep the answer in `_state/ds-check/<ds>.json`. */
export function runSystemCheck(designRootAbs: string, sys: SystemConfig): SystemCheck {
  const result = computeSystemCheck(designRootAbs, sys);
  const file = checkFileOf(designRootAbs, sys.name);
  if (file) {
    mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

/** The answer kept by the last run, or null (never run, unreadable, or not this shape). */
export function lastSystemCheck(designRootAbs: string, ds: string): SystemCheck | null {
  const file = checkFileOf(designRootAbs, ds);
  if (!file || !existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v &&
      v.format === CHECK_FORMAT &&
      v.v === CHECK_V &&
      v.ds === ds &&
      Array.isArray(v.lines)
      ? (v as SystemCheck)
      : null;
  } catch {
    return null;
  }
}
