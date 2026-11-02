// The design-system generator — V2-1.6 §5.5. Once a system is converted (phase β), the Design
// system canvas is the source of truth and the working CSS is GENERATED from its token model:
//
//   parseSystem(files)            CSS (+ tokens.json designer data) → TokenModel
//   generateTokensCss(prev, m)    TokenModel → `colors_and_type.css`, patching `prev` in place
//   generateComponentsCss(prev,e) declaration patches → `preview/_components.css`
//   emitTokensJson(m)             TokenModel → `tokens.json` bytes (§5.3, source "canvas")
//
// Invariants, held by construction:
//   G1  parseSystem(generate(prev, model)) ≡ model, for every token and theme;
//   G2  generate(prev, parseSystem(prev)) === prev byte for byte (an empty publish writes nothing).
//
// Patching follows DDR-172 D7: a block is located top-level only, comment- and string-aware
// (`css-scan.ts`), a value is replaced span-only, and a block that can't be located is a hard
// refusal (`ds-generate-block`, nothing produced). Every value the generator WRITES must stay
// inside its declaration (`ds-generate-value`). The output is read back before it is returned:
// if it would not parse as the model, it is refused rather than written. Pure — no filesystem.
//
// Labels and value names are data (DDR-172 D8): they live in tokens.json only and never reach
// the CSS.

import { ownDeclarations, scanCssRules, splitSelectorList } from './css-scan.ts';
import { classifyName, stableJson, TOKENS_SCHEMA_URL } from './emit.ts';
import { indexRegistry, loadRegistry, type RegistryIndex } from './registry.ts';
import {
  type Declaration,
  declFor,
  loadSystem,
  type SystemConfig,
  type SystemModel,
} from './system.ts';
import { exactVarRef } from './value-types.ts';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObj = { [k: string]: Json };

export interface GenConfig {
  name: string;
  rootClass: string | null;
  themes: string[];
  defaultTheme: string;
  colorSpace?: string | null;
}

export interface ModelToken {
  /** the identity: the CSS custom-property name (= its key in `TokenModel.tokens`) */
  css: string;
  /** theme → the exact CSS value text of the declaration that defines it for that theme
   *  (V2-1.13 §5.3.2: counted rules only, no inheritance). Absent = not declared there. */
  values: Record<string, string>;
  /** `$extensions["sh.maude"]` data that isn't derived from the CSS + registry: label,
   *  valueNames, locked, darkFollows, trashed, canvasUse … and any key a later version adds */
  data: JsonObj;
  /** other leaf keys from tokens.json (`$description`, other `$extensions` namespaces), kept */
  extra: JsonObj;
}

export interface TokenModel {
  system: string;
  themes: string[];
  defaultTheme: string;
  rootClass: string | null;
  colorSpace: string | null;
  /** root `$extensions["sh.maude"]` data that isn't derived: label, fonts, later keys */
  meta: JsonObj;
  /** other root keys from tokens.json (`$description`, other `$extensions` namespaces), kept */
  extra: JsonObj;
  tokens: Record<string, ModelToken>;
}

export interface SystemFiles {
  config: GenConfig;
  tokensCss: string | null;
  tokensJson?: string | null;
}

export interface ComponentEdit {
  /** the selector list of the rule, compared exactly (whitespace-normalised, comments ignored) */
  selector: string;
  property: string;
  value: string;
}

export type GenerateErrorCode = 'ds-generate-block' | 'ds-generate-value';

export class DsGenerateError extends Error {
  readonly code: GenerateErrorCode;
  readonly status: number;
  constructor(code: GenerateErrorCode, message: string) {
    super(message);
    this.name = 'DsGenerateError';
    this.code = code;
    this.status = code === 'ds-generate-block' ? 409 : 422;
  }
}

const blockError = (m: string) => new DsGenerateError('ds-generate-block', m);
const valueError = (m: string) => new DsGenerateError('ds-generate-value', m);

