// ds/edges.ts — S10.17: the three edges of the Design system canvas (13 · ds-edge-contrast, ds-edge-trash,
// ds-edge-suggest).
//
//   fixContrast   "Lighten to 4.5:1": the smallest lightness move (ds/contrast.ts `fixContrast`) per mode, written as ONE
//                 waiting edit (`dsPending`). Nothing reaches a canvas until "Update N canvases".
//   nearest       what a trashed token's canvases should follow (OKLab ΔE, every mode), or the system colour closest
//                 to a hand-picked one. The trash itself is the engine's (`trashToken`) — this only answers the question.
//   addColour     "Add it to the system": a waiting `add` entry. The canvas keeps its literal until the person uses it.
//   offSystem     S1 literal-colour findings on the CHANGED lines of a canvas (`ds-check --changed`, S10 Q12), each with
//                 the nearest system colour and the element that carries it. A rule, not a judgement: "AI spots" is voice.
//
// Reads are open to anyone who can see the system; the routes (routes/ds-edges.ts) judge who may write.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { walkIdElements } from '../element-ids.ts';
import { buildBoardModel } from './board/build-model.ts';
import type { BoardModel, BoardToken } from './board/types.ts';
import { checkCanvas, scopeToChanged } from './canvas-check.ts';
import { canvasContext } from './canvas-cli.ts';
import { type ContrastFix, fixContrast, followDark, resolveColour } from './contrast.ts';
import type { DsEngine, DsResult, PendingToken } from './engine.ts';
import type { By } from './head.ts';
import { type Nearest, nearestForToken, nearestForValue } from './nearest.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import type { SystemConfig } from './system.ts';

export const EDGE_FORMAT = 'maude.ds-edge';

export type EdgeCode =
  | 'ds-unknown-system'
  | 'ds-unknown-token'
  | 'ds-edge-invalid'
  | 'ds-nothing-to-fix'
  | 'ds-not-in-system';

const STATUS: Record<EdgeCode, number> = {
  'ds-unknown-system': 404,
  'ds-unknown-token': 404,
  'ds-not-in-system': 404,
  'ds-edge-invalid': 422,
  'ds-nothing-to-fix': 422,
};

/** Same shape as the engine's refusals (`ds-*` code + numeric `status`), so the route answers it the same way. */
export class DsEdgeError extends Error {
  readonly code: EdgeCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: EdgeCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DsEdgeError';
    this.code = code;
    this.status = STATUS[code];
    if (detail) this.detail = detail;
  }
}
const fail = (c: EdgeCode, m: string, d?: Record<string, unknown>) => new DsEdgeError(c, m, d);

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The theme → value map the contrast rule judges: the files' values with the waiting edits over them. */
export function themeValuesOf(model: BoardModel, theme: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of model.tokens) {
    const pend = t.pending && !t.pending.trashTo ? t.pending.values?.[theme] : undefined;
    const v = pend ?? t.values?.[theme] ?? t.values?.[model.themes.default];
    if (typeof v === 'string') out[t.css] = v;
  }
  return out;
}

export interface FixedMode extends Pick<ContrastFix, 'value' | 'direction' | 'ratio'> {
  theme: string;
  from: string;
}

export interface FixPlan {
  css: string;
  label: string;
  fixes: FixedMode[];
}

export interface OffSystemFinding {
  /** the colour as written on the canvas */
  literal: string;
  /** design-root-relative canvas */
  file: string;
  line: number;
  col: number;
  /** the closest system colour, or null when the system has none */
  nearest: (Nearest & { label: string; value: string }) | null;
  /** the element the edit is made on (`ds.use-nearest`); null when no element near it is addressable */
  target: { artboard: string; element: string } | null;
}

export interface OffSystemAnswer {
  format: typeof EDGE_FORMAT;
  v: 1;
  edge: 'off-system';
  canvas: string;
  system: string | null;
  findings: OffSystemFinding[];
}

const MAX_OFF_SYSTEM = 3;
/** a colour added from a canvas is an own token: `--x-` and lowercase words */
const NAME_RE = /^--x-[a-z0-9]+(?:-[a-z0-9]+){0,6}$/;

const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');

export interface ChangedRange {
  file: string;
  from: number;
  to: number;
}

/**
 * The lines of `rel` that differ from the last commit (`git diff -U0`), or the whole file when it is new. Empty when
 * there is no git or nothing changed. Injected in tests.
 */
export function gitChangedRanges(root: string, rel: string, designRel: string): ChangedRange[] {
  const file = path.posix.join(designRel, rel);
  const run = (args: string[]) =>
    spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 4000 });
  const status = run(['status', '--porcelain', '--', file]);
  if (status.status !== 0) return [];
  if (/^\?\?|^A/.test(status.stdout.trim())) return [{ file: rel, from: 1, to: 1_000_000 }];
  const d = run(['diff', '-U0', '--no-color', 'HEAD', '--', file]);
  if (d.status !== 0) return [];
  const out: ChangedRange[] = [];
  for (const m of d.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const from = Number(m[1]);
    const n = m[2] === undefined ? 1 : Number(m[2]);
    if (n > 0) out.push({ file: rel, from, to: from + n - 1 });
  }
  return out;
}

