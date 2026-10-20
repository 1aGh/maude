// The server half of `@maude/ds/board` (S10.6): one design system's working files + `dsPending`
// + the usage cache → a `BoardModel`. Read-only; called by the per-canvas generated module
// (`ds/ds-resolver.ts`) and by tests. Never writes, never reaches the network.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { classifyName } from '../emit.ts';
import { type ModelToken, parseSystem } from '../generate.ts';
import { readHead } from '../head.ts';
import { indexRegistry, loadRegistry, type RegistryIndex } from '../registry.ts';
import { diskFs, loadSystem, type SystemConfig } from '../system.ts';
import { formsOf } from '../value-types.ts';
import { lookOf, type StateRule, stateRulesOf, statesOf } from './component-states.ts';
import { directionsOf } from './directions-model.ts';
import {
  type BoardComponent,
  type BoardLogo,
  type BoardModel,
  type BoardToken,
  type ComponentPatch,
  humanize,
  modesOf,
  type PendingView,
  type SectionKind,
  safeCssName,
  safeCssValue,
  safeSelector,
  type TokenKind,
} from './types.ts';

const MAX_LOGO_BYTES = 24 * 1024;
const COLOUR_GROUPS = new Set([
  'surfaces',
  'text',
  'borders',
  'accent',
  'status',
  'presence',
  'focus',
  'selection',
  'overlay',
]);
const TYPE_GROUPS = new Set(['fonts', 'type', 'weight', 'tracking']);
const SPACE_GROUPS = new Set(['radius', 'space', 'elevation', 'layout']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function readJson(abs: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(abs, 'utf8'));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The form of a value, for tokens the registry does not type (tier 3 / own). */
function kindOfValue(raw: string, name: string): TokenKind {
  const forms = formsOf(raw);
  if (forms.has('hex') || forms.has('color-function') || forms.has('named-color')) return 'color';
  if (forms.has('time')) return 'duration';
  if (forms.has('cubic-bezier') || forms.has('steps') || forms.has('easing-keyword'))
    return 'easing';
  if (/shadow|elevation/.test(name)) return 'shadow';
  if (/font|family/.test(name) || /^["'a-z-]+,/i.test(raw.trim())) return 'font';
  if (forms.has('dimension') || forms.has('percentage') || forms.has('zero')) return 'length';
  if (forms.has('number')) return 'number';
  return 'other';
}

const KIND_BY_TYPE: Record<string, TokenKind> = {
  color: 'color',
  length: 'length',
  'length-or-none': 'length',
  duration: 'duration',
  easing: 'easing',
  number: 'number',
  'line-height': 'number',
  'font-family': 'font',
  shadow: 'shadow',
};

function sectionFor(group: string, kind: TokenKind, slotKind: string | null): SectionKind {
  if (slotKind === 'brand' || slotKind === 'texture' || slotKind === 'device') return 'brand';
  if (slotKind === 'display') return 'type';
  if (slotKind === 'signature-motion') return 'motion';
  if (slotKind === 'palette' || slotKind === 'chart' || slotKind === 'accent-n') return 'colour';
  // focus / selection / overlay hold lengths too (`--focus-ring-width`): only colours are swatches
  if (COLOUR_GROUPS.has(group)) return kind === 'color' ? 'colour' : 'space';
  if (TYPE_GROUPS.has(group)) return 'type';
  if (SPACE_GROUPS.has(group)) return 'space';
  if (group === 'motion') return 'motion';
  switch (kind) {
    case 'color':
      return 'colour';
    case 'font':
    case 'weight':
      return 'type';
    case 'duration':
    case 'easing':
      return 'motion';
    default:
      return 'space';
  }
}

function pendingOf(entry: unknown, themes: string[]): PendingView | null {
  if (!isObj(entry)) return null;
  const values: Record<string, string> = {};
  for (const t of themes) if (typeof entry[t] === 'string') values[t] = entry[t] as string;
  const trash =
    isObj(entry.trash) && typeof entry.trash.replacement === 'string'
      ? entry.trash.replacement
      : null;
  const by = isObj(entry.by) && typeof entry.by.name === 'string' ? entry.by.name : null;
  const valueNames: Record<string, string> = {};
  if (isObj(entry.valueNames))
    for (const [t, n] of Object.entries(entry.valueNames))
      if (typeof n === 'string') valueNames[t] = n;
  return {
    values,
    trashTo: trash,
    added: isObj(entry.add),
    by,
    at: typeof entry.at === 'string' ? entry.at : null,
    valueNames,
    darkFollows: typeof entry.darkFollows === 'boolean' ? entry.darkFollows : null,
  };
}

interface UsageSlice {
  tokens: Record<string, Record<string, { places?: number }>>;
  components: Record<string, Record<string, { instances?: number }>>;
  canvases: number;
}

/** The persisted `ds-usage` cache for one system, or null when the index has not run. */
function readUsage(designRoot: string, system: string): UsageSlice | null {
  const file = readJson(path.join(designRoot, '_cache', 'index', 'ds-usage.json'));
  if (file?.format !== 'maude.ds-usage' || !isObj(file.systems)) return null;
  const s = file.systems[system];
  if (!isObj(s)) return null;
  const canvases = isObj(s.canvases)
    ? Object.values(s.canvases).filter((c) => isObj(c) && c.follows !== false).length
    : 0;
  return {
    tokens: isObj(s.tokens) ? (s.tokens as UsageSlice['tokens']) : {},
    components: isObj(s.components) ? (s.components as UsageSlice['components']) : {},
    canvases,
  };
}

const classMap = (v: unknown): Array<{ name: string; class: string | null }> =>
  isObj(v)
    ? Object.entries(v).map(([name, c]) => ({ name, class: typeof c === 'string' ? c : null }))
    : [];

/** At most this many state rules go into a board (it is inlined into the canvas module). */
const STATE_RULES_MAX = 120;
const PATCHES_MAX = 40;

/** A master's waiting edits as plain declarations; anything a person or agent wrote that isn't one is dropped. */
function patchesOf(entry: unknown): ComponentPatch[] {
  const out: ComponentPatch[] = [];
  if (!isObj(entry)) return out;
  for (const [selector, props] of Object.entries(entry)) {
    if (!safeSelector(selector) || !isObj(props)) continue;
    for (const [prop, e] of Object.entries(props)) {
      if (out.length >= PATCHES_MAX) return out;
      const value = isObj(e) ? e.value : undefined;
      if (/^[a-z][a-z-]{0,48}$/.test(prop) && safeCssValue(value))
        out.push({ selector, prop, value: value.trim() });
    }
  }
  return out;
}

const countCanvases = (m: Record<string, { places?: number; instances?: number }> | undefined) =>
  m ? Object.values(m).filter((u) => ((u?.places ?? u?.instances ?? 0) as number) > 0).length : 0;

function logosOf(designRoot: string, sys: SystemConfig, names: string[]): BoardLogo[] {
  const out: BoardLogo[] = [];
  for (const file of names.slice(0, 8)) {
    let src: string | null = null;
    if (/\.svg$/i.test(file)) {
      try {
        const abs = path.join(designRoot, sys.path, 'assets', 'logos', file);
        if (statSync(abs).size <= MAX_LOGO_BYTES) {
          src = `data:image/svg+xml;base64,${readFileSync(abs).toString('base64')}`;
        }
      } catch {
        src = null;
      }
    }
    out.push({ file, src });
  }
  return out;
}

export function buildBoardModel(
  designRoot: string,
  sys: SystemConfig,
  idx: RegistryIndex = indexRegistry(loadRegistry())
): BoardModel {
  const fs = diskFs(designRoot);
  const loaded = loadSystem(fs, sys);
  const tm = parseSystem({
    config: {
      name: sys.name,
      rootClass: sys.rootClass,
      themes: sys.themes,
      defaultTheme: sys.themeDefault,
      colorSpace: sys.colorSpace,
    },
    tokensCss: loaded.css,
    tokensJson: loaded.tokensJson,
  });
  const metaJson = readJson(path.join(designRoot, sys.path, 'design-system.meta.json'));
  const pending = isObj(metaJson?.dsPending) ? (metaJson.dsPending as Record<string, unknown>) : {};
  const pendingTokens = isObj(pending.tokens) ? pending.tokens : {};
  const pendingComponents = isObj(pending.components) ? pending.components : {};
  const usage = readUsage(designRoot, sys.name);
  const declared = new Set(Object.keys(tm.tokens));
  const modes = modesOf(tm.themes, tm.defaultTheme);

  const build = (css: string, mt: ModelToken | null): BoardToken => {
    const values = mt?.values ?? {};
    const sample = values[tm.defaultTheme] ?? Object.values(values)[0] ?? '';
    const c = classifyName(idx, css, declared);
    const role = idx.roles.get(css);
    const kind: TokenKind =
      role?.group === 'weight'
        ? 'weight'
        : role
          ? (KIND_BY_TYPE[role.type] ?? kindOfValue(sample, css))
          : c.kind === 'display'
            ? css === '--display-weight'
              ? 'weight'
              : 'length'
            : c.kind === 'brand' ||
                c.kind === 'palette' ||
                c.kind === 'chart' ||
                c.kind === 'accent-n'
              ? 'color'
              : kindOfValue(sample, css);
    const data = mt?.data ?? {};
    const label = typeof data.label === 'string' && data.label ? data.label : humanize(css);
    const valueNames: Record<string, string> = {};
    if (isObj(data.valueNames))
      for (const [t, v] of Object.entries(data.valueNames))
        if (typeof v === 'string') valueNames[t] = v;
    const pv = pendingOf(pendingTokens[css], tm.themes);
    return {
      css,
      section: sectionFor(role?.group ?? c.group, kind, c.kind ?? null),
      group: role?.group ?? c.group,
      kind,
      label,
      valueNames,
      locked: data.locked === true,
      darkFollows: typeof data.darkFollows === 'boolean' ? data.darkFollows : null,
      values,
      used: usage ? countCanvases(usage.tokens[css]) : null,
      pending: pv,
    };
  };

  const tokens: BoardToken[] = [];
  for (const [css, mt] of Object.entries(tm.tokens)) {
    const t = build(css, mt);
    if (isObj(mt.data.trashed)) continue; // a tombstone: canvases follow the replacement
    tokens.push(t);
  }
  // a pending `add` names a token no file declares yet
  for (const [css, entry] of Object.entries(pendingTokens)) {
    // a pending entry is data written by people and agents: only a registry-shaped name becomes a swatch
    if (!safeCssName(css) || tm.tokens[css] || !isObj(entry) || !isObj(entry.add)) continue;
    const t = build(css, {
      css,
      values: {},
      data: { label: entry.add.label as string },
      extra: {},
    });
    const sample = Object.values(pendingOf(entry, tm.themes)?.values ?? {})[0] ?? '';
    if (t.kind === 'other') t.kind = kindOfValue(sample, css);
    t.section = sectionFor(t.group, t.kind, null);
    tokens.push(t);
  }

  const raw = loaded.componentsJson.data;
  const comps: BoardComponent[] = [];
  const list = isObj(raw) && isObj(raw.components) ? raw.components : {};
  const stateRules: StateRule[] = [];
  for (const [name, def] of Object.entries(list)) {
    if (!isObj(def)) continue;
    const className = typeof def.class === 'string' ? def.class : null;
    const variants = classMap(def.variants);
    const sizes = classMap(def.sizes);
    // S10.10 — the states its CSS styles, and the rules that draw them
    const classes = [className, ...variants.map((v) => v.class), ...sizes.map((s) => s.class)];
    const rules = stateRulesOf(
      loaded.componentsCss,
      classes.filter((c): c is string => typeof c === 'string')
    );
    for (const r of rules) if (stateRules.length < STATE_RULES_MAX) stateRules.push(r);
    comps.push({
      name,
      label: typeof def.label === 'string' ? def.label : name,
      className,
      variants,
      sizes,
      used: usage ? countCanvases(usage.components[name]) : null,
      pending: isObj(pendingComponents[name]),
      specimen: typeof def.specimen === 'string' ? def.specimen : null,
      states: statesOf(rules),
      look: lookOf(loaded.componentsCss, className),
      patches: patchesOf(pendingComponents[name]),
    });
  }

  const label = typeof tm.meta.label === 'string' && tm.meta.label ? tm.meta.label : sys.name;
  const made = directionsOf(designRoot, sys, tm.themes, tm.defaultTheme, modes.light);
  return {
    format: 'maude.ds-board',
    v: 1,
    system: sys.name,
    label,
    rootClass: sys.rootClass,
    themes: { all: tm.themes, default: tm.defaultTheme, ...modes },
    converted: loaded.converted,
    tokens,
    typeRoles: idx.reg.typeRoles
      .filter((r) => r.required)
      .map((r) => ({ role: r.role, class: r.class })),
    components: comps,
    stateRules,
    logos: logosOf(designRoot, sys, loaded.logos),
    pendingCount: Object.keys(pendingTokens).length + Object.keys(pendingComponents).length,
    canvases: usage ? usage.canvases : null,
    making: made.making,
    directions: made.directions,
    library: libraryOf(designRoot, sys),
  };
}

/** S10.18c: `head.json`'s `library` record, as far as the board needs it — the hub's host, nothing else. */
function libraryOf(designRoot: string, sys: SystemConfig): BoardModel['library'] {
  const h = readHead(path.join(designRoot, sys.path));
  if (h.state !== 'ok' || !isObj(h.doc.library)) return null;
  let home = '';
  try {
    const u = new URL(String(h.doc.library.hub));
    if (/^https?:$/.test(u.protocol)) home = u.host.slice(0, 120);
  } catch {
    /* a record without a usable hub is still a linked library */
  }
  return { home };
}

/** Files the model reads, designRoot-relative: the module cache depends on all of them. */
export function boardDeps(sys: SystemConfig): string[] {
  return [
    sys.tokensCssRel,
    `${sys.path}/tokens.json`,
    `${sys.path}/components.json`,
    `${sys.path}/preview/_components.css`,
    `${sys.path}/design-system.meta.json`,
    `${sys.path}/revisions/head.json`,
    '_cache/index/ds-usage.json',
  ];
}

export const boardModelExists = (designRoot: string, sys: SystemConfig): boolean =>
  existsSync(path.join(designRoot, sys.tokensCssRel));