const CSS_NAME_RE = /^--[A-Za-z0-9_-]{1,128}$/;
const THEME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const ROOT_CLASS_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const PROPERTY_RE = /^(?:--[A-Za-z0-9_-]{1,128}|-?[A-Za-z][A-Za-z0-9-]{0,63})$/;
const VALUE_MAX = 2000; // = ds-tokens-v1 `$value` maxLength
const SELECTOR_MAX = 512;
// C0/C1 controls (incl. \n \r \t), format characters (bidi overrides, zero-width), U+2028/2029.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Leaf `sh.maude` keys the emitter derives from the CSS + registry (never model data). */
const DERIVED_LEAF = new Set([
  'css',
  'tier',
  'kind',
  'index',
  'own',
  'alias',
  'modes',
  'role',
  'pairsWith',
]);
/** Root `sh.maude` keys derived from the config. */
const DERIVED_ROOT = new Set([
  'schemaVersion',
  'system',
  'themes',
  'defaultTheme',
  'source',
  'rootClass',
  'colorSpace',
]);

/** `o[k] = v` that a `__proto__` key from untrusted JSON can never turn into a prototype write. */
function put(o: JsonObj, k: string, v: Json): void {
  if (k === '__proto__') return;
  o[k] = v;
}

const isObj = (v: unknown): v is JsonObj => !!v && typeof v === 'object' && !Array.isArray(v);

// ───────────────────────────── validation ─────────────────────────────

/**
 * A CSS fragment the generator writes must stay inside its declaration: no `;` `{` `}` outside a
 * string, no comment delimiters, no `<`, no backslash outside a string, balanced quotes and
 * brackets, no control / format / line-separator characters, ≤ 2000 chars.
 */
function checkFragment(what: string, v: unknown, max = VALUE_MAX): string {
  if (typeof v !== 'string') throw valueError(`${what}: not text`);
  const s = v.trim();
  if (!s) throw valueError(`${what}: empty`);
  if (s.length > max) throw valueError(`${what}: longer than ${max} characters`);
  if (UNSAFE_CHARS.test(s)) throw valueError(`${what}: a control or line-break character`);
  if (s.includes('/*') || s.includes('*/')) throw valueError(`${what}: a comment delimiter`);
  if (s.includes('<')) throw valueError(`${what}: a "<"`);
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '\\') {
          j++;
          continue;
        }
        if (s[j] === ch) break;
      }
      if (j >= s.length) throw valueError(`${what}: an unclosed string`);
      i = j;
      continue;
    }
    if (ch === ';' || ch === '{' || ch === '}' || ch === '\\')
      throw valueError(`${what}: "${ch}" would leave the declaration`);
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') {
      depth--;
      if (depth < 0) throw valueError(`${what}: unbalanced brackets`);
    }
  }
  if (depth !== 0) throw valueError(`${what}: unbalanced brackets`);
  return s;
}

function checkConfig(cfg: GenConfig): void {
  if (!cfg.themes.length) throw blockError('a system needs a theme');
  for (const t of cfg.themes)
    if (!THEME_RE.test(t)) throw valueError(`not a theme name: ${t.slice(0, 40)}`);
  if (!cfg.themes.includes(cfg.defaultTheme))
    throw blockError(`the default theme ${cfg.defaultTheme.slice(0, 40)} is not one of the themes`);
  if (cfg.rootClass !== null && !ROOT_CLASS_RE.test(cfg.rootClass))
    throw valueError(`not a root class: ${cfg.rootClass.slice(0, 40)}`);
}

// ───────────────────────────── model ─────────────────────────────

/**
 * The model the generator actually writes: names checked, values trimmed, a trashed token's
 * values replaced by `var(<replacement>)` (§5.5), derived keys dropped from `data`, tokens
 * with no value in any theme dropped. G1 compares against this.
 */
export function normalizeModel(model: TokenModel): TokenModel {
  const out: TokenModel = structuredClone(model);
  const tokens: Record<string, ModelToken> = {};
  for (const key of Object.keys(out.tokens).sort()) {
    const tok = out.tokens[key];
    if (!CSS_NAME_RE.test(key) || tok.css !== key)
      throw valueError(`not a token name: ${key.slice(0, 80)}`);
    const data: JsonObj = {};
    for (const [k, v] of Object.entries(tok.data ?? {})) if (!DERIVED_LEAF.has(k)) put(data, k, v);
    const values: Record<string, string> = {};
    const trashed = data.trashed;
    const repl =
      isObj(trashed) && typeof trashed.replacement === 'string' ? trashed.replacement : null;
    if (repl !== null && !CSS_NAME_RE.test(repl))
      throw valueError(`${key}: not a replacement name: ${repl.slice(0, 80)}`);
    for (const [t, v] of Object.entries(tok.values ?? {})) {
      if (typeof v !== 'string') throw valueError(`${key} (${t}): not text`);
      values[t] = repl ? `var(${repl})` : v.trim();
    }
    if (!Object.keys(values).length) continue;
    tokens[key] = { css: key, values, data, extra: tok.extra ?? {} };
  }
  out.tokens = tokens;
  return out;
}

