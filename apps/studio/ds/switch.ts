// ds/switch.ts — S10.14: move canvases to another design system (13 · ds-multi-switch; V2-1.13 §5.7 "Switch").
//
// One review, nothing to map. A switch rewrites `meta.designSystem`, drops `meta.dsRev` and any `data-ds-rev`
// pin (a pin names a revision of the OLD system), and writes `meta.dsPairing` only for Tier-2 slot names the
// target lacks, paired by kind from the counts of both systems at switch time (V2-1.13 §5.3.5: display by rank,
// brand / chart / accent by index, palette by index-mod). The canvas source is otherwise untouched; the AI
// restyle of a canvas's own tokens is a separate run the person asks for (origin `ds-restyle`), not this file.
//
// Every ticked canvas goes in ONE kernel action (the same port publish uses), so one ⌘Z undoes the switch. A
// canvas that is pinned (`dsPinned`, `opt_out_scope: full`) or blocked (an S2 `undefined` / `foreign`, an S5
// `kit-module` / `other-system`, an S9 `meta`) is listed unticked with its reason and is never written, whatever
// the request says — the server judges, the sheet only draws. A system at level 11 (private-only) is neither a
// source nor a target: the switch is refused and the dialog offers Bring-up (S10.15).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type CanvasState, checkCanvas } from './canvas-check.ts';
import { canvasContext, listCanvases } from './canvas-cli.ts';
import { type DsEngine, withLock } from './engine.ts';
import type { By } from './head.ts';
import { readHead } from './head.ts';
import { type RegistryIndex, slotKindOf } from './registry.ts';
import type { SystemConfig } from './system.ts';

export const SWITCH_FORMAT = 'maude.ds-switch-review';

export type SwitchScope =
  | { kind: 'canvas'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'all' };

export type SwitchCode =
  | 'ds-unknown-system'
  | 'ds-not-in-system'
  | 'ds-level-11'
  | 'ds-making'
  | 'ds-nothing-to-switch'
  | 'ds-switch-invalid'
  | 'ds-kernel-unavailable'
  | 'ds-kernel-rejected';

const STATUS: Partial<Record<SwitchCode, number>> = {
  'ds-unknown-system': 404,
  'ds-not-in-system': 404,
  'ds-nothing-to-switch': 422,
  'ds-switch-invalid': 422,
  'ds-kernel-unavailable': 503,
};

/** Same shape as the engine's refusals (`ds-*` code + numeric `status`), so the route answers it the same way. */
export class DsSwitchError extends Error {
  readonly code: SwitchCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: SwitchCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DsSwitchError';
    this.code = code;
    this.status = STATUS[code] ?? 409;
    if (detail) this.detail = detail;
  }
}
const fail = (c: SwitchCode, m: string, d?: Record<string, unknown>) => new DsSwitchError(c, m, d);

export interface SwitchRow {
  /** design-root-relative */
  path: string;
  folder: string;
  /** the system it follows now (null: no `meta.designSystem`) */
  from: string | null;
  /** V2-1.13 §5.6 canvas state */
  state: CanvasState;
  ticked: boolean;
  /** why it keeps its look: `pinned`, `ds-level-11`, or the first blocking finding (`S2:foreign`, …) */
  reason?: string;
  /** what AI would restyle: `own-token:<name>`, `literal-colour`, `local-palette`, `ext:<name>` → count */
  pins: Record<string, number>;
}

export interface SwitchReview {
  format: typeof SWITCH_FORMAT;
  v: 1;
  to: string;
  scope: SwitchScope;
  canvases: SwitchRow[];
  /** `canvases`: per canvas, the slot names the target lacks → the target's name; `kinds`: which slot kinds that touches */
  pairing: { kinds: string[]; canvases: Record<string, Record<string, string>> };
  /** system → conformance level, for the system moved to and each one moved from */
  levels: Record<string, number>;
  refused: { code: 'ds-level-11'; system: string } | null;
  /** set by `apply` */
  result: null | { switched: number; kept: number; actionId: string | null };
}

