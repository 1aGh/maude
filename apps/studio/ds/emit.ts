// `system/<ds>/tokens.json` — the deterministic token manifest (V2-1.6 §5.3, phase α:
// `source: "css"`). Same CSS → same bytes. Designer data already in the file (`label`,
// `valueNames`, `locked`, `darkFollows`, `trashed`, root `label` / `fonts`) is kept, matched
// by `css`; everything else is derived from the CSS.

import { aliasFor, type RegistryIndex, slotKindOf } from './registry.ts';
import { declFor, type SystemModel } from './system.ts';
import { exactVarRef } from './value-types.ts';

export const TOKENS_SCHEMA_URL =
  'https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/schema/ds-tokens-v1.schema.json';

const TYPE_GROUP: Record<string, string> = {
  color: 'color',
  length: 'dimension',
  'length-or-none': 'dimension',
  duration: 'duration',
  easing: 'cubicBezier',
  number: 'number',
  'line-height': 'number',
  'font-family': 'fontFamily',
  shadow: 'shadow',
};

const KEPT_LEAF_FIELDS = ['label', 'valueNames', 'locked', 'darkFollows', 'trashed'] as const;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function sortDeep(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

export function stableJson(v: unknown): string {
  return `${JSON.stringify(sortDeep(v as Json), null, 2)}\n`;
}

/** Old designer data, keyed by css name. */
function keptFrom(existing: string | null): {
  leaves: Map<string, Record<string, Json>>;
  root: Record<string, Json>;
} {
  const leaves = new Map<string, Record<string, Json>>();
  const root: Record<string, Json> = {};
  if (!existing) return { leaves, root };
  let doc: Record<string, Json>;
  try {
    doc = JSON.parse(existing);
  } catch {
    return { leaves, root };
  }
  const rootExt = (doc?.$extensions as Record<string, Json> | undefined)?.['sh.maude'] as
    | Record<string, Json>
    | undefined;
  if (rootExt) {
    for (const k of ['label', 'fonts'] as const) if (rootExt[k] !== undefined) root[k] = rootExt[k];
  }
  const walk = (node: Json) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const ext = (node.$extensions as Record<string, Json> | undefined)?.['sh.maude'] as
      | Record<string, Json>
      | undefined;
    if (ext && typeof ext.css === 'string') {
      const kept: Record<string, Json> = {};
      for (const k of KEPT_LEAF_FIELDS) if (ext[k] !== undefined) kept[k] = ext[k];
      if (Object.keys(kept).length) leaves.set(ext.css, kept);
    }
    for (const [k, child] of Object.entries(node))
      if (!k.startsWith('$') || k === '$root') walk(child);
  };
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('$')) walk(v);
  return { leaves, root };
}

interface Classified {
  tier?: 1 | 2 | 3;
  group: string;
  path: string[];
  type?: string;
  kind?: string;
  index?: number;
  alias?: string;
  own?: true;
}

function tier2Type(kind: string, name: string): string | undefined {
  switch (kind) {
    case 'brand':
    case 'palette':
    case 'chart':
    case 'accent-n':
      return 'color';
    case 'display':
      return name === '--display-weight' ? 'fontWeight' : 'dimension';
    case 'signature-motion':
      return name.startsWith('--dur-') ? 'duration' : 'cubicBezier';
    case 'extension':
      if (name.startsWith('--shadow-')) return 'shadow';
      if (name.startsWith('--font-')) return 'fontFamily';
      return 'dimension';
    default:
      return undefined;
  }
}

