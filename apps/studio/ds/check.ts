// `maude design ds-check` — the system half (V2-1.13 §5.6). Deterministic and read-only:
// presence, per-theme presence of colour roles, value TYPE, and the collisions detectable
// from names and types. Value relations (ordering, lightness, multiples) are `notes` only —
// never part of a level (A14, DDR-043).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMA_DIR } from '../paths.ts';
import { emitTokensJson } from './emit.ts';
import { aliasFor, type RegistryIndex, type Role, slotKindOf } from './registry.ts';
import { type Declaration, declFor, type SystemModel } from './system.ts';
import { cleanValue, exactVarRef, matchesType, varRefs } from './value-types.ts';

export type SystemLevel = 'conformant' | 'missing-roles' | 'private-only';

export const REASON_LEVEL: Record<string, 10 | 11> = {
  'missing-core': 11,
  'native-only': 11,
  'type-collision': 11,
  'signature-collision': 11,
  'missing-functional': 10,
  'theme-gap': 10,
  'single-theme': 10,
  'no-ds-scope': 10,
  'unprefixed-own': 10,
  'alias-not-inverted': 10,
  'unresolved-ref': 10,
  'components-missing': 10,
  'brand-missing': 10,
  'manifest-stale': 10,
};

export interface TypeError_ {
  name: string;
  value: string;
  expected: string;
  line: number;
}

export interface SystemReport {
  name: string;
  path: string;
  level: SystemLevel;
  exit: 0 | 10 | 11;
  themes: string[];
  reasons: string[];
  tier1: {
    required: number;
    present: number;
    missing: string[];
    coveredByAlias: Record<string, string>;
    themeGaps: { name: string; theme: string }[];
    typeErrors: TypeError_[];
    unresolvedRefs: { name: string; ref: string }[];
    servedByFallback: string[];
  };
  tier2: Record<string, string[]>;
  own: { prefixed: string[]; unprefixed: string[] };
  aliases: { native: string; v1: string; inverted: boolean }[];
  collisions: { id: string; name: string; detect: string; resolution?: Record<string, string> }[];
  notes: { id: string; name?: string; detail: string }[];
  noDsScope: { selectors: string; themes: string[] }[];
  components: {
    manifest: 'absent' | 'invalid' | 'ok';
    errors: string[];
    core: Record<
      string,
      {
        present: boolean;
        class: boolean;
        variants: Record<string, boolean>;
        sizes: Record<string, boolean>;
      }
    >;
    brand: { logo: boolean; iconsMissing: string[]; typeRolesMissing: string[] };
    /**
     * Declared gaps: `null` in components.json says "this system has no glyph / variant".
     * A null clears `brand-missing` / `components-missing` at level 0 and nothing else — it is
     * never a real glyph (see `hasRealGlyph`), so a check that needs one still fails.
     */
    declaredMissing: { icons: string[]; variants: string[] };
  };
  manifests: {
    'tokens.json': 'absent' | 'stale' | 'fresh';
    'components.json': 'absent' | 'invalid' | 'ok';
  };
  c7: {
    families: number;
    strategy: string;
    expected: number | null;
    pass: boolean;
    legacyAccentNames: string[];
  };
}

function lineOf(text: string | null, offset: number): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

let componentsValidator: ((d: unknown) => boolean) & { errors?: unknown[] | null } = null as never;
function validateComponents(data: unknown): string[] {
  if (!componentsValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = JSON.parse(
      readFileSync(join(SCHEMA_DIR, 'ds-components-v1.schema.json'), 'utf8')
    );
    componentsValidator = ajv.compile(schema);
  }
  if (componentsValidator(data)) return [];
  return ((componentsValidator.errors ?? []) as { instancePath: string; message?: string }[])
    .slice(0, 20)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
}

