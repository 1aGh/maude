// _import-tokens.mjs — token-file import: W3C design-tokens / Style-Dictionary
// JSON / raw CSS custom-properties → Maude's DS CSS-variable contract.
// Reached via `maude design import-tokens` (DDR-062), never a raw bin path.
//
// See DDR-172 for the full mapping contract + security posture. Every
// numbered "Decision N" comment below points at the exact DDR clause it
// implements. CLI-only (no HTTP route, no in-app panel — DDR-172 Instruments).

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { oklchToHex, parseColor, parseOklch, rgbToOklch } from '../draw/palette.ts';
import { extractDeclarations, scanCssRules } from '../ds/css-scan.ts';
import { loadRegistry } from '../ds/registry.ts';
import { DESIGN_PLUGIN_DIR } from '../paths.ts';
import { resolveAliases } from './_import-tokens-alias-resolver.mjs';

export class ImportTokensError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Exit codes: 0 ok · 2 usage · 3 validation/mapping reject · 4 read/parse
// error · 5 unsupported format · 6 write/containment error · 1 other.

// ============================================================================
// Decision 1 — input read (mirrors DDR-167 Decision 2 step 1: realpath-then-
// open, symlink-component rejection, single capped read) + format-appropriate
// parsers (native JSON.parse; a bespoke tokenizer for raw CSS — NOT
// lightningcss, see the DDR's Round-1 revision, and NOT a regex).
// ============================================================================

export const TOKENS_MAX_BYTES = 2 * 1024 * 1024;

/** Decision 1 — realpath-then-open, symlink-component rejection, single capped read. */
export function readTokenFileCapped(inputPath, maxBytes = TOKENS_MAX_BYTES) {
  // Reject when the LEAF (the file itself, pre-resolution) is a symlink —
  // the classic check-then-read substitution window: the file getting
  // swapped out from under this read between validation and open. Checked
  // against the ORIGINAL path (never the realpath-resolved one, which by
  // definition can no longer show as a symlink). Deliberately NOT walking
  // every ANCESTOR directory component: on macOS, `/tmp`/`/var` are
  // themselves OS-level symlinks (`-> /private/tmp`/`-> /private/var`), so a
  // whole-chain check rejects essentially every legitimate local path and
  // isn't the threat this closes anyway — an attacker who can plant a
  // symlink in a PARENT directory the operator already trusts and navigated
  // into has an easier path to the same data than racing this read (the
  // same residual DDR-167 Decision 2 step 1 already accepts explicitly).
  const absOriginal = resolve(inputPath);
  let leafStat;
  try {
    leafStat = lstatSync(absOriginal);
  } catch (err) {
    throw new ImportTokensError(4, `could not resolve path: ${err?.message ?? err}`);
  }
  if (leafStat.isSymbolicLink()) {
    throw new ImportTokensError(3, `refusing a path whose target is a symlink: ${absOriginal}`);
  }
  let real;
  try {
    real = realpathSync(inputPath);
  } catch (err) {
    throw new ImportTokensError(4, `could not resolve path: ${err?.message ?? err}`);
  }
  let buf;
  try {
    buf = readFileSync(real);
  } catch (err) {
    throw new ImportTokensError(4, `could not read file: ${err?.message ?? err}`);
  }
  if (buf.length === 0) throw new ImportTokensError(4, 'file is empty');
  if (buf.length > maxBytes) {
    throw new ImportTokensError(
      4,
      `token file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB cap`
    );
  }
  let text;
  try {
    text = buf.toString('utf8');
  } catch (err) {
    throw new ImportTokensError(4, `could not decode as UTF-8: ${err?.message ?? err}`);
  }
  return text;
}

// ---- Bespoke CSS structural scanner (comment/string-aware, no regex-over-
// adversarial-text) — shared by Decision 1's raw-CSS input tokenizer AND
// Decision 7's theme-block locator on the trusted OUTPUT file. ----
// The scanner itself lives in ../ds/css-scan.ts (V2-1.13 §5.1 — shared with the DS checker).

/**
 * Decision 1 — raw-CSS-custom-properties input tokenizer. Extracts every
 * `--name: value;` declaration from every rule body in the file (regardless
 * of nesting — the INPUT side has no reason to exclude @media-nested
 * declarations; that exclusion is specific to Decision 7's locator on
 * Maude's own OUTPUT file, to avoid matching a duplicate selector there).
 */
export function tokenizeCssCustomProperties(text) {
  const tokens = Object.create(null);
  for (const rule of scanCssRules(text)) {
    for (const decl of extractDeclarations(
      text.slice(rule.bodyStart, rule.bodyEnd),
      rule.bodyStart
    )) {
      tokens[decl.name] = decl.rawValue;
    }
  }
  return { tokens, types: Object.create(null) };
}

/**
 * Decision 1 — parse the input as JSON (W3C design-tokens / Style-Dictionary)
 * or, on JSON failure, as raw CSS custom properties. A failure on BOTH is a
 * hard reject. Error messages report structural position only, never a
 * verbatim excerpt of the input content.
 */
