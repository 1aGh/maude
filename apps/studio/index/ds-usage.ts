// index/ds-usage.ts — the design-system usage index (S10.5, contract V2-1.6 §5.13, hosted by the
// index service per V2-1.17). Per project and per Mac; derived and rebuildable; persisted at
// `<designRoot>/_cache/index/ds-usage.json` (`_cache` is already runtime-classified in all four
// DDR-115 lists, so there is no new class).
//
//   places    = the direct `var(--name)` uses in a canvas's sources (its .tsx, sibling .css and the
//               non-system stylesheets it imports — V2-1.13 §5.7) PLUS the instances of components
//               whose `_components.css` rules reference the token. The component → token map is
//               derived from the system's CSS.
//   artboards = attribution by the enclosing `DCArtboard id=` range (V2-1.5 rule); a use in a
//               stylesheet is attributed through the classes of its rule's subject (first match).
//   elements  = the element ids (`data-cd-id`, authored or the pipeline's computed id) to ring in the
//               reach view (Q11). Derived, per Mac, not versioned.
//   state/pins come from `ds-check` canvas mode (checkCanvas) — pins live here, never in meta.
//
// Only canvases the host holds are counted (the host lists them): a canvas-scoped checkout never
// sees, so never counts, canvases it does not hold. Incremental: one canvas save re-scans that
// canvas; a system file change re-derives the component → token map from the retained raw scans
// without re-parsing any canvas.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { listElements } from '../canvas-edit.ts';
import { type CanvasContext, type CanvasState, checkCanvas } from '../ds/canvas-check.ts';
import { checkSystem, type SystemReport } from '../ds/check.ts';
import { type CssRule, ownDeclarations, scanCssRules, splitSelectorList } from '../ds/css-scan.ts';
import { indexRegistry, loadRegistry, type RegistryIndex } from '../ds/registry.ts';
import {
  diskFs,
  loadSystem,
  type SystemConfig,
  type SystemModel,
  systemConfigsFrom,
} from '../ds/system.ts';
import { type IdElement, walkIdElements } from '../element-ids.ts';

// ── the persisted shape (§5.13) ──────────────────────────────────────────────────────────────

export interface ElementRef {
  /** the enclosing DCArtboard id, or null (outside every artboard) */
  artboard: string | null;
  /** `data-cd-id` — authored, else the pipeline's computed 8-hex id */
  id: string;
}

export interface TokenUsage {
  places: number;
  direct: number;
  viaComponents: number;
  artboards: Record<string, number>;
  elements: ElementRef[];
}

export interface ComponentUsage {
  instances: number;
  artboards: Record<string, number>;
  elements: ElementRef[];
}

export interface CanvasUsage {
  follows: boolean;
  dsRev: string | null;
  /** `data-ds-rev` attribute counts by revision; `head` is always present */
  elementPins: Record<string, number>;
  /** null when ds-check could not run (no readable registry) */
  state: CanvasState | null;
  pins: Record<string, number>;
}

export interface SystemUsage {
  /** derived: no canvas uses the system */
  draft: boolean;
  canvases: Record<string, CanvasUsage>;
  tokens: Record<string, Record<string, TokenUsage>>;
  components: Record<string, Record<string, ComponentUsage>>;
}

export interface DsUsageFile {
  format: 'maude.ds-usage';
  v: 1;
  builtAt: string;
  /** canvas rel → sha256 over its sources (tsx + sibling css + imported non-system css) */
  sources: Record<string, { sha256: string }>;
  /** fingerprint of everything a system contributes (config entries, tokens, components) */
  systemsHash?: string;
  systems: Record<string, SystemUsage>;
}

export interface DsUsageQuery {
  ds: string;
  css: string | null;
  component: string | null;
  draft: boolean;
  /** sum of `places` (css) or `instances` (component); canvases the system holds when neither */
  places: number;
  canvases: Array<{
    rel: string;
    places: number;
    direct: number;
    viaComponents: number;
    artboards: Record<string, number>;
    elements: ElementRef[];
  }>;
}