function memSystem(css: string, cfg: GenConfig): SystemModel {
  const sc: SystemConfig = {
    name: cfg.name,
    path: '.',
    tokensCssRel: 'tokens.css',
    rootClass: cfg.rootClass,
    themes: cfg.themes,
    themeDefault: cfg.defaultTheme,
    activeFamilies: [],
    accentStrategy: 'single',
    colorSpace: cfg.colorSpace ?? null,
  };
  return loadSystem({ read: (rel) => (rel === 'tokens.css' ? css : null), list: () => null }, sc);
}

/** css → theme → value, for names declared in a rule that covers at least one theme */
function themedValues(sys: SystemModel, themes: string[]): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const name of [...sys.declared].sort()) {
    const values: Record<string, string> = {};
    for (const t of themes) {
      const d = declFor(sys, name, t);
      if (d) values[t] = d.value;
    }
    if (Object.keys(values).length) out.set(name, values);
  }
  return out;
}

interface JsonSide {
  leaves: Map<string, { data: JsonObj; extra: JsonObj }>;
  meta: JsonObj;
  extra: JsonObj;
}

function readTokensJson(text: string | null | undefined): JsonSide {
  const side: JsonSide = { leaves: new Map(), meta: {}, extra: {} };
  if (!text) return side;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return side;
  }
  if (!isObj(doc)) return side;
  const splitExt = (node: JsonObj, extra: JsonObj): JsonObj | null => {
    const ext = node.$extensions;
    if (!isObj(ext)) return null;
    const others: JsonObj = {};
    for (const [k, v] of Object.entries(ext)) if (k !== 'sh.maude') put(others, k, v);
    if (Object.keys(others).length) put(extra, '$extensions', others);
    return isObj(ext['sh.maude']) ? (ext['sh.maude'] as JsonObj) : null;
  };
  const rootMaude = splitExt(doc, side.extra);
  for (const [k, v] of Object.entries(doc))
    if (k.startsWith('$') && k !== '$schema' && k !== '$extensions') put(side.extra, k, v);
  if (rootMaude)
    for (const [k, v] of Object.entries(rootMaude)) if (!DERIVED_ROOT.has(k)) put(side.meta, k, v);
  const walk = (node: Json, depth: number) => {
    if (!isObj(node) || depth > 32) return;
    if ('$value' in node) {
      const extra: JsonObj = {};
      const ext = splitExt(node, extra);
      if (!ext || typeof ext.css !== 'string') return;
      for (const [k, v] of Object.entries(node))
        if (k !== '$value' && k !== '$type' && k !== '$extensions') put(extra, k, v);
      const data: JsonObj = {};
      for (const [k, v] of Object.entries(ext)) if (!DERIVED_LEAF.has(k)) put(data, k, v);
      side.leaves.set(ext.css, { data, extra });
      return;
    }
    for (const [k, child] of Object.entries(node))
      if (!k.startsWith('$') || k === '$root') walk(child, depth + 1);
  };
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('$')) walk(v, 0);
  return side;
}

/** CSS (+ tokens.json designer data and unknown keys) → TokenModel. */
export function parseSystem(files: SystemFiles): TokenModel {
  const cfg = files.config;
  const side = readTokensJson(files.tokensJson);
  const tokens: Record<string, ModelToken> = {};
  if (files.tokensCss) {
    const sys = memSystem(files.tokensCss, cfg);
    for (const [name, values] of themedValues(sys, cfg.themes)) {
      const kept = side.leaves.get(name);
      tokens[name] = {
        css: name,
        values,
        data: kept ? kept.data : {},
        extra: kept ? kept.extra : {},
      };
    }
  }
  return {
    system: cfg.name,
    themes: [...cfg.themes],
    defaultTheme: cfg.defaultTheme,
    rootClass: cfg.rootClass,
    colorSpace: cfg.colorSpace ?? null,
    meta: side.meta,
    extra: side.extra,
    tokens,
  };
}