export function parseTokenFile(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      const pos = /position (\d+)/.exec(String(err?.message ?? ''))?.[1];
      throw new ImportTokensError(
        4,
        `could not parse as JSON (design-tokens/Style-Dictionary)${pos ? ` — malformed at byte offset ${pos}` : ''}`
      );
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new ImportTokensError(4, 'could not parse as JSON — expected a top-level object');
    }
    return { format: 'json', root: obj };
  }
  // Raw CSS: parse-failure here just means "no declarations found" (the
  // tokenizer never throws on malformed input — it best-effort extracts what
  // it can scan safely) — an empty result is itself the "could not parse"
  // signal the caller checks for.
  const { tokens } = tokenizeCssCustomProperties(text);
  if (Object.keys(tokens).length === 0) {
    throw new ImportTokensError(
      4,
      'could not parse as JSON or as CSS custom properties — no recognized token declarations found'
    );
  }
  return { format: 'css', tokens };
}

// ============================================================================
// Decision 3 — prototype-pollution-safe, structurally depth-capped flatten of
// the parsed JSON into {path -> rawValue} + {path -> detectedType}.
// ============================================================================

const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STRUCTURE_MAX_DEPTH = 32;

function isLeafToken(node) {
  return (
    node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    ('$value' in node || 'value' in node)
  );
}

/** Decision 3 — flatten W3C/Style-Dictionary JSON into path->rawValue string maps. */
export function flattenJsonTokens(root, { maxDepth = STRUCTURE_MAX_DEPTH } = {}) {
  const tokens = Object.create(null);
  const types = Object.create(null);

  function walk(node, pathParts, depth, inheritedType) {
    if (depth > maxDepth) {
      throw new ImportTokensError(3, 'structure-too-deep (nesting exceeds the 32-level cap)');
    }
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        walk(node[i], [...pathParts, String(i)], depth + 1, inheritedType);
      }
      return;
    }
    if (isLeafToken(node)) {
      const raw = '$value' in node ? node.$value : node.value;
      const type =
        typeof node.$type === 'string'
          ? node.$type
          : typeof node.type === 'string'
            ? node.type
            : inheritedType;
      if (typeof raw === 'string') {
        const path = pathParts.join('.');
        tokens[path] = raw;
        if (type) types[path] = type;
      }
      // Non-string leaf $value (composite shadow/typography/border objects)
      // is intentionally left unflattened — Decision 5: unmapped, not guessed.
      return;
    }
    const groupType = typeof node.$type === 'string' ? node.$type : inheritedType;
    for (const key of Object.keys(node)) {
      if (BANNED_KEYS.has(key)) continue;
      if (key.startsWith('$')) continue; // $description/$extensions/etc — metadata, never consumed (Decision 8)
      walk(node[key], [...pathParts, key], depth + 1, groupType);
    }
  }

  walk(root, [], 0, undefined);
  return { tokens, types };
}

// ============================================================================
// Decision 4 — value-grammar allowlist (the CSS-injection closure).
// Every grammar: printable-ASCII-only, no unbounded free-text capture, a
// literal space (never `\s`), a magnitude bound paired with every numeric
// grammar. See DDR-172 Decision 4 for the full Round-1/Round-2 history.
// ============================================================================

const ASCII_ONLY_RE = /^[\x20-\x7E]*$/;

const HEX_RES = [
  /^#[0-9a-fA-F]{3}$/,
  /^#[0-9a-fA-F]{4}$/,
  /^#[0-9a-fA-F]{6}$/,
  /^#[0-9a-fA-F]{8}$/,
];
const OKLCH_RE = /^oklch\([\d.]+%? [\d.]+ [\d.]+( ?\/ ?[\d.]+%?)?\)$/;
const RGB_RE = /^rgba?\( ?[\d.]+[ ,]+[\d.]+[ ,]+[\d.]+( ?[,/] ?[\d.]+%?)? ?\)$/;
const HSL_RE = /^hsla?\( ?[\d.]+ [\d.]+% [\d.]+%( ?\/ ?[\d.]+%?)?\)$/;

/** DDR-172 Decision 4's color-function grammar. Exported for reuse by DDR-173 Decision 1/6 (T12's brand extraction). */
export function isValidColorValue(v) {
  return HEX_RES.some((re) => re.test(v)) || OKLCH_RE.test(v) || RGB_RE.test(v) || HSL_RE.test(v);
}

const DIMENSION_RE = /^-?[\d.]{1,6}(px|rem|em|%)$/;
const DIMENSION_BOUNDS = { space: 4096, radius: 512, type: 512, lh: 512 };
function isValidDimension(v, family) {
  if (v === '0') return true;
  if (!DIMENSION_RE.test(v)) return false;
  const n = Math.abs(Number.parseFloat(v));
  const max = DIMENSION_BOUNDS[family] ?? 512;
  return Number.isFinite(n) && n <= max;
}

const DURATION_RE = /^[\d.]{1,6}m?s$/;
function isValidDuration(v) {
  if (!DURATION_RE.test(v)) return false;
  const m = /^([\d.]{1,6})(m?s)$/.exec(v);
  const n = Number.parseFloat(m[1]);
  const ms = m[2] === 'ms' ? n : n * 1000;
  return Number.isFinite(ms) && ms >= 0 && ms <= 60000;
}

