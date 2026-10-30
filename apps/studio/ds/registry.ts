// The design-system schema registry loader (V2-1.13 §5.1, §5.3). `schema/ds-schema-v1.json`
// is the single source for roles, value types, slots, own namespace, aliases, collisions,
// components, icons, type roles, S-rules and levels. Everything else (checker, fallbacks,
// templates, cheat-sheet) reads it through here; nothing restates it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_DIR } from '../paths.ts';

export type ValueTypeName =
  | 'color'
  | 'length'
  | 'length-or-none'
  | 'duration'
  | 'easing'
  | 'number'
  | 'line-height'
  | 'font-family'
  | 'shadow';

export type ValueForm =
  | 'var-ref'
  | 'hex'
  | 'color-function'
  | 'named-color'
  | 'light-dark'
  | 'zero'
  | 'dimension'
  | 'percentage'
  | 'math'
  | 'none'
  | 'normal'
  | 'time'
  | 'cubic-bezier'
  | 'steps'
  | 'linear-function'
  | 'easing-keyword'
  | 'number'
  | 'family-list'
  | 'shadow-layers';

export interface Role {
  name: string;
  group: string;
  origin: 'ddr-043' | 'ddr-043-de-facto' | 'v1';
  type: ValueTypeName;
  perTheme: boolean;
  family?: 'presence';
  meaning: string;
  fallback: string | null;
  fallbackUnsupported?: string;
  reducedMotion?: '1ms';
}

export interface Slot {
  kind: string;
  tokenPatterns?: string[];
  names?: string[];
  companions?: string[];
  classPattern?: string;
  roleHints?: string[];
  pairing: string;
  absent: { use?: string; ai: boolean };
}

export interface Alias {
  native: string;
  v1: string;
  context: 'any' | { declares: string[] };
  seenIn?: string[];
}

export interface Collision {
  id: string;
  name: string;
  detect: 'type' | 'signature' | 'judgement';
  whenDeclared?: string[];
  meaning: string;
  resolution?: Record<string, string>;
}

export interface CoreComponent {
  name: string;
  export: string;
  class: string;
  alsoClasses?: string[];
  parts?: string[];
  variants?: string[];
  sizes?: string[];
  tone?: boolean;
  states: string[];
  uiName?: string;
  fallbackCss?: string;
}

export interface TypeRole {
  role: string;
  class: string;
  required: boolean;
  whenSlot?: 'display';
  fallback: Record<string, string>;
}

export interface CanvasRule {
  id: string;
  title: string;
  severity: { default: Severity; strict: Severity };
  blocks: string[];
  autofix?: string[];
}

export type Severity = 'autofix' | 'warning' | 'blocker';

export interface Registry {
  format: 'maude.ds-schema';
  schemaVersion: 1;
  valueTypes: Record<ValueTypeName, { forms: ValueForm[] }>;
  themeRule: Record<string, unknown>;
  roles: Role[];
  subRoleSuffixes: string[];
  slots: Slot[];
  own: { token: string; class: string; component: string; localPalette: string };
  aliases: Alias[];
  collisions: Collision[];
  components: {
    core: CoreComponent[];
    brand: { name: 'Logo' | 'Icon' | 'Text'; export: string; requires: string[] }[];
    extended: CoreComponent[];
    packs?: Record<string, string[]>;
  };
  states: Record<string, string>;
  icons: { vocabulary: string[] };
  typeRoles: TypeRole[];
  selectors: { scopeClass: 'ds'; themeAttribute: 'data-theme' };
  canvasRules: CanvasRule[];
  levels: {
    system: string[];
    canvas: string[];
    exit: Record<string, number>;
  };
}

export const REGISTRY_FILE = 'ds-schema-v1.json';
export const REGISTRY_SCHEMA_FILE = 'ds-schema-v1.schema.json';
export const FALLBACKS_FILE = 'ds-schema-v1.fallbacks.css';

let cached: Registry | null = null;

/** The shipped registry (cached per process). `dir` overrides SCHEMA_DIR for tests. */
export function loadRegistry(dir: string = SCHEMA_DIR): Registry {
  if (dir === SCHEMA_DIR && cached) return cached;
  const reg = JSON.parse(readFileSync(join(dir, REGISTRY_FILE), 'utf8')) as Registry;
  if (reg.format !== 'maude.ds-schema' || reg.schemaVersion !== 1) {
    throw new Error(`${REGISTRY_FILE}: not a maude.ds-schema v1 registry`);
  }
  if (dir === SCHEMA_DIR) cached = reg;
  return reg;
}

/** Typed, indexed view over a registry: the lookups the checker needs, computed once. */
export interface RegistryIndex {
  reg: Registry;
  roles: Map<string, Role>;
  ddr043: Role[];
  functional: Role[];
  slotPatterns: { kind: string; re: RegExp }[];
  slotNames: Map<string, string>;
  ownToken: RegExp;
  ownClass: RegExp;
  localPalette: RegExp;
  aliasesByNative: Map<string, Alias[]>;
}

const indexCache = new WeakMap<Registry, RegistryIndex>();

export function indexRegistry(reg: Registry = loadRegistry()): RegistryIndex {
  const hit = indexCache.get(reg);
  if (hit) return hit;
  const roles = new Map(reg.roles.map((r) => [r.name, r]));
  const slotPatterns: { kind: string; re: RegExp }[] = [];
  const slotNames = new Map<string, string>();
  for (const s of reg.slots) {
    for (const p of s.tokenPatterns ?? []) slotPatterns.push({ kind: s.kind, re: new RegExp(p) });
    for (const n of s.names ?? []) slotNames.set(n, s.kind);
    for (const n of s.companions ?? []) slotNames.set(n, s.kind);
  }
  const aliasesByNative = new Map<string, Alias[]>();
  for (const a of reg.aliases) {
    const list = aliasesByNative.get(a.native) ?? [];
    list.push(a);
    aliasesByNative.set(a.native, list);
  }
  const idx: RegistryIndex = {
    reg,
    roles,
    ddr043: reg.roles.filter((r) => r.origin !== 'v1'),
    functional: reg.roles.filter((r) => r.origin === 'v1'),
    slotPatterns,
    slotNames,
    ownToken: new RegExp(reg.own.token),
    ownClass: new RegExp(reg.own.class),
    localPalette: new RegExp(reg.own.localPalette),
    aliasesByNative,
  };
  indexCache.set(reg, idx);
  return idx;
}

/** The Tier-2 slot kind of a custom-property name, or null. */
export function slotKindOf(idx: RegistryIndex, name: string): string | null {
  const named = idx.slotNames.get(name);
  if (named) return named;
  for (const p of idx.slotPatterns) if (p.re.test(name)) return p.kind;
  return null;
}

/** The alias row that applies to `native` given the names a system declares, or null. */
export function aliasFor(
  idx: RegistryIndex,
  native: string,
  declared: ReadonlySet<string>
): Alias | null {
  for (const a of idx.aliasesByNative.get(native) ?? []) {
    if (a.context === 'any') return a;
    if (a.context.declares.every((n) => declared.has(n))) return a;
  }
  return null;
}
