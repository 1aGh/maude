// Converting `system/<ds>/` folders into Design system canvases — S10.12 (V2-1.6 §5.2 "Conversion",
// §5.4 α → β, §5.11 g; canvas 13 · 25 ds-multi-migrate, 29 ds-edge-migrate).
//
// For every system named (default: every system not yet on a canvas), in ONE all-or-nothing run:
//
//   1. the Design system canvas: `design-system.tsx` + `.meta.json` — the seven sections, plus one
//      `ds-own-<slug>` artboard per specimen page, in a row under its section (convert-map.ts; rc.1
//      finding 9 option A, decision `v2-michal-ds-specimens-own-artboards` — no page is dropped);
//   2. R0 = the working files, frozen: the tokens CSS and `preview/_components.css` byte for byte
//      (so every follower renders `revisions/<R0>.tokens.css`, identical to what it rendered before),
//      `components.json` as it is, and `tokens.json` re-emitted as the canvas's own (`source:
//      "canvas"`, every label / value name kept — the S10.16a rule: a converted system's manifest is
//      fresh only when it says canvas). A system with no `_components.css` gets a one-line comment
//      one, so R0 has both siblings and is renderable on every Mac (render-rev.ts before S10.4b read
//      any 0-byte sibling as missing; it now accepts one the revision itself has empty, but a peer
//      on an older build still waits on it — DDR-223, emptiness never beats content);
//   3. `revisions/head.json` `{head: R0, base: R0}` with one `convert` log entry — LAST, per system,
//      through ds/head.ts. A system is converted once its head exists.
//
// Nothing a 1.x peer reads changes (S10.12 brief; V2-1.6 §5.15, V2-1.12 F3, 29 "the files keep working
// for code, agents and Tereza's older Maude"): the tokens CSS, `_components.css` and every specimen
// page keep their bytes; tokens.json and the revisions are files a v1 classifier never materialises.
// So conversion is never refused for older peers — on a format-2 project they are read-only anyway.
//
// All or nothing, like `maude migrate v2` (V2-1.12 I2/I3): every file the run will MODIFY is copied
// to `_history/_ds-convert/<stamp>/` (with `report.json`) before the first write — no copy, no run —
// then every write is staged as a temp file and renamed into place; any failure puts back what
// landed (created files removed, modified ones from the copy, a head already written moved into the
// copy) and the project is as it was. `_history/` is per-Mac runtime state (DDR-115): nothing new.
//
// Restore (§5.4 β → α, "Version history keeps the folder view; Restore undoes the conversion"):
// head.json and the Design system canvas are MOVED to `_trash/ds-convert/<ds>-<stamp>/`, tokens.json
// goes back to the folder's own (`source: "css"`), and the revisions stay as unreferenced files.
//
// The canvas is a NEW file, written like `createCanvas` / ds/make.ts write one (the local home and the
// file plane observe it into existence; the kernel's `proposeFiles` only edits canvases it knows), so
// the run carries no kernel action (`actionId: null`) and works in-process too. Names, labels and
// paths are data (DDR-172 D8).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';
import { designSystemCanvasMeta, designSystemCanvasSource } from './board/template.ts';
import type { SectionKind } from './board/types.ts';
import { mapSpecimens, type OwnArtboard } from './convert-map.ts';
import { emitTokensJson } from './emit.ts';
import {
  COMPONENTS_JSON_KEY,
  DS_CANVAS,
  DS_META,
  type DsEngine,
  DsEngineError,
  TOKENS_JSON_KEY,
  withLock,
} from './engine.ts';
import { type By, type LogEntry, moveHeadAside, newHead, readHead, writeHead } from './head.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import {
  type BuiltRevision,
  buildRevision,
  COMPONENTS_CSS_KEY,
  revisionWritePlan,
} from './revision.ts';
import { diskFs, loadSystem, type SystemConfig, systemWriteViolation } from './system.ts';