const EASING_KEYWORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const CUBIC_BEZIER_RE = /^cubic-bezier\( ?-?[\d.]+ ?, ?-?[\d.]+ ?, ?-?[\d.]+ ?, ?-?[\d.]+ ?\)$/;
function isValidEasing(v) {
  return EASING_KEYWORDS.has(v) || CUBIC_BEZIER_RE.test(v);
}

const FONT_GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'cursive',
  'fantasy',
]);
const FONT_QUOTED_RE = /^"[A-Za-z0-9 _-]{1,64}"$/;
function isValidFontStack(v) {
  const parts = v.split(',').map((s) => s.trim());
  return parts.length > 0 && parts.every((p) => FONT_GENERIC.has(p) || FONT_QUOTED_RE.test(p));
}

const SHADOW_RGBA = 'rgba?\\( ?[\\d.]+[ ,]+[\\d.]+[ ,]+[\\d.]+( ?[,/] ?[\\d.]+%?)? ?\\)';
// Each length is either a bare `0` (valid CSS shorthand — no unit needed) or
// a strict `px` number — matches the real maude DS's own shadow shape
// (`0 1px 2px rgba(...)`), never a free-text/unitless-non-zero capture.
const SHADOW_LENGTH = '(?:0|-?[\\d.]{1,5}px)';
const SHADOW_LAYER = `( ?${SHADOW_LENGTH} ){2,4}${SHADOW_RGBA}`;
const SHADOW_RE = new RegExp(`^${SHADOW_LAYER}( ?, ?${SHADOW_LAYER})*$`);
function isValidShadow(v) {
  return SHADOW_RE.test(v);
}

function familyOfVariable(varName) {
  return varName.replace(/^--/, '').split('-')[0];
}

/** Decision 4 — validate `value` against the grammar for `varName`'s family. */
export function validateTokenValue(varName, value) {
  if (typeof value !== 'string' || !ASCII_ONLY_RE.test(value)) {
    return { ok: false, reason: 'invalid-value-shape (non-ASCII or non-string)' };
  }
  const family = familyOfVariable(varName);
  if (['bg', 'fg', 'border', 'accent', 'status'].includes(family)) {
    return isValidColorValue(value)
      ? { ok: true }
      : { ok: false, reason: 'invalid-value-shape (color)' };
  }
  if (['space', 'radius', 'type', 'lh'].includes(family)) {
    return isValidDimension(value, family)
      ? { ok: true }
      : { ok: false, reason: 'invalid-value-shape (dimension/magnitude)' };
  }
  if (family === 'dur') {
    return isValidDuration(value)
      ? { ok: true }
      : { ok: false, reason: 'invalid-value-shape (duration)' };
  }
  if (family === 'ease') {
    return isValidEasing(value)
      ? { ok: true }
      : { ok: false, reason: 'invalid-value-shape (easing)' };
  }
  if (family === 'font') {
    return isValidFontStack(value)
      ? { ok: true }
      : { ok: false, reason: 'invalid-value-shape (font stack)' };
  }
  if (family === 'shadow') {
    return isValidShadow(value)
      ? { ok: true }
      : { ok: false, reason: 'invalid-value-shape (shadow)' };
  }
  return { ok: false, reason: `ungoverned family: ${family}` };
}

// ============================================================================
// Decision 5 — heuristic name-to-variable mapping, never silent.
// ============================================================================

export const KNOWN_VARIABLES = new Set([
  '--bg-0',
  '--bg-1',
  '--bg-2',
  '--bg-3',
  '--bg-4',
  '--fg-0',
  '--fg-1',
  '--fg-2',
  '--fg-3',
  '--border-subtle',
  '--border-default',
  '--border-strong',
  '--accent',
  '--accent-hover',
  '--accent-active',
  '--accent-fg',
  '--accent-muted',
  '--accent-tint',
  '--status-success',
  '--status-warn',
  '--status-error',
  '--status-info',
  '--space-0',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-7',
  '--space-8',
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-pill',
  '--type-xs',
  '--type-sm',
  '--type-base',
  '--type-md',
  '--type-lg',
  '--type-xl',
  '--type-2xl',
  '--type-3xl',
  '--lh-xs',
  '--lh-sm',
  '--lh-base',
  '--lh-md',
  '--lh-lg',
  '--lh-xl',
  '--lh-2xl',
  '--lh-3xl',
  '--font-display',
  '--font-body',
  '--font-mono',
  '--dur-flip',
  '--dur-panel',
  '--dur-route',
  '--dur-soft',
  '--ease-out',
  '--ease-in-out',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
]);