/** Resolve a declaration's value to a concrete (non-var) value, following `var()` ≤ 8 deep. */
function resolveValue(
  model: SystemModel,
  d: Declaration,
  depth = 0,
  seen = new Set<string>()
): { value: string } | { unresolved: string } {
  const ref = exactVarRef(d.value);
  if (!ref) return { value: cleanValue(d.value) };
  if (depth >= 8 || seen.has(ref.name)) return { unresolved: ref.name };
  seen.add(ref.name);
  const list = model.byName.get(ref.name);
  if (!list?.length) {
    if (ref.fallback) return { value: ref.fallback };
    return { unresolved: ref.name };
  }
  // same rule → a rule covering one of the same themes → any declaration
  const target =
    list.find((x) => x.rule === d.rule) ??
    d.themes.map((t) => declFor(model, ref.name, t)).find(Boolean) ??
    list[list.length - 1];
  return resolveValue(model, target as Declaration, depth + 1, seen);
}

const LADDERS: { group: string; names: string[]; unit: RegExp }[] = [
  {
    group: 'space',
    names: Array.from({ length: 9 }, (_, i) => `--space-${i}`),
    unit: /^(-?[\d.]+)(px)?$/,
  },
  {
    group: 'type',
    names: ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl'].map((s) => `--type-${s}`),
    unit: /^([\d.]+)px$/,
  },
  {
    group: 'radius',
    names: ['xs', 'sm', 'md', 'lg', 'xl'].map((s) => `--radius-${s}`),
    unit: /^([\d.]+)px$/,
  },
  {
    group: 'dur',
    names: ['flip', 'soft', 'panel', 'route'].map((s) => `--dur-${s}`),
    unit: /^([\d.]+)ms$/,
  },
];

export function accentStrategyCount(strategy: string): number | null {
  if (strategy === 'single') return 1;
  if (strategy === 'paired') return 2;
  const m = /^chromatic-(\d+)$/.exec(strategy);
  return m ? Number(m[1]) : null;
}