export function createDsEdges(
  engine: DsEngine,
  opts: { changedRanges?: (rel: string) => ChangedRange[] } = {}
) {
  const designRoot = engine.designRoot;

  function systemOf(ds: string): SystemConfig {
    const s = engine.systems().find((x) => x.name === ds);
    if (!s) throw fail('ds-unknown-system', `no design system named ${String(ds).slice(0, 64)}`);
    return s;
  }
  const boardOf = (ds: string): BoardModel => buildBoardModel(designRoot, systemOf(ds));
  const tokenOf = (model: BoardModel, css: string): BoardToken => {
    const t = model.tokens.find((x) => x.css === css);
    if (!t) throw fail('ds-unknown-token', `${String(css).slice(0, 80)} is not in the system`);
    return t;
  };

  /* ------------------------------------------------------------ contrast */

  /** What "Lighten to 4.5:1" would write, per mode — reads only. `theme` limits it to one mode. */
  function planFix(ds: string, css: string, theme?: string): FixPlan & { model: BoardModel } {
    const model = boardOf(ds);
    const token = tokenOf(model, css);
    if (theme !== undefined && !model.themes.all.includes(theme))
      throw fail('ds-edge-invalid', `${String(theme).slice(0, 40)} is not a mode of ${ds}`);
    if (token.pending?.trashTo) throw fail('ds-edge-invalid', `${css} is in the trash`);
    const fixes: FixedMode[] = [];
    for (const t of theme ? [theme] : model.themes.all) {
      const values = themeValuesOf(model, t);
      const f = fixContrast(css, values);
      if (f)
        fixes.push({
          theme: t,
          from: values[css] ?? '',
          value: f.value,
          direction: f.direction,
          ratio: f.ratio,
        });
    }
    if (!fixes.length)
      throw fail(
        'ds-nothing-to-fix',
        `${token.label} already clears its contrast, or no lightness can`
      );
    return { css, label: token.label, fixes, model };
  }

  /** The waiting entry after the fix: what already waits stays, the engine replaces the entry. */
  function entryFor(model: BoardModel, token: BoardToken, fixes: FixedMode[]): PendingToken {
    const themes = model.themes;
    const entry: PendingToken = {};
    for (const [t, v] of Object.entries(token.pending?.values ?? {})) entry[t] = v;
    const at = (t: string): string =>
      (entry[t] as string | undefined) ?? token.values[t] ?? token.values[themes.light] ?? '';
    const followedBefore = (token.pending?.darkFollows ?? token.darkFollows) !== false;
    let follows = followedBefore;
    const byTheme = new Map(fixes.map((f) => [f.theme, f.value]));
    const light = themes.light;
    const dark = themes.dark;
    const lightFix = byTheme.get(light);
    const darkFix = dark ? byTheme.get(dark) : undefined;
    for (const [t, v] of byTheme) entry[t] = v;
    if (dark && lightFix !== undefined && darkFix === undefined && followedBefore) {
      // Dark follows Light: it moves with the fix, keeping the pair's relation
      const d = followDark({ light: at(light), dark: at(dark) }, lightFix);
      if (d) entry[dark] = d;
    } else if (dark && darkFix !== undefined) follows = false; // Dark set by hand: it no longer follows
    if (follows !== (token.darkFollows !== false)) entry.darkFollows = follows;
    const names = { ...(token.pending?.valueNames ?? {}) };
    if (Object.keys(names).length) entry.valueNames = names;
    return entry;
  }

  async function fixContrastOf(inp: {
    ds: string;
    css: string;
    theme?: string;
    by: By;
  }): Promise<FixPlan & { result: DsResult }> {
    const plan = planFix(inp.ds, inp.css, inp.theme);
    const token = tokenOf(plan.model, inp.css);
    const entry = entryFor(plan.model, token, plan.fixes);
    const result = await engine.mergePending(inp.ds, {
      tokens: { [inp.css]: entry },
      expect: { [inp.css]: token.pending?.at ?? null },
      by: inp.by,
    });
    return { css: plan.css, label: plan.label, fixes: plan.fixes, result };
  }

  /* -------------------------------------------------------------- nearest */

  const tokensOf = (model: BoardModel) =>
    model.tokens.map((t) => ({
      css: t.css,
      kind: t.kind,
      group: t.group,
      values: t.values,
      pending: t.pending ? { trashTo: t.pending.trashTo, added: t.pending.added } : null,
    }));

  const named = (model: BoardModel, n: Nearest | null) => {
    if (!n) return null;
    const t = model.tokens.find((x) => x.css === n.css);
    return {
      ...n,
      label: t?.label ?? n.css,
      value: t?.values[model.themes.default] ?? '',
    };
  };

  /** Is `css` a Tier-1 role — the engine will not move it to the trash. */
  const tier1 = (css: string) => indexRegistry(loadRegistry()).roles.has(css);

  /** What a token's canvases would follow if it went to the trash. `used` is how many canvases use it. */
  function replacementFor(ds: string, css: string, used: number | null) {
    const model = boardOf(ds);
    const token = tokenOf(model, css);
    const r = named(model, nearestForToken(css, tokensOf(model), model.themes));
    return {
      format: EDGE_FORMAT,
      v: 1,
      edge: 'trash',
      system: ds,
      css,
      label: token.label,
      trashable: !tier1(css) && !token.locked,
      reason: tier1(css) ? 'tier-1' : token.locked ? 'locked' : null,
      used: used ?? token.used,
      replacement: r,
    };
  }

  /** The system colour closest to a hand-picked value. */
  function suggestFor(ds: string, value: string) {
    const model = boardOf(ds);
    return {
      format: EDGE_FORMAT,
      v: 1,
      edge: 'suggest',
      system: ds,
      value,
      nearest: named(model, nearestForValue(value, tokensOf(model), model.themes)),
    };
  }

  /* ----------------------------------------------------------- add colour */

  /** "Add it to the system": a waiting `add` entry, the same value in every mode. */
  async function addColour(inp: {
    ds: string;
    value: string;
    label?: string;
    css?: string;
    by: By;
  }) {
    const model = boardOf(inp.ds);
    const s = systemOf(inp.ds);
    if (!resolveColour(inp.value, () => undefined))
      throw fail('ds-edge-invalid', 'that is not one plain colour');
    const taken = new Set(model.tokens.map((t) => t.css));
    let css = inp.css;
    if (css !== undefined) {
      if (!NAME_RE.test(css)) throw fail('ds-edge-invalid', 'a new colour is named --x-…');
      if (taken.has(css)) throw fail('ds-edge-invalid', `${css} is already in the system`);
    } else {
      const base = `--x-${slug(inp.label ?? '') || `colour-${slug(inp.value) || 'new'}`}`;
      css = base;
      for (let i = 2; taken.has(css); i++) css = `${base}-${i}`;
    }
    const label = (inp.label?.trim() || css.slice(4).replace(/-/g, ' ')).slice(0, 64);
    const entry: PendingToken = {
      add: { type: 'color', label },
      darkFollows: false,
    };
    for (const t of s.themes) entry[t] = inp.value;
    const result = await engine.mergePending(inp.ds, { tokens: { [css]: entry }, by: inp.by });
    return { css, label, value: inp.value, result };
  }

  /* ----------------------------------------------------------- off-system */

  function offSystem(canvas: string): OffSystemAnswer {
    const rel = canvas.replace(/^\/+/, '');
    const empty: OffSystemAnswer = {
      format: EDGE_FORMAT,
      v: 1,
      edge: 'off-system',
      canvas: rel,
      system: null,
      findings: [],
    };
    if (!/\.tsx$/i.test(rel) || rel.startsWith('system/')) return empty;
    let source: string;
    try {
      source = readFileSync(path.join(designRoot, rel), 'utf8');
    } catch {
      throw fail('ds-not-in-system', 'no such canvas');
    }
    let config: Record<string, unknown> = {};
    try {
      const c = JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'));
      if (isObj(c)) config = c;
    } catch {
      /* no config: no systems */
    }
    const root = path.dirname(designRoot);
    const ctx = canvasContext({ root, designRoot, config, systems: engine.systems() });
    const report = checkCanvas(ctx, rel);
    if (!report.system) return empty;
    const ranges =
      opts.changedRanges?.(rel) ?? gitChangedRanges(root, rel, path.basename(designRoot));
    const scoped = ranges.length ? scopeToChanged(report, ranges) : { ...report, findings: [] };
    const model = boardOf(report.system);
    const toks = tokensOf(model);
    const walk = walkIdElements(source, rel);
    const lines = source.split('\n');
    const offsetOf = (line: number, col: number) => {
      let n = 0;
      for (let i = 0; i < line - 1; i++) n += (lines[i]?.length ?? 0) + 1;
      return n + col - 1;
    };
    const findings: OffSystemFinding[] = [];
    for (const f of scoped.findings) {
      if (f.rule !== 'S1' || f.kind !== 'literal' || f.file !== rel || !f.name) continue;
      const at = offsetOf(f.line, f.col);
      // the innermost element that carries an authored id and contains the literal
      let target: OffSystemFinding['target'] = null;
      if (walk.ok) {
        let best: { size: number; artboard: string; id: string } | null = null;
        for (const e of walk.elements) {
          if (e.id === null || e.id === '' || e.artboard === null) continue;
          if (at < e.start || at >= e.end) continue;
          const size = e.end - e.start;
          if (!best || size < best.size) best = { size, artboard: e.artboard, id: e.id };
        }
        if (best) target = { artboard: best.artboard, element: best.id };
      }
      findings.push({
        literal: f.name,
        file: rel,
        line: f.line,
        col: f.col,
        nearest: named(model, nearestForValue(f.name, toks, model.themes)),
        target,
      });
      if (findings.length >= MAX_OFF_SYSTEM) break;
    }
    return { ...empty, system: report.system, findings };
  }

  return { planFix, fixContrast: fixContrastOf, replacementFor, suggestFor, addColour, offSystem };
}

export type DsEdges = ReturnType<typeof createDsEdges>;