function normalizeTokenPath(path) {
  return path
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[/_.-]+/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function has(words, ...any) {
  return any.some((w) => words.includes(w));
}

/** Decision 5 — map a flattened token path to a KNOWN_VARIABLES member, or null (unmapped, never guessed). */
export function mapTokenNameToVariable(path, detectedType) {
  const words = normalizeTokenPath(path);
  const isColor = detectedType === 'color' || detectedType == null;
  const isStatusWord = has(words, 'success', 'warn', 'warning', 'error', 'danger', 'info');

  if (isColor && has(words, 'bg', 'background', 'surface') && !isStatusWord) {
    if (has(words, '4', 'pressed')) return '--bg-4';
    if (has(words, '3', 'input')) return '--bg-3';
    if (has(words, '2', 'nested', 'popover', 'inspector')) return '--bg-2';
    if (has(words, '1', 'card', 'panel')) return '--bg-1';
    return '--bg-0';
  }
  if (isColor && has(words, 'fg', 'text', 'foreground') && !has(words, 'accent')) {
    if (has(words, '3', 'disabled')) return '--fg-3';
    if (has(words, '2', 'tertiary', 'muted')) return '--fg-2';
    if (has(words, '1', 'secondary')) return '--fg-1';
    return '--fg-0';
  }
  if (isColor && has(words, 'border') && !has(words, 'radius', 'width', 'corner', 'rounding')) {
    if (has(words, 'strong')) return '--border-strong';
    if (has(words, 'subtle')) return '--border-subtle';
    return '--border-default';
  }
  if (isColor && has(words, 'success')) return '--status-success';
  if (isColor && has(words, 'warn', 'warning')) return '--status-warn';
  if (isColor && has(words, 'error', 'danger')) return '--status-error';
  if (isColor && has(words, 'info')) return '--status-info';
  if (isColor && has(words, 'accent', 'brand', 'primary')) {
    if (has(words, 'hover')) return '--accent-hover';
    if (has(words, 'active', 'pressed')) return '--accent-active';
    if (has(words, 'fg', 'foreground', 'on')) return '--accent-fg';
    if (has(words, 'muted')) return '--accent-muted';
    if (has(words, 'tint')) return '--accent-tint';
    return '--accent';
  }
  if (has(words, 'space', 'spacing', 'gap')) {
    const idx = words.find((w) => /^\d+$/.test(w));
    if (idx == null) return null;
    return `--space-${Math.max(0, Math.min(8, Number(idx)))}`;
  }
  if (has(words, 'radius', 'corner', 'rounding')) {
    if (has(words, 'xs')) return '--radius-xs';
    if (has(words, 'sm', 'small')) return '--radius-sm';
    if (has(words, 'lg', 'large')) return '--radius-lg';
    if (has(words, 'xl')) return '--radius-xl';
    if (has(words, 'pill', 'full', 'round')) return '--radius-pill';
    return '--radius-md';
  }
  if (has(words, 'lineheight', 'leading') || (has(words, 'line') && has(words, 'height'))) {
    for (const s of ['xs', 'sm', 'base', 'md', 'lg', 'xl']) if (has(words, s)) return `--lh-${s}`;
    if (has(words, '2xl')) return '--lh-2xl';
    if (has(words, '3xl')) return '--lh-3xl';
    return null;
  }
  if (has(words, 'fontsize') || (has(words, 'font') && has(words, 'size'))) {
    for (const s of ['xs', 'sm', 'base', 'md', 'lg', 'xl']) if (has(words, s)) return `--type-${s}`;
    if (has(words, '2xl')) return '--type-2xl';
    if (has(words, '3xl')) return '--type-3xl';
    return null;
  }
  if (has(words, 'font', 'typeface', 'fontfamily') || detectedType === 'fontFamily') {
    if (has(words, 'display', 'heading', 'headline')) return '--font-display';
    if (has(words, 'mono', 'code', 'monospace')) return '--font-mono';
    return '--font-body';
  }
  if (has(words, 'duration', 'motion') || detectedType === 'duration') {
    if (has(words, 'flip')) return '--dur-flip';
    if (has(words, 'panel')) return '--dur-panel';
    if (has(words, 'route', 'page')) return '--dur-route';
    return '--dur-soft';
  }
  if (has(words, 'easing', 'ease', 'curve') || detectedType === 'cubicBezier') {
    return has(words, 'inout') || (has(words, 'in') && has(words, 'out'))
      ? '--ease-in-out'
      : '--ease-out';
  }
  if (has(words, 'shadow', 'elevation')) {
    if (has(words, 'sm', 'small')) return '--shadow-sm';
    if (has(words, 'lg', 'large')) return '--shadow-lg';
    return '--shadow-md';
  }
  return null;
}

// ============================================================================
// Decision 6 — colorspace normalization: convert when confident, report when not.
// ============================================================================

function detectColorFormat(v) {
  if (typeof v !== 'string') return null;
  if (HEX_RES.some((re) => re.test(v))) return 'hex';
  if (RGB_RE.test(v)) return 'rgb';
  if (OKLCH_RE.test(v)) return 'oklch';
  if (HSL_RE.test(v)) return 'hsl';
  return null;
}

/** Decision 6 — normalize a color value into `targetColorSpace`. Returns `{ value }` or `{ skip: reason }`. */
export function normalizeColorspace(value, targetColorSpace) {
  const inputFormat = detectColorFormat(value);
  if (inputFormat === null) return { skip: 'unparseable-color-value' };
  if (targetColorSpace === 'hex') {
    if (inputFormat === 'hex') return { value };
    if (inputFormat === 'rgb') {
      const rgb = parseColor(value);
      return {
        value: `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`,
      };
    }
    if (inputFormat === 'oklch') return { value: oklchToHex(parseOklch(value)) };
    return { skip: `unsupported-colorspace-conversion (${inputFormat}->hex)` };
  }
  if (targetColorSpace === 'oklch' || targetColorSpace == null) {
    if (inputFormat === 'oklch') return { value };
    if (inputFormat === 'hex' || inputFormat === 'rgb') {
      const rgb = parseColor(value);
      const o = rgbToOklch(rgb);
      return { value: `oklch(${o.l.toFixed(3)} ${o.c.toFixed(3)} ${o.h.toFixed(1)})` };
    }
    return { skip: `unsupported-colorspace-conversion (${inputFormat}->oklch)` };
  }
  // hsl/lab targets — no converter in this pass (Decision 6, named gap).
  if (inputFormat === targetColorSpace) return { value };
  return { skip: `unsupported-colorspace-conversion (${inputFormat}->${targetColorSpace})` };
}

// ============================================================================
// Decision 7 — write-path: theme-block-scoped patch, atomic, contained.
// ============================================================================

const SELECTOR_ROOT_RE = /(^|,)\s*:root\s*(,|$)/;

function selectorMatchesTheme(selector, rootClass, theme) {
  // Tolerant of whitespace/quote-style variants a hand-edited file might
  // legitimately carry — `[ data-theme = "dark" ]`, `[data-theme='dark']`.
  const escapedClass = rootClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedTheme = theme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `\\.${escapedClass}\\s*\\[\\s*data-theme\\s*=\\s*["']${escapedTheme}["']\\s*\\]`
  );
  return re.test(selector);
}