export const CONVERT_FORMAT = 'maude.ds-convert';
export const SNAPSHOT_DIR_REL = '_history/_ds-convert';
export const RESTORE_TRASH_REL = '_trash/ds-convert';
const DS_ANNOTATIONS = 'design-system.annotations.json';

export type ConvertCode =
  | 'ds-convert-refused'
  | 'ds-convert-nothing'
  | 'ds-convert-failed'
  | 'ds-convert-usage'
  | 'ds-pending-waiting'
  | 'ds-making'
  | 'ds-library'
  | 'ds-not-converted'
  | 'ds-head-invalid';

const STATUS: Record<ConvertCode, number> = {
  'ds-convert-refused': 409,
  'ds-convert-nothing': 409,
  'ds-convert-failed': 500,
  'ds-convert-usage': 400,
  'ds-pending-waiting': 409,
  'ds-making': 409,
  'ds-library': 409,
  'ds-not-converted': 409,
  'ds-head-invalid': 422,
};

/** Same shape as the engine's refusals (`code` + `status` + `detail`): routes/ds.ts answers it. */
export class DsConvertError extends Error {
  readonly code: ConvertCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: ConvertCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DsConvertError';
    this.code = code;
    this.status = STATUS[code];
    if (detail) this.detail = detail;
  }
}

/** Why one system can't be converted (the dialog says it; nothing is written for anyone). */
export type RefusalCode =
  | 'ds-converted'
  | 'ds-convert-outside'
  | 'ds-convert-exists'
  | 'ds-convert-no-css'
  | 'ds-revision-too-large'
  | 'ds-revision-invalid';

export interface ConvertRow {
  name: string;
  path: string;
  label: string;
  /** canvases that render under this system (its own files excluded) */
  canvases: number;
  /** the folder all of them sit in, when they share one (25: "6 canvases in 2026/combine") */
  folder: string | null;
  /** the project's default for new canvases */
  default: boolean;
  /** derived (V2-1.6 §5.2): a system no canvas uses is a draft — converted the same way */
  to: 'design-system' | 'draft';
  /** specimen stems per section (Q5), and the pages no section claims (showcases) */
  sections: Record<SectionKind, string[]>;
  own: OwnArtboard[];
  /** every specimen page — each is its own artboard on the canvas (`mapSpecimens().pages`) */
  specimens: number;
  refused: { code: RefusalCode; message: string } | null;
}

export interface ConvertPlan {
  format: typeof CONVERT_FORMAT;
  v: 1;
  systems: ConvertRow[];
}

export interface ConvertResult extends ConvertPlan {
  result: {
    /** design-root-relative copy of everything the run modified (+ report.json) */
    snapshot: string;
    systems: { name: string; rev: string; canvas: string }[];
  };
}

