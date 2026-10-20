// Making a design system — S10.16a (contract S10-slices §3, V2-1.6 §5.7 `drafts[]`, S10 Q7 / Q8).
//
// The engine behind 13's make flow (three inputs → three directions → pick or mix → sections
// fill in → done) and behind `maude design ds make|draft|use|mix|done`. The AI only ever writes
// through these verbs; the engine stays deterministic:
//
//   make   a config entry + `system/<ds>/` + the Design system canvas (every section an outline)
//          + `revisions/head.json {head: null, base: null}`. The canvas is a NEW file, so it is
//          written like `createCanvas` writes one and the local home / file plane observes it
//          into existence (`proposeFiles` only edits canvases the kernel already knows). A system
//          whose head is null renders its working files (V2-1.6 §5.7–§5.8) and cannot be reviewed
//          or published (`ds-making`, engine.ts).
//   draft  a direction: tokens in → a content-addressed revision under `revisions/` + one entry in
//          `head.json` `drafts[]` (same `direction` again replaces it). Allowed on any system with
//          a head.json — a direction is a draft revision on the same system, never a second system.
//   use    materialise draft X into the working files (while being made).
//   mix    a deterministic merge by registry group: the base direction's tokens, with each taken
//          group replaced WHOLE by another direction's — then materialised like `use`.
//   done   working files → revision R; head = base = R; ONE `make` log entry; the system becomes
//          the project default (unless told not to). Returns the system's level + reasons so the
//          done card can list what is missing.
//
// Section states (Q7) are DERIVED, never stored: `done` = the section's registry groups pass
// `ds-check`; `drawing` = a live AI run holds that `ds-<section>` artboard; `waiting` = otherwise.
//
// Plane B (config, working files, revisions, head.json) is written here in the §5.6 order, tmp +
// rename, head.json LAST and only through ds/head.ts. Nothing here needs the kernel, so every verb
// runs in-process too. Values, labels and names are data (DDR-172 D8): compared and
// written, never obeyed.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { RunRegistry } from '../ai/runs.ts';
import { atomicWrite } from '../sync/atomic-write.ts';
import { designSystemCanvasMeta, designSystemCanvasSource } from './board/template.ts';
import { SECTIONS, type SectionKind } from './board/types.ts';
import { checkSystem, type SystemReport } from './check.ts';
import {
  COMPONENTS_JSON_KEY,
  DS_CANVAS,
  DS_META,
  type DsEngine,
  DsEngineError,
  type DsResult,
  TOKENS_JSON_KEY,
  withLock,
} from './engine.ts';
import {
  emitTokensJson,
  type GenConfig,
  generateTokensCss,
  normalizeModel,
  parseSystem,
  type TokenModel,
} from './generate.ts';
import {
  type By,
  type Draft,
  type HeadDoc,
  newHead,
  type Pointers,
  readHead,
  writeHead,
} from './head.ts';
import { indexRegistry, loadRegistry, slotKindOf } from './registry.ts';
import {
  type BuiltRevision,
  buildRevision,
  COMPONENTS_CSS_KEY,
  type RevisionBody,
  revisionWritePlan,
  verifyRevision,
} from './revision.ts';
import { diskFs, loadSystem, type SystemConfig } from './system.ts';

/* ------------------------------------------------------------------ words */

const fail = (code: ConstructorParameters<typeof DsEngineError>[0], m: string) =>
  new DsEngineError(code, m);

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const SYSTEM_RE = /^[a-z][a-z0-9-]{0,63}$/;
const DIRECTION_RE = /^[a-z]{1,8}$/;
const CSS_NAME_RE = /^--[A-Za-z0-9_-]{1,128}$/;
const DISPLAY_RE = /^\P{Cc}{1,64}$/u;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp};{}]/u;
const VALUE_MAX = 2000;
const COMPONENTS_MAX = 512 * 1024;
const TOKENS_MAX = 2000;

function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- mix vocabulary */

/**
 * What a person (or an AI) means by a word in `--take <group>=<direction>`. A raw registry group
 * name (`radius`, `motion`, `elevation`…) means exactly that group; these two words are wider
 * than any one group.
 */