/**
 * Decision 7 — locate the target theme's top-level (non-`@media`-nested)
 * rule block. Returns `{ bodyStart, bodyEnd }` or `null` (caller MUST hard
 * reject on null — never fall back to `:root`, the first match, or a
 * whole-file scan).
 */
export function locateThemeBlock(cssText, { rootClass, theme, singleTheme }) {
  const rules = scanCssRules(cssText).filter((r) => !r.nestedInAtRule);
  const themed = rules.find((r) => selectorMatchesTheme(r.selector, rootClass, theme));
  if (themed) return { bodyStart: themed.bodyStart, bodyEnd: themed.bodyEnd };
  if (singleTheme) {
    const rootRule = rules.find((r) => SELECTOR_ROOT_RE.test(r.selector));
    if (rootRule) return { bodyStart: rootRule.bodyStart, bodyEnd: rootRule.bodyEnd };
  }
  return null;
}

/**
 * Decision 7 — patch (or, with `forceInsert`, append) ONE declaration inside
 * the given block span. Never touches text outside `[bodyStart, bodyEnd)`.
 */
export function patchDeclarationInBlock(
  cssText,
  block,
  varName,
  newValue,
  { forceInsert = false } = {}
) {
  const body = cssText.slice(block.bodyStart, block.bodyEnd);
  const decls = extractDeclarations(body, block.bodyStart);
  const existing = decls.find((d) => d.name === varName);
  if (existing) {
    // Replace ONLY the value span — name, colon spacing, and the trailing
    // `;` are left byte-for-byte untouched, exactly the "replaces ONLY that
    // declaration's value" contract (Decision 7). Returns an UPDATED block
    // span (bodyEnd shifted by the length delta) — callers patching multiple
    // variables in the same block in sequence must use the returned block,
    // not the original, or subsequent lookups mis-locate against stale
    // offsets once a value's length changes.
    const css = cssText.slice(0, existing.valueStart) + newValue + cssText.slice(existing.valueEnd);
    const delta = newValue.length - (existing.valueEnd - existing.valueStart);
    return {
      css,
      patched: true,
      block: { bodyStart: block.bodyStart, bodyEnd: block.bodyEnd + delta },
    };
  }
  if (!forceInsert) return { css: cssText, patched: false, block };
  // Force-insert anchor: immediately before the located block's OWN closing
  // `}` — never at file scope (Decision 7).
  const insertion = `  ${varName}: ${newValue};\n`;
  const css = `${cssText.slice(0, block.bodyEnd)}${insertion}${cssText.slice(block.bodyEnd)}`;
  return {
    css,
    patched: true,
    block: { bodyStart: block.bodyStart, bodyEnd: block.bodyEnd + insertion.length },
  };
}

