// _import-brand.mjs — DDR-173: extract typed design cues (palette + font
// classification + a hardened logo asset) from an already-DDR-167-sanitized
// SVG, for `/design:setup-ds --from-brand` (T12). NEVER re-reads the original
// brand file or re-runs DDR-167's sanitize/canary pipeline — operates only on
// the sanitized output `maude design import-asset` already produced (DDR-173
// Decision 2: no parallel, ungated read path).
//
// Every numbered "Decision N" comment below points at the exact DDR-173
// clause it implements.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { classifyFontFamilyList } from './_brand-fonts.mjs';
import { withSandboxedRender } from './_import-asset.mjs';
import { isValidColorValue } from './_import-tokens.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ImportBrandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Exit codes: 0 ok · 2 usage · 3 validation/hardening reject · 4 read/parse
// error · 6 write/containment error · 1 other.

// Decision 1 — the font allowlist + classifier live in _brand-fonts.mjs (pure, S8.18); re-exported
// here so every existing importer is unchanged.
export { classifyFontFamilyList, FONT_ALLOWLIST } from './_brand-fonts.mjs';

// ============================================================================
// Decision 6 — exhaustive per-attribute-type grammar for the `--from-brand`
// logo. Any retained attribute whose value fails its class's grammar is
// dropped (attribute removed, element kept) — fail-closed default: any
// attribute with no assigned bucket below is dropped unconditionally.
// ============================================================================

const COLOR_ATTRS = new Set(['fill', 'stroke', 'stop-color']);
const COLOR_KEYWORDS = new Set(['none', 'currentColor']);

const NUMERIC_ATTRS = new Set([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stroke-width',
  'font-size',
  'offset',
]);
const NUMERIC_RE = /^-?[\d.]+(px|%)?$/;

const COORD_LIST_ATTRS = new Set(['viewBox']);
const COORD_LIST_RE = /^-?[\d.]+([ ,]+-?[\d.]+){3}$/;

const GEOMETRY_PATH_ATTRS = new Set(['d']);
const GEOMETRY_POINTS_ATTRS = new Set(['points']);
const PATH_COMMAND_LETTERS = new Set('MmLlHhVvCcSsQqTtAaZz'.split(''));

const TRANSFORM_ATTRS = new Set(['transform', 'gradientTransform', 'patternTransform']);
const TRANSFORM_FUNCTIONS = new Set([
  'matrix',
  'translate',
  'translateX',
  'translateY',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'skewX',
  'skewY',
]);

const ENUM_ATTRS = {
  'text-anchor': new Set(['start', 'middle', 'end']),
  gradientUnits: new Set(['userSpaceOnUse', 'objectBoundingBox']),
  patternUnits: new Set(['userSpaceOnUse', 'objectBoundingBox']),
  'font-weight': new Set([
    'normal',
    'bold',
    'bolder',
    'lighter',
    '100',
    '200',
    '300',
    '400',
    '500',
    '600',
    '700',
    '800',
    '900',
  ]),
  version: new Set(['1.0', '1.1', '2.0']),
};
const PRESERVE_ASPECT_RATIO_RE = /^(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?: (?:meet|slice))?$/;

const NAMESPACE_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  'xmlns:xlink': 'http://www.w3.org/1999/xlink',
};

const IDENTIFIER_ATTRS = new Set(['id']);
const IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,64}$/;

const FONT_FAMILY_ATTRS = new Set(['font-family']);

// Attributes DDR-167 already value-constrains structurally (FuncIRI
// #fragment-only / raster data: URIs) — left untouched here, not re-graded.
const ALREADY_CONSTRAINED_ATTRS = new Set([
  'href',
  'xlink:href',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
]);

/** Every maximal alphabetic run in `s` must be exactly one char and a member of `allowedSingleChars`. */
function hasOnlySingleCharAlphaRuns(s, allowedSingleChars) {
  const runs = s.match(/[A-Za-z]+/g) || [];
  return runs.every((run) => run.length === 1 && allowedSingleChars.has(run));
}

/** Every maximal alphabetic run in `s` must exact-match a member of `allowedNames` (case-sensitive). */
function hasOnlyKnownFunctionNames(s, allowedNames) {
  const runs = s.match(/[A-Za-z]+/g) || [];
  return runs.every((run) => allowedNames.has(run));
}