export interface DsUsageOptions {
  designRoot: () => string;
  /** The canvases this Mac holds (the ACL boundary) and the system each declares. */
  canvases: () => Iterable<{ rel: string; ds: string | null }>;
  persist?: boolean;
  debounceMs?: number;
  now?: () => number;
}

export interface DsUsageIndex {
  /** The whole file shape (builds on first use). */
  file(): DsUsageFile;
  system(name: string): SystemUsage | undefined;
  query(ds: string, filter?: { css?: string; component?: string }): DsUsageQuery;
  /** Feed any designRoot-relative paths that changed (canvas, meta, stylesheet, system file, config). */
  changed(rels: string[]): void;
  /** Compare every held canvas against its stored hash (after a config change / boot). */
  resync(): void;
  stats(): { scanned: number; checked: number; lastScanMs: number; built: boolean };
  flush(): void;
  stop(): void;
}

// ── raw scan of one canvas ───────────────────────────────────────────────────────────────────

const MAX_ELEMENTS = 500;
const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface Place {
  /** the artboard the place counts under */
  artboard: string | null;
  /** the elements to ring (a stylesheet rule can reach several) */
  ring: ElementRef[];
}

interface Instance {
  /** tag, for `@maude/ds` imports (`Button`); null for a plain element */
  dsComponent: string | null;
  classes: string[];
  ref: ElementRef | null;
  artboard: string | null;
}

interface RawCanvas {
  rel: string;
  sha: string;
  /** every source rel (tsx, sibling css, imported css) — the dependents map */
  deps: string[];
  vars: Map<string, Place[]>;
  instances: Instance[];
  dsRev: string | null;
  elementPins: Record<string, number>;
}