export function checkSystem(model: SystemModel, idx: RegistryIndex): SystemReport {
  const cfg = model.config;
  const reg = idx.reg;
  const reasons = new Set<string>();
  const declared = model.declared;
  const presenceActive = cfg.activeFamilies.includes('presence');
  const inScope = (r: Role) => r.family !== 'presence' || presenceActive;

  // ── Tier 1 presence ───────────────────────────────────────────────────────
  const nativeFor = new Map<string, string>(); // v1 → declared native
  for (const name of declared) {
    const a = aliasFor(idx, name, declared);
    if (a && !nativeFor.has(a.v1)) nativeFor.set(a.v1, name);
  }
  const required = reg.roles.filter(inScope);
  const missing: string[] = [];
  const coveredByAlias: Record<string, string> = {};
  const servedByFallback: string[] = [];
  for (const r of required) {
    if (declared.has(r.name)) continue;
    missing.push(r.name);
    const native = nativeFor.get(r.name);
    if (native) coveredByAlias[r.name] = native;
    if (r.origin === 'v1') {
      reasons.add('missing-functional');
      servedByFallback.push(r.name);
    } else reasons.add(native ? 'native-only' : 'missing-core');
  }

  // ── Per-theme presence (colour roles) ──────────────────────────────────────
  const themeGaps: { name: string; theme: string }[] = [];
  for (const r of required) {
    if (!r.perTheme || !declared.has(r.name)) continue;
    for (const t of cfg.themes)
      if (!declFor(model, r.name, t)) themeGaps.push({ name: r.name, theme: t });
  }
  if (themeGaps.length) reasons.add('theme-gap');
  if (cfg.themes.length === 1) reasons.add('single-theme');

  // ── Value types + unresolved refs ──────────────────────────────────────────
  const typeErrors: TypeError_[] = [];
  const unresolvedRefs: { name: string; ref: string }[] = [];
  const seenUnresolved = new Set<string>();
  for (const r of required) {
    for (const d of model.byName.get(r.name) ?? []) {
      for (const v of varRefs(d.value)) {
        if (!declared.has(v.name) && !v.hasFallback && !seenUnresolved.has(`${r.name}>${v.name}`)) {
          seenUnresolved.add(`${r.name}>${v.name}`);
          unresolvedRefs.push({ name: r.name, ref: v.name });
        }
      }
      const res = resolveValue(model, d);
      if ('unresolved' in res) continue; // reported above (or a cycle)
      if (!matchesType(res.value, r.type, reg.valueTypes)) {
        typeErrors.push({
          name: r.name,
          value: cleanValue(d.value),
          expected: r.type,
          line: lineOf(model.css, d.valueStart),
        });
      }
    }
  }
  // A cycle has every name declared, so varRefs() can't see it; catch it here.
  for (const r of required) {
    for (const d of model.byName.get(r.name) ?? []) {
      const res = resolveValue(model, d);
      if (
        'unresolved' in res &&
        declared.has(res.unresolved) &&
        !seenUnresolved.has(`${r.name}>${res.unresolved}`)
      ) {
        seenUnresolved.add(`${r.name}>${res.unresolved}`);
        unresolvedRefs.push({ name: r.name, ref: res.unresolved });
      }
    }
  }
  if (unresolvedRefs.length) reasons.add('unresolved-ref');

  // ── Collisions ────────────────────────────────────────────────────────────
  const collisions: SystemReport['collisions'] = [];
  for (const e of typeErrors) {
    if (!collisions.some((c) => c.id === 'type-mismatch' && c.name === e.name))
      collisions.push({ id: 'type-mismatch', name: e.name, detect: 'type' });
  }
  if (typeErrors.length) reasons.add('type-collision');
  const notes: SystemReport['notes'] = [];
  for (const row of reg.collisions) {
    if (row.detect === 'type') continue;
    let hit: string | null = null;
    if (row.name.includes('*') || row.name.endsWith('-N')) {
      const re = new RegExp(
        `^${row.name
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[a-z0-9-]+')
          .replace(/-N$/, '-\\d+')}$`
      );
      hit = [...declared].find((n) => re.test(n)) ?? null;
    } else if (declared.has(row.name)) hit = row.name;
    if (!hit) continue;
    if (row.detect === 'signature') {
      if ((row.whenDeclared ?? []).every((n) => declared.has(n))) {
        collisions.push({
          id: row.id,
          name: row.name,
          detect: 'signature',
          resolution: row.resolution,
        });
        reasons.add('signature-collision');
      }
    } else if (row.id !== 'ease-out-spring' || isOvershoot(model, row.name)) {
      notes.push({ id: row.id, name: hit, detail: row.meaning });
    }
  }

  // ── Selectors (.ds scope) ──────────────────────────────────────────────────
  const noDsScope: SystemReport['noDsScope'] = [];
  for (const tr of model.themeRules) {
    const dsThemes = new Set(
      tr.selectors
        .map((s) => /^\.ds\s*\[\s*data-theme\s*=\s*["']([^"']+)["']\s*\]$/.exec(s.trim())?.[1])
        .filter(Boolean) as string[]
    );
    const lacking = tr.themes.filter((t) => !dsThemes.has(t));
    if (lacking.length) noDsScope.push({ selectors: tr.selectors.join(', '), themes: lacking });
  }
  if (noDsScope.length || !model.themeRules.length) reasons.add('no-ds-scope');

  // ── Tier 2 / own / aliases ─────────────────────────────────────────────────
  const tier2: Record<string, string[]> = {};
  const own = { prefixed: [] as string[], unprefixed: [] as string[] };
  const aliases: SystemReport['aliases'] = [];
  for (const name of [...declared].sort()) {
    if (idx.roles.has(name)) continue;
    const a = aliasFor(idx, name, declared);
    if (a) {
      const inverted = (model.byName.get(name) ?? []).every((d) => {
        const ref = exactVarRef(d.value);
        return Boolean(ref && ref.name === a.v1 && !ref.fallback);
      });
      aliases.push({ native: name, v1: a.v1, inverted });
      // A prefix-own row (v1 = `--x-<same>`) not yet inverted is an unprefixed own token.
      if (!inverted && idx.ownToken.test(a.v1)) {
        own.unprefixed.push(name);
        reasons.add('unprefixed-own');
      } else if (!inverted) reasons.add('alias-not-inverted');
      continue;
    }
    const kind = slotKindOf(idx, name);
    if (kind) {
      if (!tier2[kind]) tier2[kind] = [];
      tier2[kind].push(name);
      continue;
    }
    if (idx.ownToken.test(name)) own.prefixed.push(name);
    else own.unprefixed.push(name);
  }
  if (own.unprefixed.length) reasons.add('unprefixed-own');

  // ── Components + brand ─────────────────────────────────────────────────────
  const cj = model.componentsJson;
  const compErrors: string[] = [];
  let manifest: 'absent' | 'invalid' | 'ok' = 'absent';
  type Entry = {
    class?: string;
    variants?: Record<string, string | null>;
    sizes?: Record<string, string | null>;
    legacyClasses?: string[];
  };
  let entries: Record<string, Entry> = {};
  let iconMap: Record<string, string | null> = {};
  let typeRoleMap: Record<string, string> = {};
  if (cj.raw !== null) {
    if (cj.parseError) {
      manifest = 'invalid';
      compErrors.push(`components.json: ${cj.parseError}`);
    } else {
      const errs = validateComponents(cj.data);
      manifest = errs.length ? 'invalid' : 'ok';
      compErrors.push(...errs);
      const d = cj.data as {
        components?: Record<string, Entry>;
        icons?: { map?: Record<string, string | null> };
        typeRoles?: Record<string, string>;
      };
      entries = d?.components ?? {};
      iconMap = d?.icons?.map ?? {};
      typeRoleMap = d?.typeRoles ?? {};
    }
  }
  const has = (cls: string) =>
    cls
      .split(/\s+/)
      .filter(Boolean)
      .every((c) => model.componentClasses.has(c));
  const declaredMissingVariants: string[] = [];
  const core: SystemReport['components']['core'] = {};
  let componentsOk = manifest === 'ok';
  for (const c of reg.components.core) {
    const e = entries[c.name];
    const row = {
      present: Boolean(e),
      class: false,
      variants: {} as Record<string, boolean>,
      sizes: {} as Record<string, boolean>,
    };
    if (e?.class) row.class = has(e.class);
    for (const v of c.variants ?? []) {
      const val = e?.variants?.[v];
      row.variants[v] = val === null ? true : typeof val === 'string' ? has(val) : false;
      if (val === null) declaredMissingVariants.push(`${c.name}.${v}`);
    }
    for (const s of c.sizes ?? []) {
      const val = e?.sizes?.[s];
      row.sizes[s] = val === null ? true : typeof val === 'string' ? has(val) : false;
      if (val === null) declaredMissingVariants.push(`${c.name}.size-${s}`);
    }
    if (
      !row.present ||
      !row.class ||
      Object.values(row.variants).includes(false) ||
      Object.values(row.sizes).includes(false)
    )
      componentsOk = false;
    core[c.name] = row;
  }
  if (!componentsOk) reasons.add('components-missing');
  const iconsMissing = reg.icons.vocabulary.filter(
    (n) =>
      !Object.hasOwn(iconMap, n) ||
      (iconMap[n] !== null && (typeof iconMap[n] !== 'string' || !iconMap[n]))
  );
  const declaredMissingIcons = reg.icons.vocabulary.filter(
    (n) => Object.hasOwn(iconMap, n) && iconMap[n] === null
  );
  const typeRolesMissing = reg.typeRoles
    .filter((t) => t.required)
    .map((t) => typeRoleMap[t.role] ?? t.class)
    .filter((cls) => !model.componentClasses.has(cls) && !model.tokensClasses.has(cls));
  const logo = model.logos.length > 0 && model.logoSpecimens.length > 0;
  if (!logo || iconsMissing.length || typeRolesMissing.length) reasons.add('brand-missing');

  // ── Manifests ──────────────────────────────────────────────────────────────
  let tokensState: 'absent' | 'stale' | 'fresh' = 'absent';
  if (model.tokensJson !== null) {
    tokensState =
      emitTokensJson(model, idx, model.tokensJson) === model.tokensJson ? 'fresh' : 'stale';
  }
  if (tokensState !== 'fresh') reasons.add('manifest-stale');

  // ── C7 (accent families) ───────────────────────────────────────────────────
  const indices = new Set<number>();
  const legacyAccentNames: string[] = [];
  const sub = new Set(reg.subRoleSuffixes);
  for (const name of declared) {
    const m = /^--accent-(.+)$/.exec(name);
    if (!m) continue;
    const n = /^(\d+)(?:-|$)/.exec(m[1]);
    if (n) {
      indices.add(Number(n[1]));
      continue;
    }
    if (!sub.has(m[1])) legacyAccentNames.push(name);
  }
  const families = declared.has('--accent') || indices.size ? 1 + indices.size : 0;
  const expected = accentStrategyCount(cfg.accentStrategy);
  if (legacyAccentNames.length)
    notes.push({
      id: 'legacy-accent-name',
      detail: `legacy accent names: ${legacyAccentNames.sort().join(', ')}`,
    });

  // ── Notes: ladders (never a level) ─────────────────────────────────────────
  for (const L of LADDERS) {
    const nums: number[] = [];
    for (const n of L.names) {
      const d = declFor(model, n, cfg.themeDefault) ?? (model.byName.get(n) ?? [])[0];
      if (!d) continue;
      const res = resolveValue(model, d);
      if (!('value' in res)) continue;
      const m = L.unit.exec(res.value);
      if (m) nums.push(Number(m[1]));
    }
    for (let i = 1; i < nums.length; i++) {
      if (!(nums[i] > nums[i - 1])) {
        notes.push({
          id: 'ladder-order',
          name: L.group,
          detail: `--${L.group}-* is not strictly increasing`,
        });
        break;
      }
    }
  }

  const reasonList = [...reasons];
  const exit: 0 | 10 | 11 = reasonList.some((r) => REASON_LEVEL[r] === 11)
    ? 11
    : reasonList.length
      ? 10
      : 0;
  return {
    name: cfg.name,
    path: cfg.path,
    level: exit === 0 ? 'conformant' : exit === 10 ? 'missing-roles' : 'private-only',
    exit,
    themes: cfg.themes,
    reasons: Object.keys(REASON_LEVEL).filter((r) => reasons.has(r)),
    tier1: {
      required: required.length,
      present: required.length - missing.length,
      missing,
      coveredByAlias,
      themeGaps,
      typeErrors,
      unresolvedRefs,
      servedByFallback,
    },
    tier2,
    own,
    aliases,
    collisions,
    notes,
    noDsScope,
    components: {
      manifest,
      errors: compErrors,
      core,
      brand: { logo, iconsMissing, typeRolesMissing },
      declaredMissing: { icons: declaredMissingIcons, variants: declaredMissingVariants },
    },
    manifests: { 'tokens.json': tokensState, 'components.json': manifest },
    c7: {
      families,
      strategy: cfg.accentStrategy,
      expected,
      pass: expected === null || families === expected,
      legacyAccentNames: legacyAccentNames.sort(),
    },
  };
}