function isValidAttributeValue(name, value) {
  if (typeof value !== 'string' || !/^[\x20-\x7E]*$/.test(value)) return false;
  if (COLOR_ATTRS.has(name)) return COLOR_KEYWORDS.has(value) || isValidColorValue(value);
  if (NUMERIC_ATTRS.has(name)) return NUMERIC_RE.test(value);
  if (COORD_LIST_ATTRS.has(name)) return COORD_LIST_RE.test(value);
  if (GEOMETRY_PATH_ATTRS.has(name)) {
    return (
      /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/.test(value) &&
      hasOnlySingleCharAlphaRuns(value, PATH_COMMAND_LETTERS)
    );
  }
  if (GEOMETRY_POINTS_ATTRS.has(name)) {
    return /^[0-9eE.,+\-\s]*$/.test(value); // no alphabetic character admitted at all
  }
  if (TRANSFORM_ATTRS.has(name)) {
    return (
      /^[A-Za-z0-9eE.,+\-()\s]*$/.test(value) &&
      hasOnlyKnownFunctionNames(value, TRANSFORM_FUNCTIONS)
    );
  }
  if (name in ENUM_ATTRS) return ENUM_ATTRS[name].has(value);
  if (name === 'preserveAspectRatio') return PRESERVE_ASPECT_RATIO_RE.test(value);
  if (name in NAMESPACE_ATTRS) return value === NAMESPACE_ATTRS[name];
  if (IDENTIFIER_ATTRS.has(name)) return IDENTIFIER_RE.test(value);
  if (FONT_FAMILY_ATTRS.has(name)) return classifyFontFamilyList(value).length > 0;
  if (ALREADY_CONSTRAINED_ATTRS.has(name)) return true; // DDR-167 already grammar-gates these
  return false; // fail-closed default: no assigned bucket → drop
}

/** Recursively remove Comment nodes (no SVGO legal-comment `<!--! -->` carve-out). */
function stripComments(node) {
  const children = [...node.childNodes];
  for (const child of children) {
    if (child.nodeType === 8 /* COMMENT_NODE */) {
      child.remove();
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      stripComments(child);
    }
  }
}

const TEXT_ELEMENTS = new Set(['title', 'desc', 'text', 'tspan', 'textPath', 'metadata']);

/**
 * Decision 6 — the `--from-brand`-logo-specific hardening pass, run on top
 * of DDR-167's own sanitized output. Strips text-content elements + all
 * comments; validates every retained attribute against its class grammar,
 * dropping non-conforming values (attribute removed, element kept).
 * Returns `{ hardened, hadWordmarkText }` — `hadWordmarkText` is true when a
 * `<text>` element carrying non-whitespace content was stripped, signaling
 * the raster-fallback path should run.
 */
export function hardenBrandLogoSvg(sanitizedSvgText) {
  const window = new Window();
  const doc = new window.DOMParser().parseFromString(sanitizedSvgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root?.tagName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new ImportBrandError(3, 'input is not a valid sanitized SVG document');
  }

  let hadWordmarkText = false;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!el.isConnected) continue;
    if (TEXT_ELEMENTS.has(el.tagName)) {
      if (el.tagName === 'text' && (el.textContent || '').trim().length > 0) {
        hadWordmarkText = true;
      }
      el.remove();
    }
  }

  stripComments(root);

  for (const el of [...root.querySelectorAll('*'), root]) {
    if (!el.isConnected && el !== root) continue;
    for (const attr of [...el.attributes]) {
      const local = attr.localName;
      const fullName = attr.name;
      if (local === 'xmlns' || fullName === 'xmlns:xlink') {
        if (!isValidAttributeValue(fullName, attr.value)) el.removeAttribute(fullName);
        continue;
      }
      if (!isValidAttributeValue(local, attr.value)) el.removeAttribute(fullName);
    }
  }

  const hardened = root.outerHTML;
  return { hardened, hadWordmarkText };
}

// ============================================================================
// Decision 1 — palette + font extraction (from the HARDENED string only —
// every value here already passed Decision 6's grammar, so nothing further
// to validate; this step just collects + dedupes).
// ============================================================================

const PALETTE_MAX = 8;
const FONTS_MAX = 3;