export function classifyName(idx: RegistryIndex, name: string, declared: Set<string>): Classified {
  const bare = name.slice(2);
  const role = idx.roles.get(name);
  if (role) {
    const group = role.group === 'weight' ? 'fontWeight' : TYPE_GROUP[role.type];
    const dash = bare.indexOf('-');
    const path = dash === -1 ? [bare] : [bare.slice(0, dash), bare.slice(dash + 1)];
    return { tier: 1, group, path, type: group };
  }
  const al = aliasFor(idx, name, declared);
  if (al) return { group: 'alias', path: [bare], alias: al.v1 };
  const kind = slotKindOf(idx, name);
  if (kind) {
    const m = /-(\d+)(?:-[a-z-]+)?$/.exec(name);
    return {
      tier: 2,
      group: kind,
      path: [bare],
      type: tier2Type(kind, name),
      kind,
      index: m ? Number(m[1]) : undefined,
    };
  }
  if (idx.ownToken.test(name)) return { tier: 3, group: 'x', path: [name.slice(4)] };
  return { group: 'own', path: [bare], own: true };
}

/** The DTCG `{group.path}` of a css name (used for exact `var(--name)` aliases). */
function refPath(c: Classified): string {
  return `{${[c.group, ...c.path].join('.')}}`;
}

export function emitTokensJson(
  model: SystemModel,
  idx: RegistryIndex,
  existing: string | null = model.tokensJson
): string {
  const cfg = model.config;
  const { leaves: kept, root: keptRoot } = keptFrom(existing);
  const doc: Record<string, Json> = {};
  const names = [...model.declared].sort();
  const classified = new Map(names.map((n) => [n, classifyName(idx, n, model.declared)]));
  for (const name of names) {
    const c = classified.get(name) as Classified;
    const perTheme: Record<string, string> = {};
    for (const t of cfg.themes) {
      const d = declFor(model, name, t);
      if (d) perTheme[t] = d.value;
    }
    let value: string | undefined = perTheme[cfg.themeDefault];
    if (value === undefined) {
      const first = cfg.themes.find((t) => perTheme[t] !== undefined);
      value = first
        ? perTheme[first]
        : (model.byName.get(name) ?? [])[(model.byName.get(name) ?? []).length - 1]?.value;
    }
    const modes: Record<string, string> = {};
    for (const t of cfg.themes) {
      if (t === cfg.themeDefault) continue;
      if (perTheme[t] !== undefined && perTheme[t] !== value) modes[t] = perTheme[t];
    }
    const ext: Record<string, Json> = { css: name };
    if (c.tier) ext.tier = c.tier;
    if (c.kind) ext.kind = c.kind;
    if (c.index !== undefined) ext.index = c.index;
    if (c.own) ext.own = true;
    if (c.alias) ext.alias = true;
    if (Object.keys(modes).length) ext.modes = modes;
    for (const [k, v] of Object.entries(kept.get(name) ?? {})) ext[k] = v;
    const leaf: Record<string, Json> = { $extensions: { 'sh.maude': ext } };
    if (c.type) leaf.$type = c.type;
    const ref = exactVarRef(value ?? '');
    const target = ref && !ref.fallback ? classified.get(ref.name) : undefined;
    leaf.$value = target ? refPath(target) : (value ?? null);
    // Place the leaf; a token whose path is also a group goes under `$root`.
    let node = doc;
    const path = [c.group, ...c.path];
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      let next = node[k] as Record<string, Json> | undefined;
      if (!next) {
        next = {};
        node[k] = next;
      } else if ('$value' in next) {
        next = { $root: next };
        node[k] = next;
      }
      node = next;
    }
    const last = path[path.length - 1];
    const slot = node[last] as Record<string, Json> | undefined;
    if (slot && !('$value' in slot)) slot.$root = leaf;
    else node[last] = leaf;
  }
  const rootExt: Record<string, Json> = {
    schemaVersion: 1,
    system: cfg.name,
    themes: cfg.themes,
    defaultTheme: cfg.themeDefault,
    source: 'css',
    ...keptRoot,
  };
  if (cfg.rootClass) rootExt.rootClass = cfg.rootClass;
  if (cfg.colorSpace) rootExt.colorSpace = cfg.colorSpace;
  return stableJson({ $schema: TOKENS_SCHEMA_URL, $extensions: { 'sh.maude': rootExt }, ...doc });
}
