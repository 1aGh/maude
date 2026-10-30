// S10.4b (V2-1.13 §5.7 "switch") — the shell emits a switched canvas's `meta.dsPairing` as
// canvas-scoped aliases. S10.14 (`ds/switch.ts`) writes the pairing only for the Tier-2 slot names
// the target system lacks (display by rank, palette by index-mod, the rest by nearest index); this
// turns `{ "--accent-2": "--accent" }` into `--accent-2: var(--accent);` so the canvas's own source,
// untouched by the switch, renders the target's paired token.
//
// Trust (DDR-054): the meta is versioned, peer-authored data. Only `--name → --name` pairs whose
// both halves are plain custom-property names survive; the output is one declaration block of
// `var()` references, never a value, a URL or script. It is inlined into the shell's fallback
// `<style>` (both canvas CSPs allow inline styles), so no route and no canvas-origin allowlist moves.
//
// When it applies — all three, else nothing:
//   1. the request names a canvas (`?canvas=`, designRoot- or repo-relative via `?designRel=`, the
//      shell's own normalisation) whose meta carries a `dsPairing` object;
//   2. the stylesheet the shell loads (`?tokens=`) is the canvas's own system's — its working tokens
//      or one of its revisions. A `?dsPreview` of another system is not the switch's target, so
//      the pairing (made for that target) does not apply;
//   3. per pair: the target does not declare the source name in the stylesheet it renders now (a
//      system that later grows `--accent-2` wins with its own value — the aliases sit at zero
//      specificity, but a declaration on `.ds` would still beat an inherited `:root` value).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type SystemConfig, systemConfigsFrom } from './system.ts';

const NAME_RE = /^--[A-Za-z0-9_-]{1,64}$/;
const CLASS_RE = /^-?[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const REV_TOKENS_RE = /^revisions\/[0-9a-f]{64}\.tokens\.css$/;
/** no switch pairs more slots than this; a larger map is not a switch's */
const MAX_PAIRS = 256;

/** The system whose stylesheet `tokensRel` is: its working tokens, or one of its revisions. */
export function systemForTokens(
  config: Record<string, unknown>,
  tokensRel: string | null | undefined
): SystemConfig | null {
  if (!tokensRel) return null;
  for (const s of systemConfigsFrom(config)) {
    if (s.tokensCssRel === tokensRel) return s;
    if (
      tokensRel.startsWith(`${s.path}/`) &&
      REV_TOKENS_RE.test(tokensRel.slice(s.path.length + 1))
    )
      return s;
  }
  return null;
}

/** designRoot-relative `.tsx` of the shell's `?canvas=`, or null (absent, outside, not a canvas). */
function canvasRelOf(designRoot: string, query: URLSearchParams): string | null {
  const raw = query.get('canvas');
  if (!raw) return null;
  const clean = raw.replace(/^\/+/, '');
  const designRel = (query.get('designRel') || '.design').replace(/^\/+|\/+$/g, '');
  const rel = clean.startsWith(`${designRel}/`) ? clean.slice(designRel.length + 1) : clean;
  const abs = path.resolve(designRoot, rel);
  if (!abs.startsWith(designRoot + path.sep) || !/\.tsx$/i.test(abs)) return null;
  return path.relative(designRoot, abs);
}

function readJsonObj(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Custom-property names a stylesheet declares (anywhere: any selector, layer or theme). */
export function declaredNames(css: string): Set<string> {
  const out = new Set<string>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/(?:^|[{;\s])(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  return out;
}

/** The pairs that survive validation, in a stable order. */
export function pairingEntries(
  pairing: unknown,
  declared: ReadonlySet<string>
): Array<[string, string]> {
  if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)) return [];
  const out: Array<[string, string]> = [];
  for (const [from, to] of Object.entries(pairing as Record<string, unknown>)) {
    if (out.length >= MAX_PAIRS) break;
    if (!NAME_RE.test(from) || typeof to !== 'string' || !NAME_RE.test(to) || from === to) continue;
    if (declared.has(from)) continue;
    out.push([from, to]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The alias block for the shell request, or '' when nothing applies. `metaText` overrides the disk
 * meta (a past version, `?sha=`, renders its own meta lane); with `?sha=` and no `metaText` there is
 * no pairing (today's meta never dresses a past look).
 */
export function pairingCssFor(
  designRoot: string,
  config: Record<string, unknown>,
  query: URLSearchParams | null | undefined,
  metaText?: string | null
): string {
  if (!query) return '';
  const tokensRel = query.get('tokens');
  const sys = systemForTokens(config, tokensRel);
  if (!sys || !tokensRel) return '';
  const rel = canvasRelOf(designRoot, query);
  if (!rel) return '';
  const meta = readJsonObj(
    typeof metaText === 'string'
      ? metaText
      : query.get('sha')
        ? null
        : readText(path.join(designRoot, rel.replace(/\.tsx$/i, '.meta.json')))
  );
  if (!meta || meta.designSystem !== sys.name) return '';
  const tokensAbs = path.resolve(designRoot, tokensRel);
  if (!tokensAbs.startsWith(designRoot + path.sep)) return '';
  const pairs = pairingEntries(meta.dsPairing, declaredNames(readText(tokensAbs) ?? ''));
  if (!pairs.length) return '';
  const scope = [
    ':root',
    '.ds',
    ...(sys.rootClass && CLASS_RE.test(sys.rootClass) ? [`.${sys.rootClass}`] : []),
    '[data-theme]',
  ];
  return [
    '/* dsPairing (V2-1.13 §5.7): slot names this system lacks, paired at the switch */',
    `:where(${scope.join(', ')}) {`,
    ...pairs.map(([from, to]) => `  ${from}: var(${to});`),
    '}',
    '',
  ].join('\n');
}