/** Extract a deduped palette (real color values only, `none`/`currentColor` excluded) from a hardened SVG string. */
export function extractPalette(hardenedSvgText) {
  const window = new Window();
  const doc = new window.DOMParser().parseFromString(hardenedSvgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root) return [];
  const seen = new Set();
  const out = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attrName of ['fill', 'stroke', 'stop-color']) {
      const v = el.getAttribute?.(attrName);
      if (!v || COLOR_KEYWORDS.has(v) || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= PALETTE_MAX) return out;
    }
  }
  return out;
}

/** Extract deduped, classified font names from a hardened SVG string. */
export function extractFonts(hardenedSvgText) {
  const window = new Window();
  const doc = new window.DOMParser().parseFromString(hardenedSvgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root) return [];
  const seen = new Set();
  const out = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const v = el.getAttribute?.('font-family');
    if (!v) continue;
    for (const name of classifyFontFamilyList(v)) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= FONTS_MAX) return out;
    }
  }
  return out;
}

// ============================================================================
// Decision 6 — raster fallback for a logo whose wordmark was live `<text>`.
// Reuses DDR-167's existing sandboxed-render mechanism (no new dependency,
// no new browser automation surface). Renders the PRE-strip, already-
// DDR-167-sanitized SVG (never the original, never re-fetched).
// ============================================================================