// ───────────────────────────── tokens CSS ─────────────────────────────

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].end > sorted[i - 1].start && sorted[i].start !== sorted[i - 1].start)
      throw blockError('two edits overlap — refusing');
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** start of the property name of a declaration whose value starts at `valueStart` */
function nameStartOf(text: string, name: string, valueStart: number): number {
  return text.lastIndexOf(name, valueStart);
}

/** The range that removes one declaration (its whole line when it is alone on it). */
function removalRange(
  text: string,
  d: { name: string; valueStart: number; declEnd: number }
): Edit {
  const nameStart = nameStartOf(text, d.name, d.valueStart);
  const lineStart = text.lastIndexOf('\n', nameStart - 1) + 1;
  let end = d.declEnd;
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  const aloneBefore = text.slice(lineStart, nameStart).trim() === '';
  if (aloneBefore && text[end] === '\n') return { start: lineStart, end: end + 1, text: '' };
  return { start: nameStart, end, text: '' };
}

/** Insertion of `lines` (`name: value`) before `ruleIdx`'s closing `}`, in the block's style. */
function insertionEdits(
  text: string,
  rules: ReturnType<typeof scanCssRules>,
  ruleIdx: number,
  items: [string, string][],
  removedStarts: Set<number>
): Edit[] {
  const r = rules[ruleIdx];
  const own = ownDeclarations(text, rules, ruleIdx).filter((d) => !removedStarts.has(d.valueStart));
  const edits: Edit[] = [];
  const last = own[own.length - 1];
  // the last declaration may omit its `;` — give it one before anything follows it
  if (last && !/^\s*;/.test(text.slice(last.valueEnd, r.bodyEnd)))
    edits.push({ start: last.valueEnd, end: last.valueEnd, text: ';' });
  const close = r.bodyEnd;
  const ls = text.lastIndexOf('\n', close - 1) + 1;
  if (ls > r.bodyStart && text.slice(ls, close).trim() === '') {
    let indent = '  ';
    if (last) {
      const ns = nameStartOf(text, last.prop, last.valueStart);
      const lineStart = text.lastIndexOf('\n', ns - 1) + 1;
      const before = text.slice(lineStart, ns);
      if (/^[ \t]*$/.test(before)) indent = before;
    } else {
      const selLine = text.lastIndexOf('\n', r.bodyStart - 1) + 1;
      const lead = /^[ \t]*/.exec(text.slice(selLine))?.[0] ?? '';
      indent = `${lead}  `;
    }
    edits.push({
      start: ls,
      end: ls,
      text: items.map(([n, v]) => `${indent}${n}: ${v};\n`).join(''),
    });
  } else {
    const prefix = /\s/.test(text[close - 1] ?? '') ? '' : ' ';
    edits.push({
      start: close,
      end: close,
      text: `${prefix}${items.map(([n, v]) => `${n}: ${v};`).join(' ')} `,
    });
  }
  return edits;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function themeSelectors(cfg: GenConfig, themes: string[]): string[] {
  const out: string[] = [];
  if (themes.includes(cfg.defaultTheme)) out.push(':root');
  for (const t of themes) {
    if (cfg.rootClass) out.push(`.${cfg.rootClass}[data-theme="${t}"]`);
    out.push(`.ds[data-theme="${t}"]`);
  }
  return out;
}

const FRESH_HEADER = '/* Design tokens — generated by Maude from the Design system canvas. */\n';

/** `prev === null`: the template's block structure (one block per theme, the invariant block,
 *  reduced motion); values from the model, structure only from the template (DDR-043). */
function freshTokensCss(m: TokenModel, cfg: GenConfig): string {
  const order = [cfg.defaultTheme, ...cfg.themes.filter((t) => t !== cfg.defaultTheme)];
  const perTheme = new Map<string, [string, string][]>(order.map((t) => [t, []]));
  const invariant: [string, string][] = [];
  for (const [name, tok] of Object.entries(m.tokens).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const vals = cfg.themes.map((t) => tok.values[t]);
    const shared =
      cfg.themes.length > 1 && vals.every((v) => v !== undefined && v === vals[0]) ? vals[0] : null;
    if (shared !== null) invariant.push([name, checkFragment(name, shared)]);
    else
      for (const t of cfg.themes)
        if (tok.values[t] !== undefined)
          perTheme.get(t)?.push([name, checkFragment(`${name} (${t})`, tok.values[t])]);
  }
  const block = (sels: string[], items: [string, string][], indent = '') =>
    `${indent}${sels.join(`,\n${indent}`)} {\n${items.map(([n, v]) => `${indent}  ${n}: ${v};\n`).join('')}${indent}}\n`;
  const blocks = order.map((t) => block(themeSelectors(cfg, [t]), perTheme.get(t) ?? []));
  if (cfg.themes.length > 1) blocks.push(block(themeSelectors(cfg, order), invariant));
  const durs = Object.keys(m.tokens)
    .filter((n) => n.startsWith('--dur-'))
    .sort()
    .map((n): [string, string] => [n, '1ms']);
  blocks.push(
    `@media (prefers-reduced-motion: reduce) {\n${block(themeSelectors(cfg, order), durs, '  ')}}\n`
  );
  return `${FRESH_HEADER}\n${blocks.join('\n')}`;
}

function patchTokensCss(prev: string, m: TokenModel, cfg: GenConfig): string {
  const sys = memSystem(prev, cfg);
  const { rules } = sys;
  const ruleThemes = new Map<number, string[]>();
  for (const tr of sys.themeRules) ruleThemes.set(tr.rule, tr.themes);
  const topLevel = (i: number) => rules[i].parent === -1 && !rules[i].atRule;
  /** the last top-level rule whose theme set is exactly `themes` */
  const exactBlock = (themes: string[]): number => {
    let hit = -1;
    for (const [i, ts] of ruleThemes) if (topLevel(i) && sameSet(ts, themes) && i > hit) hit = i;
    return hit;
  };

  const edits: Edit[] = [];
  const removed = new Set<number>(); // declarations removed, by valueStart
  const replaced = new Set<number>();
  const inserts = new Map<number, [string, string][]>();
  const remove = (d: Declaration) => {
    if (removed.has(d.valueStart)) return;
    removed.add(d.valueStart);
    edits.push(removalRange(prev, d));
  };
  const replace = (d: { valueStart: number; valueEnd: number }, value: string) => {
    if (replaced.has(d.valueStart)) return;
    replaced.add(d.valueStart);
    edits.push({ start: d.valueStart, end: d.valueEnd, text: value });
  };
  const insert = (rule: number, name: string, value: string) => {
    const list = inserts.get(rule) ?? [];
    list.push([name, value]);
    inserts.set(rule, list);
  };
  const upsert = (name: string, t: string, value: string) => {
    const b = exactBlock([t]);
    if (b < 0)
      throw blockError(
        `could not locate the top-level "${t}" block — this file's theme structure isn't recognized`
      );
    const own = (sys.byName.get(name) ?? []).filter(
      (d) => d.rule === b && !removed.has(d.valueStart)
    );
    const hit = own[own.length - 1];
    if (hit) replace(hit, checkFragment(`${name} (${t})`, value));
    else insert(b, name, checkFragment(`${name} (${t})`, value));
  };

  // tokens the model no longer has
  const prevThemed = themedValues(sys, cfg.themes);
  for (const name of prevThemed.keys()) {
    if (m.tokens[name]) continue;
    for (const d of sys.byName.get(name) ?? []) if (d.themes.length) remove(d);
  }

  const newDurs: string[] = [];
  for (const [name, tok] of Object.entries(m.tokens).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const want = tok.values;
    if (!sys.byName.has(name) && name.startsWith('--dur-')) newDurs.push(name);
    const winners = new Map<Declaration, string[]>();
    const fresh: string[] = [];
    for (const t of cfg.themes) {
      const d = declFor(sys, name, t);
      if (d) winners.set(d, [...(winners.get(d) ?? []), t]);
      else if (want[t] !== undefined) fresh.push(t);
    }
    for (const [d, w] of winners) {
      const vals = w.map((t) => want[t]);
      if (vals.every((v) => v !== undefined && v === vals[0])) {
        if (vals[0] !== d.value) replace(d, checkFragment(`${name} (${w.join(', ')})`, vals[0]));
        continue;
      }
      // the themes this declaration serves no longer agree: move each to its own block
      remove(d);
      for (const t of w) if (want[t] !== undefined) upsert(name, t, want[t]);
    }
    if (!fresh.length) continue;
    const fv = fresh.map((t) => want[t]);
    const shared = fresh.length > 1 && fv.every((v) => v === fv[0]) ? exactBlock(fresh) : -1;
    if (shared >= 0) insert(shared, name, checkFragment(`${name} (${fresh.join(', ')})`, fv[0]));
    else for (const t of fresh) upsert(name, t, want[t]);
  }

  // a new duration collapses under reduced motion, like every other one (a11y invariant)
  if (newDurs.length) {
    let media = -1;
    rules.forEach((r, i) => {
      if (
        r.parent === -1 &&
        r.atRule === 'media' &&
        /prefers-reduced-motion\s*:\s*reduce/.test(r.selector)
      )
        media = i;
    });
    let child = -1;
    rules.forEach((r, i) => {
      if (media >= 0 && r.parent === media && !r.atRule) child = i;
    });
    if (child >= 0) {
      const has = new Set(ownDeclarations(prev, rules, child).map((d) => d.prop));
      for (const n of newDurs) if (!has.has(n)) insert(child, n, '1ms');
    }
  }

  for (const [rule, items] of inserts) {
    items.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    edits.push(...insertionEdits(prev, rules, rule, items, removed));
  }
  return edits.length ? applyEdits(prev, edits) : prev;
}

/** The output must read back as the model (G1) — otherwise nothing is produced. */
function verifyReadsBack(out: string, m: TokenModel, cfg: GenConfig): void {
  const got = themedValues(memSystem(out, cfg), cfg.themes);
  const names = new Set([...got.keys(), ...Object.keys(m.tokens)]);
  for (const name of names) {
    const want = m.tokens[name]?.values ?? {};
    const have = got.get(name) ?? {};
    for (const t of cfg.themes)
      if (want[t] !== have[t])
        throw blockError(
          `${name} (${t}) would read back as ${JSON.stringify(have[t] ?? null).slice(0, 80)} — this file's structure isn't recognized`
        );
  }
}

/** TokenModel → `colors_and_type.css`. Deterministic and pure; throws `DsGenerateError`. */
export function generateTokensCss(
  prev: string | null,
  model: TokenModel,
  cfg: Pick<GenConfig, 'rootClass' | 'themes' | 'defaultTheme'> & Partial<GenConfig>
): string {
  const full: GenConfig = {
    name: cfg.name ?? model.system,
    rootClass: cfg.rootClass,
    themes: cfg.themes,
    defaultTheme: cfg.defaultTheme,
    colorSpace: cfg.colorSpace ?? null,
  };
  checkConfig(full);
  const m = normalizeModel(model);
  for (const tok of Object.values(m.tokens))
    for (const t of Object.keys(tok.values))
      if (!full.themes.includes(t))
        throw blockError(
          `${tok.css}: could not locate a "${t.slice(0, 40)}" block — the system has no such theme`
        );
  const out = prev === null ? freshTokensCss(m, full) : patchTokensCss(prev, m, full);
  verifyReadsBack(out, m, full);
  return out;
}

// ───────────────────────────── components CSS ─────────────────────────────

const selectorKey = (sel: string) =>
  splitSelectorList(sel)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .join('\u0000');

/**
 * Component master edits as declaration patches (§5.5 "Components"): inside the LAST top-level
 * rule whose selector list matches exactly, the declaration's value is replaced span-only; a
 * missing declaration is appended before that rule's `}`; a missing rule is appended at the end.
 */
export function generateComponentsCss(prev: string, edits: ComponentEdit[]): string {
  let text = prev;
  for (const e of edits) {
    const selector = checkFragment('selector', e.selector, SELECTOR_MAX);
    if (typeof e.property !== 'string' || !PROPERTY_RE.test(e.property))
      throw valueError(`not a property name: ${String(e.property).slice(0, 80)}`);
    const value = checkFragment(`${selector} ${e.property}`, e.value);
    const key = selectorKey(selector);
    const rules = scanCssRules(text);
    let target = -1;
    rules.forEach((r, i) => {
      if (r.parent === -1 && !r.atRule && selectorKey(r.selector) === key) target = i;
    });
    if (target < 0) {
      const lead = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n';
      text = `${text}${lead}${selector} {\n  ${e.property}: ${value};\n}\n`;
      continue;
    }
    const custom = e.property.startsWith('--');
    const same = (p: string) =>
      custom ? p === e.property : p.toLowerCase() === e.property.toLowerCase();
    const own = ownDeclarations(text, rules, target).filter((d) => same(d.prop));
    const hit = own[own.length - 1];
    text = hit
      ? applyEdits(text, [{ start: hit.valueStart, end: hit.valueEnd, text: value }])
      : applyEdits(text, insertionEdits(text, rules, target, [[e.property, value]], new Set()));
  }
  return text;
}

// ───────────────────────────── tokens.json ─────────────────────────────

let defaultIdx: RegistryIndex | null = null;

/** The DTCG `{group.path}` of a classified name. */
const refPath = (c: { group: string; path: string[] }) => `{${[c.group, ...c.path].join('.')}}`;

/** TokenModel → `system/<ds>/tokens.json` (§5.3 bytes; `source: "canvas"`). Unknown keys kept. */
export function emitTokensJson(model: TokenModel, idx?: RegistryIndex): string {
  if (!idx && !defaultIdx) defaultIdx = indexRegistry(loadRegistry());
  const reg = (idx ?? defaultIdx) as RegistryIndex;
  const m = normalizeModel(model);
  const declared = new Set(Object.keys(m.tokens));
  const names = [...declared].sort();
  const classified = new Map(names.map((n) => [n, classifyName(reg, n, declared)]));
  const doc: JsonObj = {};
  for (const name of names) {
    const tok = m.tokens[name];
    const c = classified.get(name) as ReturnType<typeof classifyName>;
    const first = m.themes.find((t) => tok.values[t] !== undefined);
    const value =
      tok.values[m.defaultTheme] ?? (first ? tok.values[first] : Object.values(tok.values)[0]);
    const modes: JsonObj = {};
    for (const t of m.themes)
      if (t !== m.defaultTheme && tok.values[t] !== undefined && tok.values[t] !== value)
        modes[t] = tok.values[t];
    const ext: JsonObj = { css: name };
    if (c.tier) ext.tier = c.tier;
    if (c.kind) ext.kind = c.kind;
    if (c.index !== undefined) ext.index = c.index;
    if (c.own) ext.own = true;
    if (c.alias) ext.alias = true;
    if (Object.keys(modes).length) ext.modes = modes;
    for (const [k, v] of Object.entries(tok.data)) if (!DERIVED_LEAF.has(k)) put(ext, k, v);
    const leaf: JsonObj = {};
    for (const [k, v] of Object.entries(tok.extra))
      if (k !== '$value' && k !== '$type' && k !== '$extensions') put(leaf, k, v);
    const otherExt: JsonObj = {};
    if (isObj(tok.extra.$extensions))
      for (const [k, v] of Object.entries(tok.extra.$extensions))
        if (k !== 'sh.maude') put(otherExt, k, v);
    leaf.$extensions = { ...otherExt, 'sh.maude': ext };
    if (c.type) leaf.$type = c.type;
    const ref = exactVarRef(value ?? '');
    const target = ref && !ref.fallback ? classified.get(ref.name) : undefined;
    leaf.$value = target ? refPath(target) : (value ?? null);
    // Place the leaf; a token whose path is also a group goes under `$root` (as emit.ts does).
    let node = doc;
    const path = [c.group, ...c.path];
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      let next = node[k] as JsonObj | undefined;
      if (!next) {
        next = {};
        put(node, k, next);
      } else if ('$value' in next) {
        next = { $root: next };
        put(node, k, next);
      }
      node = next;
    }
    const last = path[path.length - 1];
    const slot = node[last] as JsonObj | undefined;
    if (slot && !('$value' in slot)) slot.$root = leaf;
    else put(node, last, leaf);
  }
  const rootExt: JsonObj = {};
  for (const [k, v] of Object.entries(m.meta)) if (!DERIVED_ROOT.has(k)) put(rootExt, k, v);
  Object.assign(rootExt, {
    schemaVersion: 1,
    system: m.system,
    themes: m.themes,
    defaultTheme: m.defaultTheme,
    source: 'canvas',
  });
  if (m.rootClass) rootExt.rootClass = m.rootClass;
  if (m.colorSpace) rootExt.colorSpace = m.colorSpace;
  const top: JsonObj = {};
  for (const [k, v] of Object.entries(m.extra))
    if (k.startsWith('$') && k !== '$schema' && k !== '$extensions') put(top, k, v);
  const rootOther: JsonObj = {};
  if (isObj(m.extra.$extensions))
    for (const [k, v] of Object.entries(m.extra.$extensions))
      if (k !== 'sh.maude') put(rootOther, k, v);
  return stableJson({
    ...top,
    $schema: TOKENS_SCHEMA_URL,
    $extensions: { ...rootOther, 'sh.maude': rootExt },
    ...doc,
  });
}