interface Derived {
  ds: string;
  sha: string;
  usage: CanvasUsage;
  tokens: Record<string, TokenUsage>;
  components: Record<string, ComponentUsage>;
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Relative stylesheet imports of a tsx / css source, resolved inside designRoot, outside system/. */
function importedCss(designRoot: string, fromRel: string, text: string, kind: 'tsx' | 'css') {
  const specs: string[] = [];
  if (kind === 'tsx') {
    for (const m of text.matchAll(/import\s+(?:[^'"]*?from\s+)?["'](\.{1,2}\/[^"']+\.css)["']/g))
      specs.push(m[1] as string);
  } else {
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*["'](\.{0,2}\/?[^"']+\.css)["']/g))
      specs.push(m[1] as string);
  }
  const out: string[] = [];
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue;
    const abs = path.resolve(path.dirname(path.join(designRoot, fromRel)), spec);
    const rel = path.relative(designRoot, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || rel.startsWith('system/')) continue;
    out.push(rel);
  }
  return out;
}

/** The sources of a canvas, in a stable order: tsx, sibling css, imported css (two levels). */
function sourcesOf(designRoot: string, rel: string) {
  const out: Array<{ rel: string; text: string; kind: 'tsx' | 'css' }> = [];
  const seen = new Set<string>();
  const add = (r: string, kind: 'tsx' | 'css'): string | null => {
    if (seen.has(r)) return null;
    seen.add(r);
    const text = readText(path.join(designRoot, r));
    if (text === null) return null;
    out.push({ rel: r, text, kind });
    return text;
  };
  const tsx = add(rel, 'tsx');
  if (tsx === null) return null;
  const sibling = rel.replace(/\.tsx$/, '.css');
  const queue: Array<{ rel: string; text: string; kind: 'tsx' | 'css' }> = [
    { rel, text: tsx, kind: 'tsx' },
  ];
  const sib = add(sibling, 'css');
  if (sib !== null) queue.push({ rel: sibling, text: sib, kind: 'css' });
  for (let depth = 0; depth < 2; depth++) {
    const next: typeof queue = [];
    for (const q of queue)
      for (const dep of importedCss(designRoot, q.rel, q.text, q.kind)) {
        const text = add(dep, 'css');
        if (text !== null) next.push({ rel: dep, text, kind: 'css' });
      }
    queue.splice(0, queue.length, ...next);
  }
  return out;
}

const lastCompound = (selector: string): string => {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] as string;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  return selector.slice(start);
};

/** The class names a rule's selector list ends on (its subject), e.g. `.a .b:hover, .c` → b, c. */
export function subjectClasses(selector: string): string[] {
  const out = new Set<string>();
  for (const sel of splitSelectorList(selector))
    for (const m of lastCompound(sel).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1] as string);
  return [...out];
}

const classTokens = (s: string) => s.split(/\s+/).filter(Boolean);

function scanCanvas(designRoot: string, rel: string): RawCanvas | null {
  const sources = sourcesOf(designRoot, rel);
  if (!sources) return null;
  const tsx = sources[0]?.text as string;
  const sha = sha256(sources.map((s) => `${s.rel}\0${s.text}`).join('\0\0'));

  // the elements of the tsx, with their artboard and (computed or authored) id
  const walk = walkIdElements(tsx, rel);
  const els: IdElement[] = walk.ok ? walk.elements : [];
  let ids: Array<string | null> = els.map((e) => e.id);
  const needsComputed = els.some((e) => !e.id);
  if (needsComputed && els.length) {
    try {
      const listed = listElements(path.join(designRoot, rel), tsx);
      if (listed.length === els.length) ids = listed.map((l) => l.id);
    } catch {
      /* authored ids only */
    }
  }
  const refOf = (i: number): ElementRef | null => {
    const id = ids[i];
    return id ? { artboard: (els[i] as IdElement).artboard, id } : null;
  };
  /** innermost element whose range holds `offset` (pre-order: the last start ≤ offset that still ends after it) */
  const elementAt = (offset: number): number => {
    let lo = 0;
    let hi = els.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((els[mid] as IdElement).start <= offset) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    while (found >= 0 && (els[found] as IdElement).end <= offset)
      found = (els[found] as IdElement).parent;
    return found;
  };

  const vars = new Map<string, Place[]>();
  const addPlace = (name: string, p: Place) => {
    const list = vars.get(name);
    if (list) list.push(p);
    else vars.set(name, [p]);
  };

  // direct uses in the tsx
  for (const m of tsx.matchAll(VAR_RE)) {
    const i = els.length ? elementAt(m.index ?? 0) : -1;
    const ref = i >= 0 ? refOf(i) : null;
    addPlace(m[1] as string, {
      artboard: i >= 0 ? (els[i] as IdElement).artboard : null,
      ring: ref ? [ref] : [],
    });
  }

  // elements by class, for attributing stylesheet rules
  const byClass = new Map<string, number[]>();
  els.forEach((e, i) => {
    for (const c of classTokens(e.className)) {
      const list = byClass.get(c);
      if (list) list.push(i);
      else byClass.set(c, [i]);
    }
  });
  for (const s of sources) {
    if (s.kind !== 'css') continue;
    let rules: CssRule[] = [];
    try {
      rules = scanCssRules(s.text);
    } catch {
      rules = [];
    }
    for (const m of s.text.matchAll(VAR_RE)) {
      const off = m.index ?? 0;
      let best = -1;
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r] as CssRule;
        if (
          rule.bodyStart <= off &&
          off < rule.bodyEnd &&
          (best < 0 || rule.bodyStart > (rules[best] as CssRule).bodyStart)
        )
          best = r;
      }
      const selector = best >= 0 ? (rules[best] as CssRule).selector.trim() : '';
      const hit = new Set<number>();
      if (selector && !selector.startsWith('@'))
        for (const cls of subjectClasses(selector))
          for (const i of byClass.get(cls) ?? []) hit.add(i);
      const order = [...hit].sort((a, b) => a - b);
      const ring: ElementRef[] = [];
      for (const i of order) {
        const ref = refOf(i);
        if (ref) ring.push(ref);
      }
      addPlace(m[1] as string, {
        artboard: order.length ? (els[order[0] as number] as IdElement).artboard : null,
        ring,
      });
    }
  }

  // component instances: `@maude/ds` imported tags and elements with literal classes
  const dsLocal = new Map<string, string>(); // local name → imported name
  const dsNamespaces = new Set<string>();
  for (const m of tsx.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@maude\/ds["']/g))
    for (const part of (m[1] as string).split(',')) {
      const [imported, local] = part
        .trim()
        .split(/\s+as\s+/)
        .map((x) => x.trim());
      if (imported) dsLocal.set(local || imported, imported);
    }
  for (const m of tsx.matchAll(
    /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["']@maude\/ds["']/g
  ))
    dsNamespaces.add(m[1] as string);
  const instances: Instance[] = [];
  const elementPins: Record<string, number> = { head: 0 };
  els.forEach((e, i) => {
    let dsComponent: string | null = null;
    if (dsLocal.has(e.tag)) dsComponent = dsLocal.get(e.tag) as string;
    else {
      const dot = e.tag.indexOf('.');
      if (dot > 0 && dsNamespaces.has(e.tag.slice(0, dot))) dsComponent = e.tag.slice(dot + 1);
    }
    const classes = classTokens(e.className);
    if (dsComponent || classes.length)
      instances.push({ dsComponent, classes, ref: refOf(i), artboard: e.artboard });
    for (const [k, v] of e.attrs)
      if (k === 'data-ds-rev' && v) elementPins[v] = (elementPins[v] ?? 0) + 1;
  });

  const metaText = readText(path.join(designRoot, rel.replace(/\.tsx$/, '.meta.json')));
  let dsRev: string | null = null;
  try {
    const m = metaText ? (JSON.parse(metaText) as Record<string, unknown>) : null;
    if (typeof m?.dsRev === 'string' && m.dsRev) dsRev = m.dsRev;
  } catch {
    dsRev = null;
  }
  return {
    rel,
    sha: sha256(`${sha}\0${metaText ?? ''}`),
    deps: sources.map((s) => s.rel),
    vars,
    instances,
    dsRev,
    elementPins,
  };
}

// ── a system: its tokens and the component → token map ──────────────────────────────────────

interface Component {
  /** classes that make an element an instance of this component */
  bases: Set<string>;
  /** every class the component's rules may be written against (bases, variants, elements) */
  all: Set<string>;
  tokens: Set<string>;
}

interface SysInfo {
  cfg: SystemConfig;
  model: SystemModel;
  tokens: Set<string>;
  components: Map<string, Component>;
}

function deriveComponents(model: SystemModel): Map<string, Component> {
  const out = new Map<string, Component>();
  const raw = model.componentsJson.data as {
    components?: Record<
      string,
      {
        class?: unknown;
        variants?: Record<string, unknown>;
        sizes?: Record<string, unknown>;
        legacyClasses?: unknown;
      }
    >;
  } | null;
  const strings = (v: unknown): string[] =>
    typeof v === 'string' ? classTokens(v) : Array.isArray(v) ? v.flatMap(strings) : [];
  const entries = raw && typeof raw === 'object' ? (raw.components ?? {}) : {};
  for (const [name, e] of Object.entries(entries)) {
    if (!e || typeof e !== 'object') continue;
    const base = strings(e.class);
    const legacy = strings(e.legacyClasses);
    if (!base.length && !legacy.length) continue;
    const all = new Set([
      ...base,
      ...legacy,
      ...Object.values(e.variants ?? {}).flatMap(strings),
      ...Object.values(e.sizes ?? {}).flatMap(strings),
    ]);
    out.set(name, { bases: new Set([...base, ...legacy]), all, tokens: new Set() });
  }
  if (!out.size) {
    // no manifest: a component is a class family — `btn`, `btn--ghost`, `btn__label`
    const families = new Map<string, Set<string>>();
    for (const cls of model.componentClasses) {
      const root = cls.split(/--|__/)[0] as string;
      if (!root) continue;
      const set = families.get(root) ?? new Set<string>();
      set.add(cls);
      families.set(root, set);
    }
    for (const [root, all] of families)
      out.set(root, { bases: new Set([root]), all, tokens: new Set() });
  }
  const owner = new Map<string, string>();
  for (const [name, c] of out) for (const cls of c.all) if (!owner.has(cls)) owner.set(cls, name);
  const css = model.componentsCss;
  if (css) {
    const rules = scanCssRules(css);
    rules.forEach((rule, i) => {
      if (rule.selector.trim().startsWith('@')) return;
      const names = new Set<string>();
      for (const cls of subjectClasses(rule.selector)) {
        const n = owner.get(cls);
        if (n) names.add(n);
      }
      if (!names.size) return;
      for (const d of ownDeclarations(css, rules, i))
        for (const m of d.rawValue.matchAll(VAR_RE))
          for (const n of names) (out.get(n) as Component).tokens.add(m[1] as string);
    });
  }
  return out;
}

// ── the index ───────────────────────────────────────────────────────────────────────────────

const refKey = (r: ElementRef) => `${r.artboard ?? ''}\0${r.id}`;
const pushRefs = (into: ElementRef[], seen: Set<string>, refs: ElementRef[]) => {
  for (const r of refs) {
    if (into.length >= MAX_ELEMENTS) return;
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    into.push(r);
  }
};
const bump = (m: Record<string, number>, k: string | null, by = 1) => {
  if (k !== null) m[k] = (m[k] ?? 0) + by;
};

export function createDsUsage(o: DsUsageOptions): DsUsageIndex {
  const persist = o.persist ?? false;
  const debounceMs = o.debounceMs ?? 2000;
  const now = o.now ?? Date.now;
  const raws = new Map<string, RawCanvas>();
  const derived = new Map<string, Derived>();
  /** css rel → canvases that read it */
  const dependents = new Map<string, Set<string>>();
  let systems = new Map<string, SysInfo>();
  let checkCtx: CanvasContext | null = null;
  let checkOk = true;
  let systemsHash = '';
  let built = false;
  let scanned = 0;
  let checked = 0;
  let lastScanMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let cache: DsUsageFile | null = null;
  let registry: RegistryIndex | null = null;

  const designRoot = () => o.designRoot();
  const cachePath = () => path.join(designRoot(), '_cache', 'index', 'ds-usage.json');

  // ── systems ────────────────────────────────────────────────────────────────────────────────
  function loadSystems() {
    const root = designRoot();
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readText(path.join(root, 'config.json')) ?? '{}');
    } catch {
      config = {};
    }
    const fs = diskFs(root);
    const next = new Map<string, SysInfo>();
    const models = new Map<string, SystemModel>();
    const cfgs = systemConfigsFrom(config);
    const hash = createHash('sha256');
    for (const cfg of cfgs) {
      const model = loadSystem(fs, cfg);
      models.set(cfg.name, model);
      next.set(cfg.name, {
        cfg,
        model,
        tokens: model.declared,
        components: deriveComponents(model),
      });
      hash.update(
        [
          JSON.stringify(cfg),
          model.css ?? '',
          model.componentsCss ?? '',
          model.componentsJson.raw ?? '',
        ].join('\0')
      );
    }
    systems = next;
    systemsHash = hash.digest('hex');
    checkOk = true;
    try {
      registry ??= indexRegistry(loadRegistry());
      const reports = new Map<string, SystemReport>();
      for (const [name, m] of models) reports.set(name, checkSystem(m, registry));
      checkCtx = { designRoot: root, config, systems: cfgs, models, reports, idx: registry };
    } catch {
      checkCtx = null;
      checkOk = false;
    }
  }

  function runCheck(rel: string): Pick<CanvasUsage, 'state' | 'pins'> {
    if (!checkCtx || !checkOk) return { state: null, pins: {} };
    try {
      checked++;
      const r = checkCanvas(checkCtx, rel);
      return { state: r.state, pins: r.pins };
    } catch {
      return { state: null, pins: {} };
    }
  }

  // ── derive one canvas against its system ───────────────────────────────────────────────────
  function derive(raw: RawCanvas, ds: string): Derived | null {
    const sys = systems.get(ds);
    if (!sys) return null;
    const tokens: Record<string, TokenUsage> = {};
    const components: Record<string, ComponentUsage> = {};
    const tokenOf = (name: string): TokenUsage =>
      (tokens[name] ??= { places: 0, direct: 0, viaComponents: 0, artboards: {}, elements: [] });
    const seen = new Map<string, Set<string>>();
    const seenOf = (key: string) => {
      let s = seen.get(key);
      if (!s) {
        s = new Set();
        seen.set(key, s);
      }
      return s;
    };

    for (const [name, places] of raw.vars) {
      if (!sys.tokens.has(name)) continue;
      const t = tokenOf(name);
      for (const p of places) {
        t.direct++;
        t.places++;
        bump(t.artboards, p.artboard);
        pushRefs(t.elements, seenOf(name), p.ring);
      }
    }
    // instances of a component: an element carrying one of its base classes, or an `@maude/ds` tag
    const counted = new Set<string>();
    raw.instances.forEach((inst, n) => {
      for (const [cname, comp] of sys.components) {
        const hit =
          (inst.dsComponent !== null && inst.dsComponent === cname) ||
          inst.classes.some((c) => comp.bases.has(c));
        if (!hit) continue;
        const key = `${n}\0${cname}`;
        if (counted.has(key)) continue;
        counted.add(key);
        let c = components[cname];
        if (!c) {
          c = { instances: 0, artboards: {}, elements: [] };
          components[cname] = c;
        }
        c.instances++;
        bump(c.artboards, inst.artboard);
        pushRefs(c.elements, seenOf(`c:${cname}`), inst.ref ? [inst.ref] : []);
        for (const tok of comp.tokens) {
          if (!sys.tokens.has(tok)) continue;
          const t = tokenOf(tok);
          t.viaComponents++;
          t.places++;
          bump(t.artboards, inst.artboard);
          pushRefs(t.elements, seenOf(tok), inst.ref ? [inst.ref] : []);
        }
      }
    });
    const check = runCheck(raw.rel);
    return {
      ds,
      sha: raw.sha,
      usage: {
        follows: raw.dsRev === null,
        dsRev: raw.dsRev,
        elementPins: raw.elementPins,
        state: check.state,
        pins: check.pins,
      },
      tokens,
      components,
    };
  }

  const dsOf = new Map<string, string>();

  function setDeps(rel: string, deps: string[]) {
    for (const set of dependents.values()) set.delete(rel);
    for (const d of deps) {
      let set = dependents.get(d);
      if (!set) {
        set = new Set();
        dependents.set(d, set);
      }
      set.add(rel);
    }
  }

  function forget(rel: string) {
    raws.delete(rel);
    derived.delete(rel);
    dsOf.delete(rel);
    setDeps(rel, []);
  }

  /** Scan (or reuse) one canvas and derive it. `force` re-scans even when the hash matches. */
  function refresh(rel: string, ds: string | null, force: boolean) {
    if (!ds || rel.startsWith('system/') || !systems.has(ds)) {
      forget(rel);
      return;
    }
    const t0 = performance.now();
    const raw = raws.get(rel);
    const prev = derived.get(rel);
    if (!force && prev && prev.ds === ds && !raw) {
      // restored from the file: reuse when the sources are unchanged
      const probe = probeSources(rel);
      if (probe !== null && probe.hash === prev.sha) {
        setDeps(rel, probe.deps);
        dsOf.set(rel, ds);
        return;
      }
    }
    const fresh = scanCanvas(designRoot(), rel);
    if (!fresh) {
      forget(rel);
      return;
    }
    scanned++;
    raws.set(rel, fresh);
    setDeps(rel, fresh.deps);
    dsOf.set(rel, ds);
    const d = derive(fresh, ds);
    if (d) derived.set(rel, d);
    else derived.delete(rel);
    lastScanMs = performance.now() - t0;
    touch();
  }

  /** The hash a fresh scan would store, without parsing (reads the sources only). */
  function probeSources(rel: string): { hash: string; deps: string[] } | null {
    const sources = sourcesOf(designRoot(), rel);
    if (!sources) return null;
    const sha = sha256(sources.map((s) => `${s.rel}\0${s.text}`).join('\0\0'));
    const metaText = readText(path.join(designRoot(), rel.replace(/\.tsx$/, '.meta.json')));
    return { hash: sha256(`${sha}\0${metaText ?? ''}`), deps: sources.map((x) => x.rel) };
  }

  /** Re-derive every canvas from its retained raw scan (a system file changed). */
  function rederiveAll() {
    for (const [rel, raw] of raws) {
      const ds = dsOf.get(rel);
      const d = ds ? derive(raw, ds) : null;
      if (d) derived.set(rel, d);
      else derived.delete(rel);
    }
    // canvases restored from the file have no raw: they need a real scan now
    for (const c of o.canvases()) {
      if (!raws.has(c.rel) && derived.has(c.rel)) refresh(c.rel, c.ds, true);
    }
    touch();
  }

  // ── build / persistence ────────────────────────────────────────────────────────────────────
  function restore() {
    if (!persist) return;
    const text = readText(cachePath());
    if (!text) return;
    try {
      const f = JSON.parse(text) as DsUsageFile;
      if (f.format !== 'maude.ds-usage' || f.v !== 1 || f.systemsHash !== systemsHash) return;
      const per = new Map<string, Derived>();
      for (const [ds, s] of Object.entries(f.systems ?? {})) {
        for (const [rel, usage] of Object.entries(s.canvases ?? {}))
          per.set(rel, {
            ds,
            sha: f.sources?.[rel]?.sha256 ?? '',
            usage,
            tokens: {},
            components: {},
          });
        for (const [name, byCanvas] of Object.entries(s.tokens ?? {}))
          for (const [rel, u] of Object.entries(byCanvas)) {
            const d = per.get(rel);
            if (d) d.tokens[name] = u;
          }
        for (const [name, byCanvas] of Object.entries(s.components ?? {}))
          for (const [rel, u] of Object.entries(byCanvas)) {
            const d = per.get(rel);
            if (d) d.components[name] = u;
          }
      }
      for (const [rel, d] of per) if (d.sha) derived.set(rel, d);
    } catch {
      /* a bad cache is just a cold start */
    }
  }

  function ensureBuilt() {
    if (built) return;
    built = true;
    loadSystems();
    restore();
    syncAll();
  }

  function syncAll() {
    const held = new Map<string, string | null>();
    for (const c of o.canvases()) held.set(c.rel, c.ds);
    for (const rel of [...derived.keys(), ...raws.keys()]) if (!held.has(rel)) forget(rel);
    for (const [rel, ds] of held) {
      const prev = derived.get(rel);
      const dsMoved = prev && prev.ds !== ds;
      if (!raws.has(rel) || dsMoved) refresh(rel, ds, !!dsMoved);
      else {
        // a held canvas whose sources changed behind the watcher's back
        const probe = probeSources(rel);
        if (probe !== null && probe.hash !== raws.get(rel)?.sha) refresh(rel, ds, true);
      }
    }
    touch();
  }

  function file(): DsUsageFile {
    ensureBuilt();
    if (cache) return cache;
    const out: DsUsageFile = {
      format: 'maude.ds-usage',
      v: 1,
      builtAt: new Date(now()).toISOString(),
      sources: {},
      systemsHash,
      systems: {},
    };
    for (const name of systems.keys())
      out.systems[name] = { draft: true, canvases: {}, tokens: {}, components: {} };
    for (const [rel, d] of [...derived].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const s = out.systems[d.ds];
      if (!s) continue;
      out.sources[rel] = { sha256: d.sha };
      s.draft = false;
      s.canvases[rel] = d.usage;
      for (const [n, u] of Object.entries(d.tokens)) {
        s.tokens[n] ??= {};
        (s.tokens[n] as Record<string, TokenUsage>)[rel] = u;
      }
      for (const [n, u] of Object.entries(d.components)) {
        s.components[n] ??= {};
        (s.components[n] as Record<string, ComponentUsage>)[rel] = u;
      }
    }
    cache = out;
    return out;
  }

  function write() {
    timer = null;
    if (!persist || !dirty) return;
    dirty = false;
    try {
      const f = file();
      const target = cachePath();
      mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(f)}\n`);
      renameSync(tmp, target);
    } catch {
      dirty = true;
    }
  }

  function touch() {
    cache = null;
    dirty = true;
    if (!persist) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, debounceMs);
    timer.unref?.();
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────
  const isSystemFile = (rel: string) =>
    rel === 'config.json' ||
    (rel.startsWith('system/') &&
      (rel.endsWith('.css') || rel.endsWith('components.json') || rel.endsWith('tokens.json')));

  function changed(rels: string[]) {
    if (!built) return; // the first build reads everything
    let systemTouched = false;
    const canvasRels = new Set<string>();
    for (const rel of rels) {
      if (isSystemFile(rel)) {
        systemTouched = true;
        continue;
      }
      if (rel.endsWith('.tsx')) canvasRels.add(rel);
      else if (rel.endsWith('.meta.json')) canvasRels.add(rel.replace(/\.meta\.json$/, '.tsx'));
      else if (rel.endsWith('.css'))
        for (const dep of dependents.get(rel) ?? []) canvasRels.add(dep);
    }
    if (systemTouched) {
      const before = systemsHash;
      loadSystems();
      if (systemsHash !== before) {
        syncAll();
        rederiveAll();
      }
    }
    if (!canvasRels.size) return;
    const held = new Map<string, string | null>();
    for (const c of o.canvases()) held.set(c.rel, c.ds);
    for (const rel of canvasRels) {
      if (!held.has(rel)) forget(rel);
      else refresh(rel, held.get(rel) as string | null, true);
    }
    touch();
  }

  return {
    file,
    system: (name) => file().systems[name],
    query(ds, filter = {}) {
      const s = file().systems[ds];
      const q: DsUsageQuery = {
        ds,
        css: filter.css ?? null,
        component: filter.component ?? null,
        draft: s?.draft ?? true,
        places: 0,
        canvases: [],
      };
      if (!s) return q;
      if (filter.css) {
        for (const [rel, u] of Object.entries(s.tokens[filter.css] ?? {})) {
          q.places += u.places;
          q.canvases.push({ rel, ...u });
        }
      } else if (filter.component) {
        for (const [rel, u] of Object.entries(s.components[filter.component] ?? {})) {
          q.places += u.instances;
          q.canvases.push({
            rel,
            places: u.instances,
            direct: u.instances,
            viaComponents: 0,
            artboards: u.artboards,
            elements: u.elements,
          });
        }
      } else {
        for (const rel of Object.keys(s.canvases)) {
          const d = derived.get(rel);
          const places = Object.values(d?.tokens ?? {}).reduce((a, t) => a + t.places, 0);
          q.places += places;
          q.canvases.push({
            rel,
            places,
            direct: 0,
            viaComponents: 0,
            artboards: {},
            elements: [],
          });
        }
      }
      q.canvases.sort((a, b) => (a.rel < b.rel ? -1 : 1));
      return q;
    },
    changed,
    resync() {
      if (!built) return;
      loadSystems();
      syncAll();
      rederiveAll();
    },
    stats: () => ({ scanned, checked, lastScanMs, built }),
    flush() {
      if (!built) return; // never force a full build on the way out
      if (timer) clearTimeout(timer);
      dirty = true;
      write();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Build the usage index soon after a project with design systems boots (V2-8.5 round 7). The index
 * is lazy, but the Design system canvas reads its persisted file when its module compiles — with
 * nothing asking yet, the first board drew no "Used in N canvases" under any swatch. The file is a
 * board dependency (`boardDeps`), so the board recompiles when it lands. A project with no system
 * is never scanned. Returns a cancel.
 */
export function warmDsUsage(
  usage: Pick<DsUsageIndex, 'file'> | null,
  hasSystems: () => boolean,
  schedule: (fn: () => void) => { unref?: () => void } = (fn) => setTimeout(fn, 1200)
): void {
  if (!usage) return;
  const t = schedule(() => {
    try {
      if (hasSystems()) usage.file();
    } catch {
      /* the index is derived and rebuildable — a failed warm-up is the lazy path again */
    }
  });
  t?.unref?.();
}