const COLOUR_GROUPS = [
  'surfaces',
  'text',
  'borders',
  'accent',
  'status',
  'presence',
  'selection',
  'overlay',
  'focus',
] as const;
export const MIX_WORDS: Readonly<Record<string, readonly string[]>> = {
  colour: COLOUR_GROUPS,
  color: COLOUR_GROUPS,
  type: ['fonts', 'type', 'weight', 'tracking'],
};

/** the Tier-2 slot kinds that travel with a word (a chart palette is part of the colour) */
const SLOT_GROUP: Readonly<Record<string, string>> = {
  palette: 'colour',
  chart: 'colour',
  'accent-n': 'colour',
  display: 'type',
  'signature-motion': 'motion',
};

/* ---------------------------------------------------------- the sections */

/** Which registry groups each section is judged by (the Colour section is every colour group). */
export const SECTION_GROUPS: Readonly<Record<SectionKind, readonly string[]>> = {
  brand: [],
  colour: COLOUR_GROUPS,
  type: MIX_WORDS.type,
  space: ['space', 'radius', 'elevation', 'layout'],
  motion: ['motion'],
  components: [],
  patterns: [],
};

export type SectionState = 'waiting' | 'drawing' | 'done';

export interface SectionStates {
  system: string;
  /** the head says the system is still being made */
  making: boolean;
  sections: Record<SectionKind, SectionState>;
  level: number | null;
  reasons: string[];
  drafts: Draft[];
}

/**
 * The artboards of `canvasRel` a live AI run holds right now (a waiting run holds nothing). Mine
 * and other members' runs alike — a section somebody else is drawing is drawing for everyone.
 */
export function heldArtboards(
  registry: Pick<RunRegistry, 'live' | 'view' | 'canvasKey'>,
  canvasRel: string
): Set<string> {
  const key = registry.canvasKey(canvasRel);
  const on = (c: string) => c === key || c === canvasRel;
  const out = new Set<string>();
  for (const r of registry.live()) {
    if (r.state === 'waiting') continue;
    for (const x of [...r.objects, ...(r.scope?.elements ?? [])])
      if (on(x.canvas)) out.add(x.artboard);
  }
  for (const r of registry.view().others) {
    if (r.state === 'waiting') continue;
    for (const x of r.objects) if (on(x.canvas)) out.add(x.artboard);
  }
  return out;
}

/** Pure: the three states from a `ds-check` report and the held artboard ids (Q7). */
export function deriveSectionStates(
  report: SystemReport,
  held: ReadonlySet<string>,
  roleGroup: (name: string) => string | undefined
): Record<SectionKind, SectionState> {
  const bad = new Set<string>([
    ...report.tier1.missing,
    ...report.tier1.themeGaps.map((g) => g.name),
    ...report.tier1.typeErrors.map((e) => e.name),
    ...report.tier1.unresolvedRefs.map((u) => u.name),
  ]);
  const badGroups = new Set<string>();
  for (const n of bad) {
    const g = roleGroup(n);
    if (g) badGroups.add(g);
  }
  const passes: Record<SectionKind, boolean> = {
    brand: !report.reasons.includes('brand-missing') && report.components.brand.logo,
    colour: SECTION_GROUPS.colour.every((g) => !badGroups.has(g)),
    type: SECTION_GROUPS.type.every((g) => !badGroups.has(g)),
    space: SECTION_GROUPS.space.every((g) => !badGroups.has(g)),
    motion: SECTION_GROUPS.motion.every((g) => !badGroups.has(g)),
    components:
      report.components.manifest === 'ok' && !report.reasons.includes('components-missing'),
    patterns: false,
  };
  // Patterns are compositions of everything else: no check of their own, so they wait for the rest.
  passes.patterns = SECTIONS.every((s) => s.kind === 'patterns' || passes[s.kind]);
  const out = {} as Record<SectionKind, SectionState>;
  for (const s of SECTIONS)
    out[s.kind] = held.has(s.id) ? 'drawing' : passes[s.kind] ? 'done' : 'waiting';
  return out;
}