export interface SwitchInput {
  to: string;
  scope: SwitchScope;
  /** the person's ticks (a locked row never ticks, whatever this says) */
  canvases?: { path: string; ticked: boolean }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const metaRelOf = (rel: string) => rel.replace(/\.tsx$/i, '.meta.json');
const metaText = (o: Record<string, unknown>) => `${JSON.stringify(o, null, 2)}\n`;
const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
/** a pin names a revision of the system the canvas leaves: `head` or a 64-hex id */
const STRIP_REV_PIN =
  /\s+data-ds-rev=(?:"(?:head|[0-9a-f]{64})"|'(?:head|[0-9a-f]{64})'|\{\s*(?:"(?:head|[0-9a-f]{64})"|'(?:head|[0-9a-f]{64})')\s*\})/g;
const VAR_REF = /var\(\s*(--[A-Za-z0-9_-]+)/g;

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}
function readJsonObj(abs: string): Record<string, unknown> | null {
  const t = readText(abs);
  if (t === null) return null;
  try {
    const v = JSON.parse(t);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ pairing */

interface SlotShape {
  kind: string;
  pairing: string;
  /** the name with its index replaced by `#`, and the index */
  shape: string;
  index: number;
}

/** The kind, shape and index of a slot name; null when it has none (a companion, an extension, `--brand`). */
function shapeOf(idx: RegistryIndex, name: string): SlotShape | null {
  const kind = slotKindOf(idx, name);
  if (!kind) return null;
  const slot = idx.reg.slots.find((s) => s.kind === kind);
  if (!slot || slot.pairing === 'name') return null;
  for (const p of idx.slotPatterns) {
    if (p.kind !== kind) continue;
    const m = new RegExp(p.re.source, 'd').exec(name) as
      | (RegExpExecArray & { indices?: [number, number][] })
      | null;
    if (!m?.indices?.[1] || m[1] === undefined) continue;
    const [a, b] = m.indices[1];
    return {
      kind,
      pairing: slot.pairing,
      shape: `${name.slice(0, a)}#${name.slice(b)}`,
      index: Number(m[1]),
    };
  }
  return null;
}

/** The indices a system declares for one shape, ascending. */
function indicesOf(idx: RegistryIndex, declared: ReadonlySet<string>, shape: string): number[] {
  const out: number[] = [];
  for (const n of declared) {
    const s = shapeOf(idx, n);
    if (s && s.shape === shape) out.push(s.index);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * The target's index for source index `n` (V2-1.13 §5.3.5 "Pairing on switch"), or null when the target
 * declares no slot of that shape at all (then the registry's `absent` rule applies: a fallback, or an AI pick).
 */
export function pairIndex(
  pairing: string,
  n: number,
  source: readonly number[],
  target: readonly number[]
): number | null {
  if (!target.length) return null;
  if (pairing === 'rank') {
    const s = [...new Set([...source, n])].sort((a, b) => a - b);
    const pos = s.length > 1 ? s.indexOf(n) / (s.length - 1) : 0;
    return target[Math.round(pos * (target.length - 1))];
  }
  if (pairing === 'index-mod') return target[(n - 1) % target.length];
  // index, and role-then-index (the role of a texture / device / signature motion is not in a name)
  let best = target[0];
  for (const t of target) if (Math.abs(t - n) < Math.abs(best - n)) best = t;
  return best;
}

function usedNames(designRoot: string, rel: string): Set<string> {
  const out = new Set<string>();
  for (const f of [rel, rel.replace(/\.tsx$/i, '.css')]) {
    const t = readText(path.join(designRoot, f));
    if (t) for (const m of t.matchAll(VAR_REF)) out.add(m[1]);
  }
  return out;
}

/* ------------------------------------------------------------------- engine */

export function createDsSwitch(engine: DsEngine) {
  const designRoot = engine.designRoot;

  function project() {
    const config = readJsonObj(path.join(designRoot, 'config.json')) ?? {};
    return {
      root: path.dirname(designRoot),
      designRoot,
      config,
      systems: engine.systems() as SystemConfig[],
    };
  }

  function normScope(raw: SwitchScope, all: string[]): SwitchScope {
    if (raw.kind === 'all') return raw;
    const p = raw.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p || p.split('/').some((s) => s === '..' || s === '.' || s === ''))
      throw fail('ds-switch-invalid', 'path is a design-root-relative path');
    if (raw.kind === 'canvas') {
      if (!/\.tsx$/i.test(p) || !all.includes(p)) throw fail('ds-not-in-system', 'no such canvas');
      return { kind: 'canvas', path: p };
    }
    return { kind: 'folder', path: p };
  }

  /** The review: which canvases move, which keep their look and why, what the pairing writes. Reads only. */
  function review(inp: SwitchInput, o: { sees?: (rel: string) => boolean } = {}): SwitchReview {
    const proj = project();
    const target = proj.systems.find((s) => s.name === inp.to);
    if (!target)
      throw fail('ds-unknown-system', `no design system named ${String(inp.to).slice(0, 64)}`);
    const ctx = canvasContext(proj);
    const levelOf = (name: string): number => ctx.reports.get(name)?.exit ?? 0;
    const everything = listCanvases(designRoot).filter((r) => !r.startsWith('system/'));
    const scope = normScope(inp.scope, everything);
    const inScope = everything.filter(
      (r) =>
        (scope.kind === 'all' ||
          (scope.kind === 'canvas' ? r === scope.path : r.startsWith(`${scope.path}/`))) &&
        (o.sees ? o.sees(r) : true)
    );
    const idx = ctx.idx;
    const rows: SwitchRow[] = [];
    const pairs: Record<string, Record<string, string>> = {};
    const kinds = new Set<string>();
    const levels: Record<string, number> = { [target.name]: levelOf(target.name) };
    const targetDeclared = ctx.models.get(target.name)?.declared ?? new Set<string>();
    for (const rel of inScope) {
      const meta = readJsonObj(path.join(designRoot, metaRelOf(rel)));
      const from = typeof meta?.designSystem === 'string' ? meta.designSystem : null;
      if (from === target.name) continue; // already there
      let state: CanvasState;
      let reason: string | undefined;
      let pins: Record<string, number> = {};
      try {
        const rep = checkCanvas(ctx, rel);
        state = rep.state;
        pins = rep.pins;
        if (state === 'pinned') reason = 'pinned';
        else if (state === 'blocked') {
          const f = rep.findings.find((x) => x.severity === 'blocker');
          reason = f ? `${f.rule}:${f.kind}` : 'blocked';
        }
      } catch {
        state = 'blocked';
        reason = 'unreadable';
      }
      if (from && ctx.reports.has(from)) {
        levels[from] = levelOf(from);
        if (levels[from] === 11 && state !== 'pinned') {
          state = 'blocked';
          reason = 'ds-level-11';
        }
      }
      const ticked = state === 'switchable' || state === 'review';
      rows.push({
        path: rel,
        folder: folderOf(rel),
        from,
        state,
        ticked,
        ...(reason ? { reason } : {}),
        pins,
      });
      if (!ticked || !from) continue;
      // dsPairing: only for names the target lacks
      const sourceDeclared = ctx.models.get(from)?.declared ?? new Set<string>();
      const mine: Record<string, string> = {};
      for (const name of usedNames(designRoot, rel)) {
        if (targetDeclared.has(name)) continue;
        const s = shapeOf(idx, name);
        if (!s) continue;
        const t = pairIndex(
          s.pairing,
          s.index,
          indicesOf(idx, sourceDeclared, s.shape),
          indicesOf(idx, targetDeclared, s.shape)
        );
        if (t === null) continue;
        mine[name] = s.shape.replace('#', String(t));
        kinds.add(s.kind);
      }
      if (Object.keys(mine).length) pairs[rel] = mine;
    }
    let refused: SwitchReview['refused'] = null;
    if (levels[target.name] === 11) refused = { code: 'ds-level-11', system: target.name };
    else if (rows.length && rows.every((r) => r.reason === 'ds-level-11') && rows[0].from)
      refused = { code: 'ds-level-11', system: rows[0].from };
    return {
      format: SWITCH_FORMAT,
      v: 1,
      to: target.name,
      scope,
      canvases: rows,
      pairing: { kinds: [...kinds].sort(), canvases: pairs },
      levels,
      refused,
      result: null,
    };
  }

  async function applyLocked(inp: SwitchInput & { by: By }): Promise<SwitchReview> {
    const r = review(inp);
    if (r.refused)
      throw fail(
        'ds-level-11',
        `${r.refused.system} is not on the schema yet — bring it up to the schema first`,
        { system: r.refused.system }
      );
    // a system still being made has no revision to follow
    const target = engine.systems().find((s) => s.name === r.to) as SystemConfig;
    const h = readHead(path.join(designRoot, target.path));
    if (h.state === 'ok' && h.doc.head === null && h.doc.base === null)
      throw fail('ds-making', `${r.to} is still being made — finish it first`);
    const over = new Map((inp.canvases ?? []).map((c) => [c.path, c.ticked === true]));
    const files: { rel: string; text: string }[] = [];
    let switched = 0;
    for (const row of r.canvases) {
      // the server judges: a locked row never moves, a tick can only turn a switchable row off
      const go = row.ticked && (over.has(row.path) ? over.get(row.path) === true : true);
      if (!go) continue;
      const metaRel = metaRelOf(row.path);
      const meta = readJsonObj(path.join(designRoot, metaRel));
      if (!meta) continue;
      meta.designSystem = r.to;
      delete meta.dsRev;
      const pairs = r.pairing.canvases[row.path];
      if (pairs) meta.dsPairing = pairs;
      else delete meta.dsPairing;
      files.push({ rel: metaRel, text: metaText(meta) });
      const src = readText(path.join(designRoot, row.path));
      if (src !== null && src.replace(STRIP_REV_PIN, '') !== src)
        files.push({ rel: row.path, text: src.replace(STRIP_REV_PIN, '') });
      switched++;
    }
    if (!switched) throw fail('ds-nothing-to-switch', 'no canvas is ticked to switch');
    const k = engine.kernel();
    const label = `Switch ${switched} canvas${switched === 1 ? '' : 'es'} to ${r.to}`;
    const unavailable = () =>
      fail('ds-kernel-unavailable', 'no project home answers right now — nothing was changed');
    if (!k) throw unavailable();
    const out = await k.propose(files, { kind: 'edit', label: label.slice(0, 200) });
    if (!out) throw unavailable();
    if (out.status !== 'accepted')
      throw fail(
        'ds-kernel-rejected',
        `the project refused the change (${out.code ?? 'rejected'})`,
        {
          kernel: out.code ?? null,
        }
      );
    return {
      ...r,
      canvases: r.canvases.map((c) => ({ ...c })),
      result: { switched, kept: r.canvases.length - switched, actionId: out.actionId ?? null },
    };
  }

  /** The switch. Serialised with a publish of the target and of every system the canvases leave. */
  function apply(inp: SwitchInput & { by: By }): Promise<SwitchReview> {
    if (!engine.kernel())
      return Promise.reject(
        fail(
          'ds-kernel-unavailable',
          "No project home answers right now — switch when you're back online."
        )
      );
    let keys: string[];
    try {
      const r = review(inp);
      const names = new Set([
        r.to,
        ...r.canvases.map((c) => c.from).filter((x): x is string => !!x),
      ]);
      keys = [...names]
        .map((n) => engine.systems().find((s) => s.name === n))
        .filter((s): s is SystemConfig => !!s)
        .map((s) => path.join(designRoot, s.path))
        .sort();
    } catch (e) {
      return Promise.reject(e);
    }
    const run = (i: number): Promise<SwitchReview> =>
      i >= keys.length ? applyLocked(inp) : withLock(keys[i], () => run(i + 1));
    return run(0);
  }

  return { review, apply };
}

export type DsSwitch = ReturnType<typeof createDsSwitch>;