async function rasterizeLogoWordmark(preStripSanitizedSvg, { timeoutMs = 15_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-import-brand-'));
  const svgPath = join(dir, 'logo.svg');
  const pngPath = join(dir, 'logo.png');
  try {
    writeFileSync(svgPath, preStripSanitizedSvg);
    await withSandboxedRender(
      async (session) => {
        session.open(`file://${svgPath}`);
        session.screenshot(pngPath);
      },
      { timeoutMs }
    );
    if (!existsSync(pngPath)) {
      throw new ImportBrandError(4, 'logo wordmark raster fallback produced no output');
    }
    return readFileSync(pngPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// Write-path (mirrors _import-asset.mjs's content-addressed containment)
// ============================================================================

function assetNameFor(bytes, ext) {
  const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${sha8}.${ext}`;
  if (!/^[a-z0-9]{8}\.(svg|png)$/.test(name)) {
    throw new ImportBrandError(6, `generated name failed the charset contract: ${name}`);
  }
  return name;
}

function writeLogoAsset(root, designRootRel, bytes, ext) {
  const name = assetNameFor(bytes, ext);
  const logosDir = resolve(root, designRootRel, 'assets', 'logos');
  const rootAbs = resolve(root);
  if (!logosDir.startsWith(rootAbs + sep)) {
    throw new ImportBrandError(6, `logos dir escapes root: ${logosDir}`);
  }
  mkdirSync(logosDir, { recursive: true });
  const fileAbs = resolve(logosDir, name);
  if (!fileAbs.startsWith(logosDir + sep)) {
    throw new ImportBrandError(6, `resolved logo path escapes logos dir: ${fileAbs}`);
  }
  if (!existsSync(fileAbs)) {
    const tmp = join(
      logosDir,
      `.tmp-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`
    );
    writeFileSync(tmp, bytes);
    renameSync(tmp, fileAbs);
  }
  return { ref: `assets/logos/${name}`, path: fileAbs, name };
}

// ============================================================================
// Orchestration
// ============================================================================

/**
 * Full brand-cue extraction: takes the path to an ALREADY-DDR-167-sanitized
 * SVG asset (as produced by `maude design import-asset`) — never a raw
 * brand-file path, never re-sanitizes, never re-runs the execution canary
 * (Decision 2). Hardens the logo, extracts typed cues, writes the DDR-141
 * asset(s). Returns the payload-ready `{ palette, fonts, logoRef }` plus a
 * `logoRasterRef` when a wordmark fallback was needed.
 */
export async function importBrand({ sanitizedSvgPath, root, designRootRel = '.design' }) {
  if (!existsSync(sanitizedSvgPath)) {
    throw new ImportBrandError(4, `sanitized SVG asset not found: ${sanitizedSvgPath}`);
  }
  const originalSanitized = readFileSync(sanitizedSvgPath, 'utf8');
  const { hardened, hadWordmarkText } = hardenBrandLogoSvg(originalSanitized);

  const palette = extractPalette(hardened);
  const fonts = extractFonts(hardened);

  const logoAsset = writeLogoAsset(root, designRootRel, Buffer.from(hardened, 'utf8'), 'svg');

  let logoRasterRef = null;
  if (hadWordmarkText) {
    const png = await rasterizeLogoWordmark(originalSanitized);
    const rasterAsset = writeLogoAsset(root, designRootRel, png, 'png');
    logoRasterRef = rasterAsset.ref;
  }

  return {
    palette,
    fonts,
    logoRef: logoAsset.ref,
    logoRasterRef,
    hadWordmarkText,
  };
}

// ============================================================================
// CLI entry
// ============================================================================

function parseArgv(argv) {
  const out = { file: null, url: null, root: null, designRoot: '.design', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--root':
        out.root = argv[++i];
        break;
      case '--design-root':
        out.designRoot = argv[++i];
        break;
      // S8.18 — a website, read through the fetch-asset gate (_brand-site.mjs)
      case '--url':
        out.url = argv[++i] ?? '';
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new ImportBrandError(2, `unknown flag ${a}`);
        if (out.file === null) out.file = a;
        else throw new ImportBrandError(2, `unexpected extra arg ${a}`);
    }
  }
  return out;
}

const HELP = `import-brand — brand-file typed-cue extraction (reached via \`maude design import-brand\`)

Usage:
  maude design import-brand <sanitized-svg-path> --root <repo> [--design-root .design] [--json]
  maude design import-brand [<sanitized-svg-path>] --url <website> --root <repo>

Extracts palette + font-family cues from a LOGO SVG that has ALREADY been
sanitized by \`maude design import-asset\` (DDR-167) — never re-reads or
re-sanitizes the original brand file. Hardens the logo (strips text/comments,
validates every retained attribute against an exhaustive per-type grammar —
DDR-173 Decision 6), writes it to <designRoot>/assets/logos/<sha8>.svg, and
rasterizes a PNG fallback when the logo's wordmark was live text. Prints the
typed payload \`{ palette, fonts, logoRef, logoRasterRef }\` for the caller to
seed into the ux-research-agent discovery payload — see DDR-173.

--url reads the website's colours and fonts (S8.18) through the fetch-asset gate: https
only, public addresses only, every redirect re-checked, 2 MB / 20 s caps. Only typed
values come back — \`#rrggbb\` colours and allowlisted font names, never page text.
The result adds \`site\` ({ ok, host, palette, fonts } or { ok: false, host, reason })
and \`colours\` (named, with roles: accent / text / background / second / none).
Exit 5 when only --url was given and the site could not be read.

Exit: 0 ok · 2 usage · 3 validation/hardening reject · 4 read/parse error ·
      6 write/containment error · 1 other.`;

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`import-brand: ${err.message}\n`);
    process.exit(err instanceof ImportBrandError ? err.code : 2);
  }
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!opts.file && opts.url === null) {
    process.stderr.write('import-brand: <sanitized-svg-path> or --url <website> required\n');
    process.exit(2);
  }
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (opts.url !== null) {
    await runWithUrl(opts, root);
    return;
  }
  try {
    const result = await importBrand({
      sanitizedSvgPath: opts.file,
      root,
      designRootRel: opts.designRoot,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (err) {
    process.stderr.write(`import-brand: ${err.message}\n`);
    process.exit(err instanceof ImportBrandError ? err.code : 1);
  }
}

// S8.18 — `--url` (with or without a logo): the same request body the studio's sheet posts.
async function runWithUrl(opts, root) {
  const { importBrandRequest } = await import('./_brand-site.mjs');
  const { relative } = await import('node:path');
  let assetPath;
  if (opts.file) {
    const designAbs = resolve(root, opts.designRoot);
    assetPath = relative(designAbs, resolve(opts.file)).split(sep).join('/');
  }
  const { status, body } = await importBrandRequest(
    { url: opts.url, ...(assetPath !== undefined ? { assetPath } : {}) },
    { repoRoot: root, designRel: opts.designRoot }
  );
  process.stdout.write(`${JSON.stringify(body)}\n`);
  if (status >= 400) process.exit(status === 422 ? 5 : status === 404 ? 4 : 3);
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