export interface RestoreResult {
  action: 'restore';
  rev: null;
  actionId: null;
  system: string;
  /** design-root-relative folder the moved files went to */
  trash: string;
  moved: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

const stampOf = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/** One op of the run, design-root-relative. */
interface Op {
  rel: string;
  text: string;
  /** the file existed before (its bytes are in the snapshot) */
  existed: boolean;
}

interface Built {
  row: ConvertRow;
  s: SystemConfig;
  abs: string;
  rev: BuiltRevision;
  ops: Op[];
  head: ReturnType<typeof newHead>;
}

export function createDsConvert(engine: DsEngine) {
  const designRoot = engine.designRoot;
  const iso = () => new Date(engine.now()).toISOString();
  const idx = () => indexRegistry(loadRegistry());

  function config(): Record<string, unknown> {
    const t = readText(path.join(designRoot, 'config.json'));
    if (t === null) return {};
    try {
      const v = JSON.parse(t);
      return isObj(v) ? v : {};
    } catch {
      return {};
    }
  }

  /** `canvasGroups[].path`, or (none declared) the top-level folders — engine.ts's own rule. */
  function groupRoots(cfg: Record<string, unknown>): string[] {
    const declared = Array.isArray(cfg.canvasGroups)
      ? (cfg.canvasGroups as unknown[])
          .map((g) =>
            isObj(g) && typeof g.path === 'string' ? g.path.replace(/^\/+|\/+$/g, '') : ''
          )
          .filter(Boolean)
      : [];
    if (declared.length) return declared;
    try {
      return readdirSync(designRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  function labelOf(cfg: Record<string, unknown>, s: SystemConfig): string {
    const e = (Array.isArray(cfg.designSystems) ? (cfg.designSystems as unknown[]) : []).find(
      (x) => isObj(x) && x.name === s.name
    );
    const l = isObj(e) && typeof e.label === 'string' ? e.label.trim() : '';
    return (l || s.name).slice(0, 64);
  }

  const dsAbs = (s: SystemConfig) => path.join(designRoot, s.path);
  const tokensKey = (s: SystemConfig) => path.posix.relative(s.path, s.tokensCssRel);

  function previewFiles(s: SystemConfig): string[] {
    try {
      return readdirSync(path.join(dsAbs(s), 'preview'));
    } catch {
      return [];
    }
  }

  function refusalOf(
    s: SystemConfig,
    cfg: Record<string, unknown>
  ): { code: RefusalCode; message: string } | null {
    if (readHead(dsAbs(s)).state !== 'absent')
      return { code: 'ds-converted', message: 'it is already a Design system canvas' };
    const outside = systemWriteViolation(designRoot, s);
    if (outside) return { code: 'ds-convert-outside', message: outside };
    const roots = groupRoots(cfg);
    if (!roots.some((g) => s.path === g || s.path.startsWith(`${g}/`)))
      return {
        code: 'ds-convert-outside',
        message: `${s.path} is outside every canvas folder, so its canvas would not be a canvas`,
      };
    const key = tokensKey(s);
    if (key.startsWith('..') || path.posix.isAbsolute(key))
      return {
        code: 'ds-convert-outside',
        message: `${s.tokensCssRel} is outside ${s.path} — a revision freezes only the system's own files`,
      };
    for (const f of [DS_CANVAS, DS_META])
      if (existsSync(path.join(dsAbs(s), f)))
        return {
          code: 'ds-convert-exists',
          message: `${s.path}/${f} already exists — move it first`,
        };
    if (readText(path.join(designRoot, s.tokensCssRel)) === null)
      return { code: 'ds-convert-no-css', message: `${s.tokensCssRel} is missing` };
    return null;
  }

  function rowOf(s: SystemConfig, cfg: Record<string, unknown>): ConvertRow {
    const canvases = engine.canvasesOf(s.name);
    const folders = [
      ...new Set(canvases.map((c) => (c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : ''))),
    ];
    const map = mapSpecimens(previewFiles(s));
    const specimens = map.pages.length;
    return {
      name: s.name,
      path: s.path,
      label: labelOf(cfg, s),
      canvases: canvases.length,
      folder: folders.length === 1 && folders[0] ? folders[0] : null,
      default: cfg.defaultDesignSystem === s.name,
      to: canvases.length ? 'design-system' : 'draft',
      sections: map.sections,
      own: map.own,
      specimens,
      refused: refusalOf(s, cfg),
    };
  }

  /** The dry run (§2.4 `maude.ds-convert/1`): named systems, or every one not yet on a canvas. */
  function plan(names?: readonly string[]): ConvertPlan {
    const cfg = config();
    const all = engine.systems();
    let picked: SystemConfig[];
    if (names?.length) {
      picked = [];
      for (const n of [...new Set(names)]) {
        const s = all.find((x) => x.name === n);
        if (!s)
          throw new DsEngineError(
            'ds-unknown-system',
            `no design system named ${String(n).slice(0, 64)}`
          );
        picked.push(s);
      }
    } else picked = all.filter((s) => readHead(dsAbs(s)).state === 'absent');
    return { format: CONVERT_FORMAT, v: 1, systems: picked.map((s) => rowOf(s, cfg)) };
  }

  /** Everything one system's conversion writes, computed from what is on disk now. */
  function build(row: ConvertRow, s: SystemConfig, by: By): Built {
    const abs = dsAbs(s);
    const model = loadSystem(diskFs(designRoot), s);
    const tk = tokensKey(s);
    // the canvas's own manifest: values from the CSS, every label / value name kept
    const tokensJson = emitTokensJson({ ...model, converted: true }, idx(), model.tokensJson);
    const comps = readText(path.join(abs, COMPONENTS_CSS_KEY));
    const noComps = `/* ${s.name}: no component classes yet */\n`;
    const files: Record<string, string> = {};
    files[tk] = model.css as string;
    files[TOKENS_JSON_KEY] = tokensJson;
    files[COMPONENTS_CSS_KEY] = comps || noComps;
    const cj = readText(path.join(abs, COMPONENTS_JSON_KEY));
    if (cj !== null) files[COMPONENTS_JSON_KEY] = cj;
    let rev: BuiltRevision;
    try {
      rev = buildRevision(s.name, files);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      row.refused = {
        code: e.code === 'ds-revision-too-large' ? 'ds-revision-too-large' : 'ds-revision-invalid',
        message: String(e.message ?? e).slice(0, 200),
      };
      throw err;
    }
    const read = (rel: string) => readText(path.join(abs, rel));
    const working: Record<string, string> = { [TOKENS_JSON_KEY]: tokensJson };
    if (!comps) working[COMPONENTS_CSS_KEY] = noComps;
    const ops: Op[] = revisionWritePlan(read, rev, working, tk).map((w) => ({
      rel: `${s.path}/${w.path}`,
      text: w.text,
      existed: read(w.path) !== null,
    }));
    // every page is its own artboard (decision `v2-michal-ds-specimens-own-artboards`); the same
    // listing the row was planned from (applyLocked re-plans under the locks)
    const pages = mapSpecimens(previewFiles(s)).pages;
    const meta = { title: row.label, ...designSystemCanvasMeta(s.name, pages) };
    ops.push(
      {
        rel: `${s.path}/${DS_CANVAS}`,
        text: designSystemCanvasSource(s.name, row.label, pages),
        existed: false,
      },
      { rel: `${s.path}/${DS_META}`, text: `${JSON.stringify(meta, null, 2)}\n`, existed: false }
    );
    const entry: LogEntry = {
      rev: rev.id,
      parent: null,
      action: 'convert',
      at: iso(),
      by,
      summary: `Converted from ${s.path}`.slice(0, 200),
      actionId: null,
      was: { head: null, base: null },
      is: { head: rev.id, base: rev.id },
    };
    const head = { ...newHead(s.name, { head: rev.id, base: rev.id }), log: [entry] };
    return { row, s, abs, rev, ops, head };
  }

  /** Every system's folder lock (sorted), so no engine op of theirs runs mid-conversion. */
  function lockAll<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const [k, ...rest] = keys;
    return k === undefined ? fn() : withLock(k, () => lockAll(rest, fn));
  }

  async function applyLocked(names: string[], by: By): Promise<ConvertResult> {
    // re-plan under the locks: what the dialog showed may have moved since
    const p = plan(names);
    const refused = p.systems.filter((r) => r.refused);
    if (refused.length)
      throw new DsConvertError(
        'ds-convert-refused',
        `${refused[0].label}: ${refused[0].refused?.message ?? 'refused'} — nothing was converted`,
        { systems: refused.map((r) => ({ name: r.name, ...r.refused })) }
      );
    const configs = engine.systems();
    const built: Built[] = [];
    for (const row of p.systems) {
      const s = configs.find((x) => x.name === row.name) as SystemConfig;
      try {
        built.push(build(row, s, by));
      } catch (err) {
        throw new DsConvertError(
          'ds-convert-refused',
          `${row.label}: ${(err as Error).message} — nothing was converted`,
          { systems: [{ name: row.name, ...row.refused }] }
        );
      }
    }
    const ops = built.flatMap((b) => b.ops);
    const abs = (rel: string) => path.join(designRoot, ...rel.split('/'));

    // I3 — a copy of every file this run modifies, BEFORE the first write; no copy, no run
    const now = engine.now();
    let snapRel = `${SNAPSHOT_DIR_REL}/${stampOf(now)}`;
    for (let n = 2; existsSync(abs(snapRel)); n++)
      snapRel = `${SNAPSHOT_DIR_REL}/${stampOf(now)}-${n}`;
    const snapAbs = abs(snapRel);
    const kept = new Map<string, string>();
    const report = {
      format: 'maude.ds-convert-snapshot',
      v: 1,
      at: iso(),
      by,
      systems: built.map((b) => ({
        name: b.s.name,
        path: b.s.path,
        rev: b.rev.id,
        created: b.ops.filter((o) => !o.existed).map((o) => o.rel),
        modified: b.ops.filter((o) => o.existed).map((o) => o.rel),
        head: `${b.s.path}/revisions/head.json`,
      })),
      rolledBack: false,
    };
    try {
      mkdirSync(snapAbs, { recursive: true });
      for (const o of ops) {
        if (!o.existed) continue;
        const t = readFileSync(abs(o.rel), 'utf8');
        kept.set(o.rel, t);
        const to = path.join(snapAbs, 'files', ...o.rel.split('/'));
        mkdirSync(path.dirname(to), { recursive: true });
        atomicWrite(to, t);
      }
      atomicWrite(path.join(snapAbs, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    } catch (err) {
      rmSync(snapAbs, { recursive: true, force: true });
      throw new DsConvertError(
        'ds-convert-failed',
        `could not keep a copy of the files (${(err as Error).message.slice(0, 120)}) — nothing was converted`
      );
    }

    // I2 — stage every write, rename them all, then each system's head.json last
    const tmp = (rel: string) => `${abs(rel)}.ds-convert.tmp`;
    const landed: Op[] = [];
    const heads: Built[] = [];
    try {
      for (const o of ops) {
        mkdirSync(path.dirname(abs(o.rel)), { recursive: true });
        atomicWrite(tmp(o.rel), o.text);
      }
      for (const o of ops) {
        renameSync(tmp(o.rel), abs(o.rel));
        landed.push(o);
      }
      for (const b of built) {
        writeHead(b.abs, b.head, 'absent');
        heads.push(b);
      }
    } catch (err) {
      for (const b of heads.reverse())
        try {
          moveHeadAside(b.abs, b.head, path.join(snapAbs, 'rolled-back', b.s.name));
        } catch {
          /* best effort — the copy keeps what matters */
        }
      for (const o of landed.reverse())
        try {
          if (!o.existed) rmSync(abs(o.rel), { force: true });
          else atomicWrite(abs(o.rel), kept.get(o.rel) as string);
        } catch {
          /* best effort; the snapshot stays on disk */
        }
      for (const o of ops) rmSync(tmp(o.rel), { force: true });
      try {
        atomicWrite(
          path.join(snapAbs, 'report.json'),
          `${JSON.stringify({ ...report, rolledBack: true }, null, 2)}\n`
        );
      } catch {
        /* the copies are what matter */
      }
      throw new DsConvertError(
        'ds-convert-failed',
        `the conversion stopped (${(err as Error).message.slice(0, 120)}) — everything was put back`
      );
    }
    return {
      ...p,
      result: {
        snapshot: snapRel,
        systems: built.map((b) => ({
          name: b.s.name,
          rev: b.rev.id,
          canvas: `${b.s.path}/${DS_CANVAS}`,
        })),
      },
    };
  }

  /** Convert, in one all-or-nothing run (§5.11 g). */
  async function convert(inp: { systems?: readonly string[]; by: By }): Promise<ConvertResult> {
    const first = plan(inp.systems);
    if (!first.systems.length)
      throw new DsConvertError(
        'ds-convert-nothing',
        'every design system here is already a Design system canvas'
      );
    const names = first.systems.map((r) => r.name);
    const keys = engine
      .systems()
      .filter((s) => names.includes(s.name))
      .map(dsAbs)
      .sort();
    return withLock(path.join(designRoot, '#ds-convert'), () =>
      lockAll(keys, () => applyLocked(names, inp.by))
    );
  }

  /** β → α: Restore of the conversion (§5.4). Nothing is deleted; the revisions stay. */
  async function restore(inp: { ds: string; by: By }): Promise<RestoreResult> {
    const s = engine.systems().find((x) => x.name === inp.ds);
    if (!s)
      throw new DsEngineError(
        'ds-unknown-system',
        `no design system named ${String(inp.ds).slice(0, 64)}`
      );
    const a = dsAbs(s);
    return withLock(a, async () => {
      const h = readHead(a);
      if (h.state === 'absent')
        throw new DsConvertError('ds-not-converted', `${s.name} is already a folder`);
      if (h.state !== 'ok')
        throw new DsConvertError('ds-head-invalid', `${s.name}: head.json is ${h.state}`);
      if (h.doc.head === null && h.doc.base === null)
        throw new DsConvertError('ds-making', `${s.name} is still being made — finish it first`);
      if (h.doc.library)
        throw new DsConvertError('ds-library', 'a linked library is view only here');
      let meta: unknown = null;
      try {
        meta = JSON.parse(readText(path.join(a, DS_META)) ?? 'null');
      } catch {
        /* no meta, nothing waits */
      }
      const p = isObj(meta) && isObj(meta.dsPending) ? meta.dsPending : null;
      const waiting =
        (p && isObj(p.tokens) ? Object.keys(p.tokens).length : 0) +
        (p && isObj(p.components) ? Object.keys(p.components).length : 0);
      if (waiting)
        throw new DsConvertError(
          'ds-pending-waiting',
          `${waiting === 1 ? '1 change waits' : `${waiting} changes wait`} on the Design system canvas — update or cancel first`
        );
      const model = loadSystem(diskFs(designRoot), s);
      // the folder's own manifest again (source "css"), every label kept
      const tokens =
        model.css !== null && model.tokensJson !== null
          ? emitTokensJson({ ...model, converted: false }, idx(), model.tokensJson)
          : null;
      let trashRel = `${RESTORE_TRASH_REL}/${s.name}-${stampOf(engine.now())}`;
      for (let n = 2; existsSync(path.join(designRoot, trashRel)); n++)
        trashRel = `${RESTORE_TRASH_REL}/${s.name}-${stampOf(engine.now())}-${n}`;
      const trashAbs = path.join(designRoot, trashRel);
      // head.json first: from here the system is a folder again (α)
      const moved = moveHeadAside(a, { head: h.doc.head, base: h.doc.base }, trashAbs);
      if (tokens !== null && tokens !== model.tokensJson)
        atomicWrite(path.join(a, TOKENS_JSON_KEY), tokens);
      for (const f of [DS_CANVAS, DS_META, DS_ANNOTATIONS]) {
        const from = path.join(a, f);
        if (!existsSync(from)) continue;
        renameSync(from, path.join(trashAbs, f));
        moved.push(f);
      }
      return {
        action: 'restore',
        rev: null,
        actionId: null,
        system: s.name,
        trash: trashRel,
        moved,
      };
    });
  }

  return { plan, convert, restore };
}

export type DsConvert = ReturnType<typeof createDsConvert>;