function atomicWrite(filePath, content) {
  const dir = filePath.slice(0, filePath.lastIndexOf(sep));
  const tmp = join(
    dir,
    `.tmp-import-tokens-${createHash('sha256')
      .update(filePath + Date.now())
      .digest('hex')
      .slice(0, 12)}`
  );
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

function containSystemPath(root, designRootRel, tokensCssRel) {
  const systemDir = resolve(root, designRootRel, 'system');
  const target = resolve(root, designRootRel, tokensCssRel);
  if (target !== systemDir && !target.startsWith(systemDir + sep)) {
    throw new ImportTokensError(6, `tokensCssRel escapes system/: ${target}`);
  }
  return target;
}

function containConfigPath(root, designRootRel) {
  const expected = resolve(root, designRootRel, 'config.json');
  return expected;
}

// ============================================================================
// Decision 8 — new-DS metadata: sink eliminated, not bounded.
// ============================================================================

const DS_NAME_RE = /^[a-z0-9-]{1,64}$/;

export function assertValidDsName(name) {
  if (!ASCII_ONLY_RE.test(name) || !DS_NAME_RE.test(name)) {
    throw new ImportTokensError(3, `invalid-ds-name: must match ${DS_NAME_RE} — got "${name}"`);
  }
}

// ============================================================================
// Orchestration
// ============================================================================

function readConfig(root, designRootRel) {
  const path = containConfigPath(root, designRootRel);
  if (!existsSync(path)) throw new ImportTokensError(4, `config.json not found at ${path}`);
  try {
    return { path, config: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    throw new ImportTokensError(4, `could not parse config.json: ${err?.message ?? err}`);
  }
}

function scaffoldMinimalDs(root, designRootRel, dsName) {
  if (!DESIGN_PLUGIN_DIR) {
    throw new ImportTokensError(
      4,
      'scaffold template not found — this install layout does not bundle the design plugin templates; patch an existing DS instead, or run /design:setup-ds'
    );
  }
  const tplPath = join(
    DESIGN_PLUGIN_DIR,
    'templates/design-system-inspiration/core/colors_and_type.css.tpl'
  );
  if (!existsSync(tplPath)) {
    throw new ImportTokensError(4, `scaffold template not found at ${tplPath}`);
  }
  const tpl = readFileSync(tplPath, 'utf8');
  // DDR-043 neutral-skeleton posture — grayscale, system fonts, no shadow/
  // motion personality. Every placeholder gets a literal, inert default; the
  // import pass immediately after this overwrites whatever it successfully
  // mapped.
  const NEUTRAL = {
    project_label: dsName,
    root_class: dsName,
    theme_default: 'dark',
    bg_0: '#0d0d0f',
    bg_1: '#151517',
    bg_2: '#1b1b1e',
    bg_3: '#232326',
    bg_4: '#2b2b2f',
    border_subtle: '#232326',
    border_default: '#333338',
    border_strong: '#48484f',
    fg_0: '#f2f2f3',
    fg_1: '#c7c7cb',
    fg_2: '#9a9aa0',
    fg_3: '#6b6b70',
    accent_strategy_summary: 'single',
    accent_block:
      '  --accent: #6b6bf0;\n  --accent-hover: #8080f5;\n  --accent-active: #5555d0;\n  --accent-fg: #0d0d0f;\n  --accent-muted: #3d3d8a;\n  --accent-tint: color-mix(in oklab, var(--accent) 16%, transparent);',
    status_success: '#3fb950',
    status_warn: '#d29922',
    status_error: '#f85149',
    status_info: '#58a6ff',
    presence_online: '#3fb950',
    presence_away: '#d29922',
    presence_offline: '#6b6b70',
    shadow_sm: '0 1px 2px rgba(0,0,0,0.4)',
    shadow_md: '0 4px 14px rgba(0,0,0,0.46)',
    shadow_lg: '0 14px 38px rgba(0,0,0,0.56)',
    radius_xs: '3px',
    radius_sm: '5px',
    radius_md: '7px',
    radius_lg: '10px',
    radius_xl: '14px',
    radius_pill: '999px',
    space_0: '0',
    space_1: '2px',
    space_2: '4px',
    space_3: '8px',
    space_4: '12px',
    space_5: '16px',
    space_6: '24px',
    space_7: '32px',
    space_8: '48px',
    font_display: 'system-ui, sans-serif',
    font_body: 'system-ui, sans-serif',
    font_mono: 'ui-monospace, monospace',
    type_xs: '11px',
    lh_xs: '16px',
    type_sm: '12px',
    lh_sm: '18px',
    type_base: '14px',
    lh_base: '20px',
    type_md: '16px',
    lh_md: '24px',
    type_lg: '19px',
    lh_lg: '26px',
    type_xl: '23px',
    lh_xl: '30px',
    type_2xl: '28px',
    lh_2xl: '34px',
    type_3xl: '34px',
    lh_3xl: '40px',
    dur_flip: '140ms',
    dur_panel: '220ms',
    dur_route: '280ms',
    dur_soft: '120ms',
    ease_out_curve: 'cubic-bezier(0.2,0,0,1)',
    ease_in_out_curve: 'cubic-bezier(0.4,0,0.2,1)',
    layout_max_w: 'none',
    layout_gutter: 'var(--space-5)',
  };
  // Schema-v1 functional roles: the registry's own derivations from the tokens above (DDR-043).
  for (const r of loadRegistry().roles) {
    const k = r.name.slice(2).replace(/-/g, '_');
    if (r.origin === 'v1' && !(k in NEUTRAL)) NEUTRAL[k] = r.fallbackUnsupported ?? r.fallback;
  }
  const filled = tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in NEUTRAL ? NEUTRAL[key] : m));
  const dsDir = resolve(root, designRootRel, 'system', dsName);
  mkdirSync(dsDir, { recursive: true });
  const tokensCssRel = `system/${dsName}/colors_and_type.css`;
  atomicWrite(resolve(root, designRootRel, tokensCssRel), filled);
  return { tokensCssRel, rootClass: dsName, themeDefault: 'dark', themes: ['dark'] };
}