/** `--ease-out` as an overshoot curve: a cubic-bezier y outside [0,1], or a linear() > 1. */
function isOvershoot(model: SystemModel, name: string): boolean {
  for (const d of model.byName.get(name) ?? []) {
    const res = resolveValue(model, d);
    if (!('value' in res)) continue;
    const cb = /^cubic-bezier\(([^)]*)\)$/i.exec(res.value);
    if (cb) {
      const p = cb[1].split(',').map((x) => Number(x.trim()));
      if (p[1] < 0 || p[1] > 1 || p[3] < 0 || p[3] > 1) return true;
    }
    const lin = /^linear\(([^)]*)\)$/i.exec(res.value);
    if (lin?.[1].split(',').some((x) => Number(x.trim().split(/\s+/)[0]) > 1)) return true;
  }
  return false;
}

/**
 * Does the system ship a real glyph for a vocabulary icon? A declared `null` is a gap, never a
 * glyph: it clears `brand-missing` at level 0 only (decision v2-2.15-icon-null-declared-gap),
 * and any check that needs the glyph itself (keeper Pass C, a canvas using <Icon name>) asks
 * this and gets `false`.
 */
export function hasRealGlyph(report: SystemReport, name: string): boolean {
  const c = report.components;
  if (c.manifest !== 'ok') return false;
  return !c.declaredMissing.icons.includes(name) && !c.brand.iconsMissing.includes(name);
}