/* ------------------------------------------------------------- the engine */

export interface MakeOptions {
  /** the artboard ids of a canvas a live AI run holds (default: none) */
  held?: (canvasRel: string) => ReadonlySet<string>;
}

export interface DraftInput {
  ds: string;
  direction: string;
  /** css name → `"value"` (every theme) or `{light, dark, valueNames?, add?: {label}}` */
  tokens: unknown;
  label?: string;
  /** optional `preview/_components.css` text for this direction */
  componentsCss?: string;
  by: By;
}

export interface MixInput {
  ds: string;
  /** the direction everything not taken stays from */
  base: string;
  /** group word → direction */
  take: Record<string, string>;
  by: By;
}

export interface MakeResult extends DsResult {
  direction?: string;
  system?: string;
  path?: string;
  level?: number | null;
  reasons?: string[];
  defaultSet?: boolean;
}

export function createDsMake(engine: DsEngine, opts: MakeOptions = {}) {
  const designRoot = engine.designRoot;
  const iso = () => new Date(engine.now()).toISOString();
  const reg = () => indexRegistry(loadRegistry());

  const configAbs = path.join(designRoot, 'config.json');
  const systemOf = (ds: string): SystemConfig => {
    const s = engine.systems().find((x) => x.name === ds);
    if (!s) throw fail('ds-unknown-system', `no design system named ${String(ds).slice(0, 64)}`);
    return s;
  };
  const dsAbs = (s: SystemConfig) => path.join(designRoot, s.path);
  const tokensKey = (s: SystemConfig) => path.posix.relative(s.path, s.tokensCssRel);
  const genConfig = (s: SystemConfig): GenConfig => ({
    name: s.name,
    rootClass: s.rootClass,
    themes: s.themes,
    defaultTheme: s.themeDefault,
    colorSpace: s.colorSpace,
  });
  const workingKeys = (s: SystemConfig) => [
    tokensKey(s),
    TOKENS_JSON_KEY,
    COMPONENTS_JSON_KEY,
    COMPONENTS_CSS_KEY,
  ];

  function readConfig(): Record<string, unknown> {
    const t = readText(configAbs);
    if (t === null) return {};
    try {
      const v = JSON.parse(t);
      if (isObj(v)) return v;
    } catch {
      /* fall through */
    }
    throw fail('ds-make-invalid', 'config.json is not valid JSON — fix it first');
  }
  const configText = (c: Record<string, unknown>) => `${JSON.stringify(c, null, 2)}\n`;

  /** head.json, and only when the system is mid-make (head = base = null) if `making` */
  function headOf(s: SystemConfig, making: boolean): HeadDoc {
    const h = readHead(dsAbs(s));
    if (h.state === 'absent')
      throw fail('ds-not-converted', `${s.name} has no head.json — it is not a made system`);
    if (h.state !== 'ok')
      throw fail('ds-head-invalid', `${s.name}: head.json is ${h.state} (${h.detail})`);
    if (making && !(h.doc.head === null && h.doc.base === null))
      throw fail(
        'ds-not-making',
        `${s.name} is already made — a direction only applies while it is being made`
      );
    return h.doc;
  }
  const pointers = (d: HeadDoc): Pointers => ({ head: d.head, base: d.base });

  function working(s: SystemConfig): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of workingKeys(s)) {
      const t = readText(path.join(dsAbs(s), k));
      if (t !== null) setOwn(out, k, t);
    }
    return out;
  }

  function modelOf(s: SystemConfig, files: Record<string, string>): TokenModel {
    return parseSystem({
      config: genConfig(s),
      tokensCss: files[tokensKey(s)] ?? null,
      tokensJson: files[TOKENS_JSON_KEY] ?? null,
    });
  }

  /** A draft's verified files (key → text). */
  function draftFiles(s: SystemConfig, doc: HeadDoc, direction: string) {
    const d = doc.drafts.find((x) => x.direction === direction);
    if (!d)
      throw fail('ds-unknown-direction', `${s.name} has no direction ${direction.slice(0, 8)}`);
    const text = readText(path.join(dsAbs(s), 'revisions', `${d.rev}.json`));
    if (text === null)
      throw fail('ds-unknown-direction', `direction ${direction} has not arrived on this Mac yet`);
    const v = verifyRevision(d.rev, text);
    if (!v.ok) throw fail('ds-revision-invalid', `direction ${direction} is invalid (${v.detail})`);
    const files: Record<string, string> = {};
    for (const [k, f] of Object.entries((v.body as RevisionBody).files)) setOwn(files, k, f.text);
    return { draft: d, files };
  }

  function writeRevision(s: SystemConfig, rev: BuiltRevision) {
    const read = (rel: string) => readText(path.join(dsAbs(s), rel));
    for (const w of revisionWritePlan(read, rev, {}, tokensKey(s))) {
      const abs = path.join(dsAbs(s), w.path);
      mkdirSync(path.dirname(abs), { recursive: true });
      atomicWrite(abs, w.text);
    }
  }

  /** A direction's files into the working files (only the files the direction carries). */
  function materialise(s: SystemConfig, files: Record<string, string>) {
    for (const k of workingKeys(s)) {
      if (files[k] === undefined) continue;
      const abs = path.join(dsAbs(s), k);
      if (readText(abs) === files[k]) continue;
      mkdirSync(path.dirname(abs), { recursive: true });
      atomicWrite(abs, files[k]);
    }
  }

  /* ----------------------------------------------------------------- make */

  async function makeLocked(inp: { ds: string; label: string; by: By }): Promise<MakeResult> {
    if (typeof inp.ds !== 'string' || !SYSTEM_RE.test(inp.ds))
      throw fail('ds-make-invalid', 'a system name is lowercase letters, digits and dashes');
    const label = typeof inp.label === 'string' && inp.label.trim() ? inp.label.trim() : inp.ds;
    if (!DISPLAY_RE.test(label)) throw fail('ds-make-invalid', 'the name is 1–64 characters');
    const rel = `system/${inp.ds}`;
    const abs = path.join(designRoot, rel);
    const cfg = readConfig();
    const list = Array.isArray(cfg.designSystems) ? (cfg.designSystems as unknown[]) : [];
    if (
      list.some((e) => isObj(e) && (e.name === inp.ds || e.path === rel)) ||
      (existsSync(abs) && readdirSync(abs).length > 0)
    )
      throw fail('ds-exists', `a design system named ${inp.ds} already exists`);
    // everything restorable first, head.json last (the system exists once its head does)
    const priorConfig = readText(configAbs);
    const wrote: string[] = [];
    const put = (relFile: string, text: string) => {
      const a = path.join(abs, relFile);
      mkdirSync(path.dirname(a), { recursive: true });
      atomicWrite(a, text);
      wrote.push(a);
    };
    const undo = () => {
      for (const a of wrote.reverse()) rmSync(a, { force: true });
      for (const d of [path.join(abs, 'preview'), path.join(abs, 'revisions'), abs])
        try {
          rmSync(d, { recursive: false });
        } catch {
          /* not empty or already gone */
        }
      if (priorConfig === null) rmSync(configAbs, { force: true });
      else atomicWrite(configAbs, priorConfig);
    };
    try {
      await withLock(configAbs, async () => {
        const fresh = readConfig();
        const entries = Array.isArray(fresh.designSystems)
          ? [...(fresh.designSystems as unknown[])]
          : [];
        entries.push({
          name: inp.ds,
          label,
          path: rel,
          themes: ['light', 'dark'],
          themeDefault: 'light',
          rootClass: inp.ds,
        });
        setOwn(fresh, 'designSystems', entries);
        atomicWrite(configAbs, configText(fresh));
      });
      put('colors_and_type.css', `/* ${label.replace(/[*/]/g, ' ')} — being made */\n`);
      put('preview/_components.css', '');
      // A NEW canvas is a file on disk the local home / file plane observes into existence (exactly
      // what `createCanvas` does) — the kernel's `proposeFiles` only edits canvases it already knows.
      const meta = { title: label, ...designSystemCanvasMeta(inp.ds, [], { directions: true }) };
      put(DS_CANVAS, designSystemCanvasSource(inp.ds, label, [], { directions: true }));
      put(DS_META, `${JSON.stringify(meta, null, 2)}\n`);
      writeHead(abs, newHead(inp.ds, { head: null, base: null }), 'absent');
      return { action: 'make', rev: null, actionId: null, system: inp.ds, path: rel };
    } catch (err) {
      undo();
      throw err;
    }
  }

  function make(inp: { ds: string; label: string; by: By }): Promise<MakeResult> {
    const ds = typeof inp.ds === 'string' ? inp.ds : '';
    return withLock(path.join(designRoot, 'system', ds), () => makeLocked(inp));
  }

  /* ---------------------------------------------------------------- draft */

  /** Validate the tokens a direction brings and turn them into a model (every theme covered). */
  function modelFromTokens(s: SystemConfig, tokens: unknown): TokenModel {
    if (!isObj(tokens) || !Object.keys(tokens).length)
      throw fail(
        'ds-make-invalid',
        'a direction needs its tokens: {"--name": "value" | {light, dark}}'
      );
    const names = Object.keys(tokens);
    if (names.length > TOKENS_MAX)
      throw fail('ds-make-invalid', `a direction holds at most ${TOKENS_MAX} tokens`);
    const model: TokenModel = {
      system: s.name,
      themes: s.themes,
      defaultTheme: s.themeDefault,
      rootClass: s.rootClass,
      colorSpace: s.colorSpace,
      meta: {},
      extra: {},
      tokens: {},
    };
    const okValue = (css: string, t: string, v: unknown): string => {
      if (typeof v !== 'string' || !v.trim() || v.length > VALUE_MAX || UNSAFE.test(v))
        throw fail('ds-make-invalid', `${css} (${t}): not a value`);
      return v.trim();
    };
    for (const css of names) {
      if (!CSS_NAME_RE.test(css))
        throw fail('ds-make-invalid', `not a token name: ${css.slice(0, 80)}`);
      const e = tokens[css];
      const values: Record<string, string> = {};
      const data: Record<string, unknown> = {};
      if (typeof e === 'string') {
        const v = okValue(css, s.themes[0], e);
        for (const t of s.themes) values[t] = v;
      } else if (isObj(e)) {
        for (const t of s.themes) {
          if (e[t] === undefined)
            throw fail(
              'ds-make-invalid',
              `${css}: a value for ${t} is missing (a plain string is the same in every theme)`
            );
          values[t] = okValue(css, t, e[t]);
        }
        const label = isObj(e.add) ? e.add.label : e.label;
        if (label !== undefined) {
          if (typeof label !== 'string' || !DISPLAY_RE.test(label))
            throw fail('ds-make-invalid', `${css}: a label`);
          data.label = label;
        }
        if (isObj(e.valueNames)) {
          const vn: Record<string, string> = {};
          for (const [t, n] of Object.entries(e.valueNames)) {
            if (typeof n !== 'string' || !DISPLAY_RE.test(n))
              throw fail('ds-make-invalid', `${css}: a value name`);
            vn[t] = n;
          }
          data.valueNames = vn;
        }
      } else throw fail('ds-make-invalid', `${css}: not a value`);
      setOwn(model.tokens as Record<string, unknown>, css, { css, values, data, extra: {} });
    }
    return model;
  }

  async function draftLocked(inp: DraftInput): Promise<MakeResult> {
    const s = systemOf(inp.ds);
    if (typeof inp.direction !== 'string' || !DIRECTION_RE.test(inp.direction))
      throw fail('ds-make-invalid', 'a direction is one to eight lowercase letters');
    const label =
      typeof inp.label === 'string' && inp.label.trim()
        ? inp.label.trim()
        : `Direction ${inp.direction.toUpperCase()}`;
    if (!DISPLAY_RE.test(label))
      throw fail('ds-make-invalid', 'a direction name is 1–64 characters');
    if (
      inp.componentsCss !== undefined &&
      (typeof inp.componentsCss !== 'string' || inp.componentsCss.length > COMPONENTS_MAX)
    )
      throw fail('ds-make-invalid', 'componentsCss is text under 512 KiB');
    const doc = headOf(s, false);
    const model = modelFromTokens(s, inp.tokens);
    const files: Record<string, string> = {};
    setOwn(files, tokensKey(s), generateTokensCss(null, model, genConfig(s)));
    setOwn(files, TOKENS_JSON_KEY, emitTokensJson(model));
    if (inp.componentsCss !== undefined) setOwn(files, COMPONENTS_CSS_KEY, inp.componentsCss);
    const rev = buildRevision(s.name, files);
    writeRevision(s, rev);
    const entry: Draft = { rev: rev.id, label, direction: inp.direction, by: inp.by, at: iso() };
    const at = doc.drafts.findIndex((d) => d.direction === inp.direction);
    const drafts = [...doc.drafts];
    if (at >= 0) drafts[at] = entry;
    else drafts.push(entry);
    writeHead(dsAbs(s), { ...doc, drafts }, pointers(doc));
    return { action: 'draft', rev: rev.id, actionId: null, direction: inp.direction };
  }

  const draft = async (inp: DraftInput) =>
    withLock(dsAbs(systemOf(inp.ds)), () => draftLocked(inp));

  /* ------------------------------------------------------------------ use */

  async function use(inp: { ds: string; direction: string; by: By }): Promise<MakeResult> {
    const s = systemOf(inp.ds);
    return withLock(dsAbs(s), async () => {
      const doc = headOf(s, true);
      const { draft: d, files } = draftFiles(s, doc, String(inp.direction));
      materialise(s, files);
      return { action: 'use', rev: d.rev, actionId: null, direction: d.direction };
    });
  }

  /* ------------------------------------------------------------------ mix */

  function wordGroups(word: string): string[] {
    const known = new Set(reg().reg.roles.map((r) => r.group));
    if (MIX_WORDS[word]) return [...MIX_WORDS[word]];
    if (known.has(word)) return [word];
    throw fail(
      'ds-unknown-group',
      `${word.slice(0, 40)} is not something to mix — try colour, type, ${[...known].filter((g) => !MIX_WORDS.colour.includes(g) && !MIX_WORDS.type.includes(g)).join(', ')}`
    );
  }

  /** the word-level group of one token: a registry role's group, or the slot kind's word */
  function groupOfToken(css: string): string | undefined {
    const idx = reg();
    const role = idx.roles.get(css);
    if (role) return role.group;
    const slot = slotKindOf(idx, css);
    return slot ? SLOT_GROUP[slot] : undefined;
  }

  /** x's tokens with every token of each taken word replaced WHOLE by the named direction's. */
  function mixModels(
    baseModel: TokenModel,
    takes: { word: string; model: TokenModel }[]
  ): TokenModel {
    const out = structuredClone(baseModel);
    for (const { word, model } of takes) {
      const hit = (css: string) => {
        const g = groupOfToken(css);
        return !!g && (g === word || (MIX_WORDS[word] ?? []).includes(g));
      };
      for (const css of Object.keys(out.tokens)) if (hit(css)) delete out.tokens[css];
      for (const [css, tok] of Object.entries(model.tokens))
        if (hit(css)) setOwn(out.tokens as Record<string, unknown>, css, structuredClone(tok));
    }
    return normalizeModel(out);
  }

  async function mix(inp: MixInput): Promise<MakeResult> {
    const s = systemOf(inp.ds);
    return withLock(dsAbs(s), async () => {
      const doc = headOf(s, true);
      const entries = Object.entries(inp.take ?? {});
      if (!entries.length)
        throw fail('ds-make-invalid', 'mix needs something to take: --take colour=c');
      const base = draftFiles(s, doc, String(inp.base));
      const taken = new Map<string, Record<string, string>>();
      const takes = entries.map(([word, dir]) => {
        wordGroups(word); // a mix word or one registry group, else ds-unknown-group
        if (!taken.has(dir)) taken.set(dir, draftFiles(s, doc, String(dir)).files);
        return { word, model: modelOf(s, taken.get(dir) as Record<string, string>) };
      });
      const merged = mixModels(modelOf(s, base.files), takes);
      const files: Record<string, string> = { ...base.files };
      setOwn(files, tokensKey(s), generateTokensCss(null, merged, genConfig(s)));
      setOwn(files, TOKENS_JSON_KEY, emitTokensJson(merged));
      materialise(s, files);
      return { action: 'mix', rev: null, actionId: null, direction: String(inp.base) };
    });
  }

  /* ----------------------------------------------------------------- done */

  function checkOf(s: SystemConfig): SystemReport {
    return checkSystem(loadSystem(diskFs(designRoot), s), reg());
  }

  async function doneLocked(inp: {
    ds: string;
    by: By;
    setDefault?: boolean;
  }): Promise<MakeResult> {
    const s = systemOf(inp.ds);
    const doc = headOf(s, true);
    const work = working(s);
    let model = modelOf(s, work);
    if (!Object.keys(model.tokens).length)
      throw fail('ds-nothing-made', `${s.name} has no tokens yet — nothing to finish`);
    // the manifest is generated from the tokens, so the system is never "stale" the moment it is made
    const manifest = emitTokensJson(model);
    if (work[TOKENS_JSON_KEY] !== manifest) {
      setOwn(work, TOKENS_JSON_KEY, manifest);
      atomicWrite(path.join(dsAbs(s), TOKENS_JSON_KEY), manifest);
    }
    model = modelOf(s, work);
    const rev = buildRevision(s.name, work);
    writeRevision(s, rev);
    const label = readLabel(s.name) ?? s.name;
    const setDefault = inp.setDefault !== false;
    if (setDefault)
      await withLock(configAbs, async () => {
        const cfg = readConfig();
        setOwn(cfg, 'defaultDesignSystem', s.name);
        atomicWrite(configAbs, configText(cfg));
      });
    const was = pointers(doc);
    const is: Pointers = { head: rev.id, base: rev.id };
    writeHead(
      dsAbs(s),
      {
        ...doc,
        head: is.head,
        base: is.base,
        log: [
          {
            rev: rev.id,
            parent: null,
            action: 'make',
            at: iso(),
            by: inp.by,
            summary: `Made ${label}`.slice(0, 200),
            actionId: null,
            was,
            is,
          },
          ...doc.log,
        ],
      },
      was
    );
    const report = checkOf(s);
    return {
      action: 'make',
      rev: rev.id,
      actionId: null,
      system: s.name,
      level: report.exit,
      reasons: report.reasons,
      defaultSet: setDefault,
    };
  }

  function readLabel(ds: string): string | null {
    const e = (
      Array.isArray(readConfig().designSystems) ? (readConfig().designSystems as unknown[]) : []
    ).find((x) => isObj(x) && x.name === ds);
    return isObj(e) && typeof e.label === 'string' && e.label ? e.label.slice(0, 64) : null;
  }

  const done = async (inp: { ds: string; by: By; setDefault?: boolean }) =>
    withLock(dsAbs(systemOf(inp.ds)), () => doneLocked(inp));

  /* -------------------------------------------------------- section states */

  function sections(ds: string): SectionStates {
    const s = systemOf(ds);
    const h = readHead(dsAbs(s));
    const idx = reg();
    const report = checkOf(s);
    const held = opts.held?.(`${s.path}/${DS_CANVAS}`) ?? new Set<string>();
    return {
      system: s.name,
      making: h.state === 'ok' && h.doc.head === null && h.doc.base === null,
      sections: deriveSectionStates(report, held, (n) => idx.roles.get(n)?.group),
      level: report.exit,
      reasons: report.reasons,
      drafts: h.state === 'ok' ? h.doc.drafts : [],
    };
  }

  return { make, draft, use, mix, done, sections };
}

export type DsMake = ReturnType<typeof createDsMake>;