function upsertDesignSystemConfig(root, designRootRel, dsName, scaffold, tokenCount) {
  const { path, config } = readConfig(root, designRootRel);
  config.designSystems = Array.isArray(config.designSystems) ? config.designSystems : [];
  const description = `Imported via maude design import-tokens — ${tokenCount} tokens mapped on ${new Date().toISOString().slice(0, 10)}. Refine via /design:setup-ds.`;
  const entry = {
    name: dsName,
    path: `system/${dsName}`,
    description,
    tokensCssRel: scaffold.tokensCssRel,
    rootClass: scaffold.rootClass,
    themeDefault: scaffold.themeDefault,
    themes: scaffold.themes,
    newCanvasDir: 'ui',
    newComponentDir: `system/${dsName}/preview`,
  };
  const idx = config.designSystems.findIndex((d) => d?.name === dsName);
  if (idx >= 0) config.designSystems[idx] = entry;
  else config.designSystems.push(entry);
  if (!config.defaultDesignSystem) config.defaultDesignSystem = dsName;
  atomicWrite(path, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Full import: parse → flatten → resolve aliases → map → validate → normalize
 * colorspace → theme-block-scoped patch → mapping report.
 */
export async function importTokens({
  inputPath,
  root,
  designRootRel = '.design',
  dsName = null,
  newDs = null,
  theme = null,
  forceInsert = false,
}) {
  if (newDs) assertValidDsName(newDs);

  const text = readTokenFileCapped(inputPath);
  const parsed = parseTokenFile(text);
  const { tokens: rawTokens, types } =
    parsed.format === 'json'
      ? flattenJsonTokens(parsed.root)
      : { tokens: parsed.tokens, types: Object.create(null) };

  const { resolved, statuses } = resolveAliases(rawTokens);

  let targetName = newDs || dsName;
  let scaffold = null;
  let targetColorSpace = 'oklch';
  if (newDs) {
    scaffold = scaffoldMinimalDs(root, designRootRel, newDs);
    targetColorSpace = 'hex'; // matches the neutral scaffold template's own literal values
  } else {
    const { config } = readConfig(root, designRootRel);
    targetName = dsName || config.defaultDesignSystem;
    const dsEntry = (config.designSystems || []).find((d) => d?.name === targetName);
    if (!dsEntry)
      throw new ImportTokensError(4, `design system "${targetName}" not found in config.json`);
    scaffold = {
      tokensCssRel: dsEntry.tokensCssRel,
      rootClass: dsEntry.rootClass,
      themeDefault: dsEntry.themeDefault,
      themes: dsEntry.themes || [dsEntry.themeDefault],
    };
    targetColorSpace = config.colorSpace || 'oklch';
  }

  const targetTheme = theme || scaffold.themeDefault;
  const singleTheme = (scaffold.themes || []).length <= 1;
  const cssPath = containSystemPath(root, designRootRel, scaffold.tokensCssRel);
  if (!existsSync(cssPath)) throw new ImportTokensError(4, `target CSS file not found: ${cssPath}`);
  let cssText = readFileSync(cssPath, 'utf8');

  let block = locateThemeBlock(cssText, {
    rootClass: scaffold.rootClass,
    theme: targetTheme,
    singleTheme,
  });
  if (!block) {
    throw new ImportTokensError(
      3,
      `could not locate the "${targetTheme}" theme block in ${cssPath} — this file's theme structure isn't recognized`
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    targetDs: targetName,
    targetTheme,
    tokens: [],
  };
  let mappedCount = 0;

  for (const path of Object.keys(rawTokens)) {
    const entry = { path, detectedType: types[path] || null };
    if (statuses[path]) {
      entry.status = 'unmapped';
      entry.reason = statuses[path];
      report.tokens.push(entry);
      continue;
    }
    const value = resolved[path];
    const varName = mapTokenNameToVariable(path, types[path] || null);
    if (!varName || !KNOWN_VARIABLES.has(varName)) {
      entry.status = 'unmapped';
      entry.reason = 'no-recognized-pattern';
      report.tokens.push(entry);
      continue;
    }
    entry.targetVariable = varName;

    let finalValue = value;
    const family = familyOfVariable(varName);
    if (['bg', 'fg', 'border', 'accent', 'status'].includes(family) && typeof value === 'string') {
      const norm = normalizeColorspace(value, targetColorSpace);
      if (norm.skip) {
        entry.status = 'skipped';
        entry.reason = norm.skip;
        report.tokens.push(entry);
        continue;
      }
      finalValue = norm.value;
    }

    const validation = validateTokenValue(varName, finalValue);
    if (!validation.ok) {
      entry.status = 'rejected';
      entry.reason = validation.reason;
      report.tokens.push(entry);
      continue;
    }

    const patchResult = patchDeclarationInBlock(cssText, block, varName, finalValue, {
      forceInsert,
    });
    if (!patchResult.patched) {
      entry.status = 'skipped';
      entry.reason = 'family not present in target file (pass --force-insert to add it)';
      report.tokens.push(entry);
      continue;
    }
    cssText = patchResult.css;
    block = patchResult.block; // stale-offset fix: later patches in this same block must use the shifted span
    entry.status = 'mapped';
    entry.value = finalValue;
    mappedCount += 1;
    report.tokens.push(entry);
  }

  // Twin-declaration policy — report the untouched theme(s) for every mapped
  // variable, so the user knows those weren't silently synced (Decision 7).
  // Snapshot BEFORE looping — report.tokens is pushed into below, and a
  // live for-of over a growing array would re-visit newly pushed entries.
  const mappedEntries = report.tokens.filter((e) => e.status === 'mapped');
  for (const t of scaffold.themes || []) {
    if (t === targetTheme) continue;
    for (const entry of mappedEntries) {
      report.tokens.push({
        path: entry.path,
        targetVariable: entry.targetVariable,
        status: 'skipped',
        reason: `themed-token-not-patched (theme=${t}, value unchanged)`,
      });
    }
  }

  if (mappedCount > 0) {
    const backupDir = resolve(root, designRootRel, '_history', '_system');
    mkdirSync(backupDir, { recursive: true });
    const ts = Date.now();
    atomicWrite(join(backupDir, `import-tokens-backup-${ts}.css`), readFileSync(cssPath, 'utf8'));
    atomicWrite(cssPath, cssText);
    atomicWrite(
      join(backupDir, `import-tokens-report-${ts}.json`),
      `${JSON.stringify(report, null, 2)}\n`
    );
  }

  if (newDs) upsertDesignSystemConfig(root, designRootRel, newDs, scaffold, mappedCount);

  return { ...report, mappedCount, cssPath };
}

// ============================================================================
// CLI entry
// ============================================================================

function parseArgv(argv) {
  const out = {
    file: null,
    root: null,
    designRoot: '.design',
    ds: null,
    newDs: null,
    theme: null,
    forceInsert: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--root':
        out.root = argv[++i];
        break;
      case '--design-root':
        out.designRoot = argv[++i];
        break;
      case '--ds':
        out.ds = argv[++i];
        break;
      case '--new-ds':
        out.newDs = argv[++i];
        break;
      case '--theme':
        out.theme = argv[++i];
        break;
      case '--force-insert':
        out.forceInsert = true;
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new ImportTokensError(2, `unknown flag ${a}`);
        if (out.file === null) out.file = a;
        else throw new ImportTokensError(2, `unexpected extra arg ${a}`);
    }
  }
  return out;
}

const HELP = `import-tokens — token-file import (reached via \`maude design import-tokens\`)

Usage:
  maude design import-tokens <token-file> --root <repo> [--design-root .design]
                             [--ds <name> | --new-ds <name>] [--theme <name>]
                             [--force-insert] [--json]

Parses a W3C design-tokens JSON, Style-Dictionary JSON, or raw CSS custom-
properties file, maps recognized tokens onto the DS CSS-variable contract,
and patches (or scaffolds, with --new-ds) the target design system. Emits a
mapping report accounting for every input token (mapped/unmapped/rejected/
skipped) — never silently drops one. See DDR-172 for the full contract.

Exit: 0 ok · 2 usage · 3 validation/mapping reject · 4 read/parse error ·
      5 unsupported format · 6 write/containment error · 1 other.`;

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`import-tokens: ${err.message}\n`);
    process.exit(err instanceof ImportTokensError ? err.code : 2);
  }
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!opts.file) {
    process.stderr.write('import-tokens: <token-file> required\n');
    process.exit(2);
  }
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const result = await importTokens({
      inputPath: opts.file,
      root,
      designRootRel: opts.designRoot,
      dsName: opts.ds,
      newDs: opts.newDs,
      theme: opts.theme,
      forceInsert: opts.forceInsert,
    });
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(
        `import-tokens: ${result.mappedCount} mapped, ${result.tokens.length - result.mappedCount} not mapped -> ${result.cssPath}\n`
      );
    }
  } catch (err) {
    process.stderr.write(`import-tokens: ${err.message}\n`);
    process.exit(err instanceof ImportTokensError ? err.code : 1);
  }
}

// import.meta.main is the reliable "am I the entry module?" flag under bun
// --compile — the argv/url compare below falsely matches inside a standalone
// binary (every bundled module's import.meta.url collapses to the binary's
// own path), which would hijack the process before Bun.serve ever runs (the
// v0.38.0 "Starting…" hang class of bug). Fall back to the argv compare only
// for the plain-`node` CLI path (Node <24 leaves import.meta.main undefined).
const runDirectly =
  import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (runDirectly) {
  main();
}
