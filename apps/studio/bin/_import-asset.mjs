#!/usr/bin/env bun
// _import-asset.mjs — hardened local-file / SVG / PDF ingestion (DDR-167).
// Reached via `maude design import-asset` (DDR-062), never a raw bin path.
//
// Pure functions here are shared by BOTH the CLI verb (import-asset.sh) and
// the privileged `/_api/import-asset` HTTP route (T10) — imported directly by
// the route handler, not shelled out to, mirroring `_fetch-asset.mjs`'s own
// module/CLI split. Runs under Bun (not the node/bun fallback `fetch-asset.sh`
// uses) because it imports the `.ts` SVGO engine module directly, same
// constraint as `_svg-optimize.mjs`.
//
// See DDR-167 for the full threat model. Every numbered "Decision N, step M"
// comment below points at the exact DDR clause it implements.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Window } from 'happy-dom';
import { recordAssetOrigin } from '../asset-origins.ts';
import { isValidSvg, optimizeSvg } from '../draw/optimize.ts';

export class ImportAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Exit codes (mirrors _fetch-asset.mjs's convention): 0 ok · 2 usage ·
// 3 validation/sanitize reject · 4 read/parse error · 5 unsupported media
// type · 6 write/containment error · 1 other.

// ============================================================================
// Decision 3 — write-path containment (shared by SVG + PDF-page output).
// Mirrors _fetch-asset.mjs's containedAssetPath/assetName exactly.
// ============================================================================

/** Content-addressed `<sha8>.<ext>` name. `ext` in {svg, png, jpg}. */
export function assetName(bytes, ext) {
  const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${sha8}.${ext}`;
  if (!/^[a-z0-9]{8}\.(svg|png|jpg)$/.test(name)) {
    throw new ImportAssetError(6, `generated name failed the charset contract: ${name}`);
  }
  return name;
}

/** Resolve `<root>/<designRootRel>/assets/<name>`, asserting realpath containment. */
export function containedAssetPath(root, designRootRel, name) {
  const rootAbs = resolve(root);
  const assetsDir = resolve(rootAbs, designRootRel, 'assets');
  if (assetsDir !== rootAbs && !assetsDir.startsWith(rootAbs + sep)) {
    throw new ImportAssetError(6, `assets dir escapes root: ${assetsDir}`);
  }
  const fileAbs = resolve(assetsDir, name);
  if (fileAbs !== join(assetsDir, name) || !fileAbs.startsWith(assetsDir + sep)) {
    throw new ImportAssetError(6, `resolved asset path escapes assets dir: ${fileAbs}`);
  }
  return { assetsDir, fileAbs };
}

/** Write `bytes` to the contained, content-addressed path. Dedupes identical content. */
export function writeContainedAsset(root, designRootRel, bytes, ext) {
  const name = assetName(bytes, ext);
  const { assetsDir, fileAbs } = containedAssetPath(root, designRootRel, name);
  mkdirSync(assetsDir, { recursive: true });
  if (!existsSync(fileAbs)) {
    const tmp = join(
      assetsDir,
      `.tmp-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`
    );
    writeFileSync(tmp, bytes);
    renameSync(tmp, fileAbs);
  }
  return { ref: `/assets/${name}`, path: `assets/${name}`, name, bytes: bytes.length, ext };
}

// ============================================================================
// Decision 1 — SVG: allowlist DOM-sanitize (happy-dom) → SVGO validity/minify
// → real-browser execution canary (canary lives in the "sandboxed render"
// section below, shared with Decision 2's PDF rasterizer).
// ============================================================================

export const SVG_MAX_BYTES = 5 * 1024 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Decision 1, step 3 — allowlisted elements. SMIL elements are TAGS ONLY; see
// SMIL_FUNCTIONAL_ATTRS below for why their functional attributes are
// permanently excluded, not just absent from this list.
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'symbol',
  'use',
  'image',
  'text',
  'tspan',
  'textPath',
  'title',
  'desc',
  'metadata',
  'marker',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feMerge',
  'feMergeNode',
  'feColorMatrix',
  'feComposite',
  'feFlood',
  'feBlend',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
]);

// Text-only containers — any ELEMENT child inside these is dropped (their
// content is inert copy, never markup).
const TEXT_ONLY_ELEMENTS = new Set(['metadata', 'title', 'desc']);

const SMIL_ELEMENTS = new Set(['animate', 'animateTransform', 'animateMotion', 'set']);
// PERMANENTLY excluded from SMIL elements (DDR-167 Decision 1, step 3,
// Round-2 finding) — attributeName/values retargeting a href to javascript:
// at render time is a real, actively-exploited bypass class (CVE-2025-66412,
// CVE-2025-68461, PortSwigger "SVG animate XSS vector"). Do NOT add these to
// an allowlist without a DDR amendment re-deriving the threat model.
const SMIL_FUNCTIONAL_ATTRS = new Set([
  'attributeName',
  'attributeType',
  'to',
  'from',
  'values',
  'by',
  'begin',
  'end',
  'dur',
  'repeatCount',
  'repeatDur',
  'keyTimes',
  'keySplines',
]);

// Decision 1, step 3 — plain presentation-attribute allowlist. clip-path,
// mask, filter, marker-start/mid/end are DELIBERATELY excluded here (they
// take FuncIRI url(...) values) — see FUNCIRI_ATTRS below.
const ALLOWED_PLAIN_ATTRS = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'd',
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'points',
  'transform',
  'viewBox',
  'preserveAspectRatio',
  'id',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternUnits',
  // Required by spec for pattern CONTENT, and we were stripping it. A
  // `<pattern>` whose children are authored in the 0..1 unit box — which is what
  // `<use transform="scale(0.00097 0.00075)">` (1/1028 × 1/1331) means — is read
  // in user space without it, so its content collapses to about a pixel.
  //
  // HONEST SCOPE: this is an allowlist bug, NOT the cause of Figma's raster
  // fills failing to appear. That was chased here first and the diagnosis was
  // wrong: Figma's OWN UNTOUCHED export, fetched straight from `/v1/images` and
  // loaded directly, does not paint its `<pattern>`/`<use>`/`<image
  // xlink:href="data:…">` chain either. Allowing this attribute fixes nothing
  // user-visible; it just stops us corrupting a pattern that would otherwise
  // have worked. Same enum-valued, no-URL, no-script risk class as
  // `patternUnits` directly above.
  'patternContentUnits',
  'patternTransform',
  // Presentational text metrics. Their absence is not fatal the way the pattern
  // one is, but it silently drifts imported type away from the source.
  'letter-spacing',
  'xml:space',
  'version',
]);

// href/xlink:href (matched by localName 'href') — allowed as #fragment or a
// raster data: URI only. Never data:image/svg+xml (closes nested-SVG reintro).
const HREF_ALLOWED_DATA_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/;

// clip-path/mask/filter/marker-* — FuncIRI-valued (url(...) syntax). Same
// #fragment-only constraint as href, applied after extracting the inner ref.
const FUNCIRI_ATTR_NAMES = new Set([
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
]);
const FUNCIRI_VALUE_RE = /^url\(\s*(['"]?)([^'")]*)\1\s*\)$/i;

function isSafeFragmentOrRasterData(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('#')) return true;
  return HREF_ALLOWED_DATA_RE.test(value);
}

function isSafeFuncIriValue(rawValue) {
  const m = FUNCIRI_VALUE_RE.exec(String(rawValue ?? '').trim());
  if (!m) return false;
  return m[2].startsWith('#');
}

/** Decision 1, step 1 — pre-parse hard rejects. Throws ImportAssetError, never returns false. */
export function svgPreParseReject(text) {
  if (typeof text !== 'string') throw new ImportAssetError(3, 'not a string');
  const byteLen = Buffer.byteLength(text, 'utf8');
  if (byteLen > SVG_MAX_BYTES) {
    throw new ImportAssetError(3, `SVG exceeds the ${SVG_MAX_BYTES / (1024 * 1024)} MB cap`);
  }
  // Canonical UTF-8 — reject a declared non-UTF-8/non-ASCII encoding so the
  // string checks below and the later DOM parse never disagree about bytes.
  const encMatch = /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(text);
  if (encMatch && !/^(utf-8|us-ascii|ascii)$/i.test(encMatch[1])) {
    throw new ImportAssetError(3, `unsupported declared encoding: ${encMatch[1]}`);
  }
  // XXE / entity-expansion hardening. The attack surface is an ENTITY
  // declaration or an internal DTD subset (`<!DOCTYPE svg [ … ]>`, where entities
  // are declared) — NOT a plain external-identifier DOCTYPE. Adobe Illustrator,
  // Affinity/Serif, and Inkscape all emit a benign `<!DOCTYPE svg PUBLIC "-//W3C//
  // DTD SVG 1.1//EN" "…svg11.dtd">` with no internal subset; rejecting that whole
  // class turned away real, clean brand logos (RCA G8). Reject the actual vector,
  // allow the benign declaration (the allowlist sanitizer drops the DOCTYPE from
  // the stored output regardless, and happy-dom treats the DOCTYPE as an inert
  // node — it never fetches an external DTD). See DDR-167 + DDR-177.
  if (/<!ENTITY/i.test(text)) {
    throw new ImportAssetError(3, 'ENTITY declarations are rejected (XXE/entity-expansion class)');
  }
  // Internal-subset detection, quote-aware. A naive `/<!DOCTYPE\b(.*?)>/` is
  // evadable: a `>` inside a quoted external-id literal (`SYSTEM "http://x/>y"
  // [ … ]`) truncates the capture before the `[` (ethical-hacker review). Scan
  // from `<!DOCTYPE` respecting quotes, and reject on a `[` (internal subset)
  // reached before the closing `>`.
  const dtStart = text.search(/<!DOCTYPE\b/i);
  if (dtStart >= 0) {
    let quote = null;
    for (let i = dtStart + 9; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '[') {
        throw new ImportAssetError(
          3,
          'DOCTYPE with an internal subset is rejected (XXE/entity-expansion class)'
        );
      } else if (c === '>') {
        break; // end of DOCTYPE, no internal subset seen
      }
    }
  }
  // Any processing instruction other than the single leading XML declaration.
  const piRe = /<\?([^?]*)\?>/g;
  let seenLeadingDecl = false;
  const trimmed = text.trimStart();
  for (const m of text.matchAll(piRe)) {
    const isLeadingXmlDecl =
      !seenLeadingDecl && trimmed.startsWith(m[0]) && /^xml\s/i.test(m[1].trim() + ' ');
    if (isLeadingXmlDecl) {
      seenLeadingDecl = true;
      continue;
    }
    throw new ImportAssetError(
      3,
      'processing instructions other than the XML declaration are rejected'
    );
  }
  if (!/^\s*(<\?xml|<svg|<!--)/i.test(text)) {
    throw new ImportAssetError(5, 'not an SVG file (magic-byte/content sniff failed)');
  }
}

/** Removes `el` and everything not in ALLOWED_ELEMENTS, at any depth. */
function walkAllowlist(root) {
  // querySelectorAll('*') returns every descendant regardless of depth —
  // exactly the "not root-only" guarantee DDR-167 requires.
  const all = [...root.querySelectorAll('*'), root];
  for (const el of all) {
    if (!el.isConnected && el !== root) continue; // already removed via an ancestor
    const tag = el.tagName;
    const allowed = ALLOWED_ELEMENTS.has(tag) && el.namespaceURI === SVG_NS;
    if (!allowed) {
      el.remove();
      continue;
    }
    if (TEXT_ONLY_ELEMENTS.has(tag)) {
      for (const child of [...el.children]) child.remove();
      continue;
    }
    const isSmil = SMIL_ELEMENTS.has(tag);
    for (const attr of [...el.attributes]) {
      const local = attr.localName;
      if (isSmil && SMIL_FUNCTIONAL_ATTRS.has(local)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (/^on/i.test(local)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (local === 'href') {
        if (!isSafeFragmentOrRasterData(attr.value)) el.removeAttribute(attr.name);
        continue;
      }
      if (FUNCIRI_ATTR_NAMES.has(local)) {
        if (!isSafeFuncIriValue(attr.value)) el.removeAttribute(attr.name);
        continue;
      }
      if (local === 'xmlns' || attr.name === 'xmlns:xlink' || local === 'xlink') {
        continue; // namespace declarations
      }
      if (ALLOWED_PLAIN_ATTRS.has(local)) continue;
      el.removeAttribute(attr.name);
    }
  }
}

/**
 * Decision 1, steps 2-5: parse → allowlist walk → re-serialize → SVGO
 * validity/minify gate. Does NOT run the execution canary (step 6) — that's
 * browser-driven, see runSvgExecutionCanary below. Throws on any hard reject.
 */
export function sanitizeSvgAllowlist(svgText) {
  svgPreParseReject(svgText);
  const window = new Window();
  const doc = new window.DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root?.tagName !== 'svg' || root.namespaceURI !== SVG_NS || doc.querySelector('parsererror')) {
    throw new ImportAssetError(3, 'SVG failed to parse');
  }
  walkAllowlist(root);
  if (!root.isConnected && root.tagName !== 'svg') {
    throw new ImportAssetError(3, 'root element was not a valid <svg> after sanitizing');
  }
  const serialized = root.outerHTML;
  if (!isValidSvg(serialized)) {
    throw new ImportAssetError(3, 'sanitized output failed the SVGO validity gate');
  }
  return optimizeSvg(serialized, { multipass: true });
}

// ============================================================================
// Decision 2 — PDF: single capped read → worker-isolated page-count → rasterize
// (rasterize lives in the sandboxed-render section, shared with the SVG canary).
// ============================================================================

export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_MAX_PAGES = 20;
const PDF_LIB_TIMEOUT_MS = 15_000;

/**
 * Decision 2, step 1 — realpath-then-open, single capped read. Rejects if any
 * path component is a symlink (shrinks the TOCTOU window to its structural
 * minimum — see DDR-167's named residual for what remains).
 */
export function readPdfCapped(inputPath, maxBytes = PDF_MAX_BYTES) {
  let real;
  try {
    real = realpathSync(inputPath);
  } catch (err) {
    throw new ImportAssetError(4, `could not resolve path: ${err?.message ?? err}`);
  }
  // Walk every path component and reject a symlink anywhere in the chain.
  let cur = real[0] === sep ? sep : '';
  for (const part of real.split(sep).filter(Boolean)) {
    cur = cur === sep ? `${sep}${part}` : `${cur}${sep}${part}`;
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      throw new ImportAssetError(3, `refusing a path containing a symlink component: ${cur}`);
    }
  }
  let buf;
  try {
    buf = readFileSync(real);
  } catch (err) {
    throw new ImportAssetError(4, `could not read file: ${err?.message ?? err}`);
  }
  if (buf.length === 0) throw new ImportAssetError(4, 'file is empty');
  if (buf.length > maxBytes) {
    throw new ImportAssetError(4, `PDF exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB cap`);
  }
  return buf;
}

const PDF_WORKER_URL = new URL('./_import-asset-pdf-worker.mjs', import.meta.url);

/**
 * Decision 2, step 2 — pdf-lib page-count discovery, isolated in a worker
 * thread with hard `.terminate()` on timeout (NOT a bare `Promise.race`,
 * which cannot interrupt a synchronous CPU-bound hang on this runtime).
 */
export async function getPdfPageCountIsolated(buffer, timeoutMs = PDF_LIB_TIMEOUT_MS) {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(PDF_WORKER_URL, {
      workerData: {
        buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      },
      transferList: [],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(
        new ImportAssetError(4, `PDF structural parse timed out after ${timeoutMs}ms (hard reject)`)
      );
    }, timeoutMs);
    worker.once('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (msg.ok) resolvePromise(msg.pageCount);
      else reject(new ImportAssetError(4, `unparseable/malformed PDF: ${msg.error}`));
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ImportAssetError(4, `PDF worker crashed: ${err?.message ?? err}`));
    });
  });
}

export function assertPdfPageCap(pageCount, maxPages = PDF_MAX_PAGES) {
  if (pageCount > maxPages) {
    throw new ImportAssetError(3, `PDF has ${pageCount} pages, exceeding the ${maxPages}-page cap`);
  }
}

// ============================================================================
// Shared hardened "sandboxed-render" browser helper (Decision 1 step 6's SVG
// execution canary + Decision 2 step 4's PDF page rasterizer). Built on
// agent-browser (already the bundled screenshot engine, DDR-088) rather than
// a hand-rolled CDP client — `network route '*' --abort` gives URL-pattern
// request interception that covers sub-resource loads (not just top-level
// navigation) and is not fooled by an IP-literal target the way a bare
// --host-resolver-rules hostname mapping would be.
// ============================================================================

function agentBrowserBin() {
  return process.env.MAUDE_AGENT_BROWSER_BIN || 'agent-browser';
}

function runAgentBrowser(sessionName, args, { timeoutMs = 20_000 } = {}) {
  return execFileSync(agentBrowserBin(), ['--session', sessionName, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Launch an isolated, network-denied agent-browser session, run `fn(session)`,
 * and unconditionally close the session afterward. `fn` receives a small
 * helper object, not the raw CLI, to keep every caller's hardening identical.
 * Exported for reuse by DDR-173 Decision 6 (T12's logo-wordmark raster
 * fallback) — same hardened session, no new browser automation surface.
 */
export async function withSandboxedRender(fn, { timeoutMs = 20_000, initScriptPath = null } = {}) {
  const sessionName = `maude-import-${createHash('sha256')
    .update(String(Math.random()) + Date.now())
    .digest('hex')
    .slice(0, 12)}`;
  try {
    const openArgs = ['open'];
    // The probe (if any) MUST be registered on the session-creating `open`
    // call — it runs before ANY page script on every subsequent navigation
    // in this session, which is what lets it observe a script tag executing
    // inside a directly-navigated SVG document (see runSvgExecutionCanary).
    if (initScriptPath) openArgs.push('--init-script', initScriptPath);
    runAgentBrowser(sessionName, openArgs, { timeoutMs });
    // Decision 2 — hard network denial via URL-pattern request interception
    // (covers every resource type, not just top-level navigation, and is not
    // fooled by an IP-literal target the way a bare --host-resolver-rules
    // hostname mapping would be). Scoped to http(s):// specifically — a bare
    // '*' route also aborts the `file://` navigation this helper itself needs
    // to load the candidate SVG/PDF, which would break the mechanism
    // entirely (verified live: a wildcard route 403s local file:// loads
    // too). Never `--no-sandbox` — the OS sandbox stays on by default; this
    // helper never passes it.
    runAgentBrowser(sessionName, ['network', 'route', 'http://**', '--abort'], { timeoutMs });
    runAgentBrowser(sessionName, ['network', 'route', 'https://**', '--abort'], { timeoutMs });
    return await fn({
      eval: (js) => runAgentBrowser(sessionName, ['eval', js], { timeoutMs }),
      open: (url) => runAgentBrowser(sessionName, ['open', url], { timeoutMs }),
      screenshot: (outPath) => runAgentBrowser(sessionName, ['screenshot', outPath], { timeoutMs }),
    });
  } finally {
    try {
      execFileSync(agentBrowserBin(), ['close', '--session', sessionName], {
        stdio: 'ignore',
        timeout: 10_000,
      });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Decision 1, step 6 — real-browser execution canary. Navigates DIRECTLY to
 * the SVGO-optimized, allowlist-sanitized file as the top-level document —
 * NOT wrapped in an `<img src>` host page, which is a script-disabled
 * context in every browser and would never observe an embedded `<script>`
 * executing (verified live: an `<img>`-embedded malicious SVG never trips a
 * probe regardless of content; direct navigation to the SVG file does). The
 * probe is installed via an init script that runs before any page script on
 * every navigation in this session, so a script tag inside the candidate
 * document — if one survived sanitizing — sets the flag itself. Hard rejects
 * (throws) on any signal. 15-second timeout (shares the helper's own budget).
 */
export async function runSvgExecutionCanary(sanitizedSvg, { timeoutMs = 15_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-import-svg-'));
  const svgPath = join(dir, 'candidate.svg');
  const probePath = join(dir, 'probe.js');
  try {
    writeFileSync(svgPath, sanitizedSvg);
    writeFileSync(probePath, 'window.__MAUDE_IMPORT_CANARY__ = false;\n');
    await withSandboxedRender(
      async (session) => {
        session.open(pathToFileURL(svgPath).href);
        const tripped = session.eval('window.__MAUDE_IMPORT_CANARY__ === true').trim();
        if (tripped === 'true') {
          throw new ImportAssetError(3, 'this file could not be safely imported (canary tripped)');
        }
      },
      { timeoutMs, initScriptPath: probePath }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return sanitizedSvg;
}

/**
 * Decision 2, step 4 (SUSPENDED — see DDR-167 addendum "PDF rasterization
 * mechanism not viable as specified"). Live spike-verification at T10
 * implementation time (per this DDR's own required contingency) found that
 * navigating agent-browser's automation-driven Chromium directly to a
 * `file://*.pdf` URL does NOT render page content — confirmed blank output
 * across `chrome-headless-shell` AND full Google Chrome, both headed and
 * headless, with a 2s settle wait. Automation-driven Chromium builds
 * conventionally disable the PDF-viewer plugin/extension so headless tooling
 * gets raw bytes instead of an interactive viewer — exactly the class of
 * "doesn't behave as expected" this DDR anticipated and pre-authorized an
 * honest failure for, rather than shipping code that would silently write
 * blank/wrong PNGs into a user's asset store. This function intentionally
 * throws — DO NOT implement a silent fallback (e.g. shelling out to
 * `pdftoppm` if present) without a new DDR addendum re-deriving the
 * PDF-rendering decision from scratch; DDR-167 explicitly rejected exactly
 * that path for making behavior installation-dependent and untested.
 */
export async function rasterizePdfPage(_pdfPath, _pageNumber, _opts = {}) {
  throw new ImportAssetError(
    1,
    'PDF import is not yet available — the planned rasterization mechanism (headless-Chromium ' +
      'navigating a file:// PDF URL) does not render page content under agent-browser automation ' +
      '(verified: blank output on both chrome-headless-shell and full Chrome). See DDR-167 for the ' +
      'finding and what a follow-up mechanism needs to satisfy before this ships.'
  );
}

// ============================================================================
// Orchestration
// ============================================================================

/** Full SVG import: sanitize → canary → content-address → contained write. */
export async function importSvg(svgText, { root, designRootRel = '.design' }) {
  const sanitized = sanitizeSvgAllowlist(svgText);
  await runSvgExecutionCanary(sanitized);
  return writeContainedAsset(root, designRootRel, Buffer.from(sanitized, 'utf8'), 'svg');
}

/**
 * Full PDF import: single capped read → worker-isolated page-count → per-page
 * rasterize via a contained temp copy → content-address + contained write
 * each page. Returns one result per page.
 *
 * SUSPENDED (see rasterizePdfPage's doc comment + DDR-167 addendum) — the
 * read/page-count/cap steps below are real, tested, reusable building blocks;
 * only the rasterize step is blocked, so this fails loud there rather than
 * pretending the whole pipeline is unavailable.
 */

/**
 * The execution canary for MANY sanitized SVGs, in ONE browser session.
 *
 * Same coverage as `runSvgExecutionCanary`, same probe, same hard network
 * denial, same directly-navigated document — the only thing that changes is
 * that the session is created once instead of once per file.
 *
 * Why it exists: measured on a real 6-page product file, a per-file canary cost
 * ~4.5 s each, so a normal design system's icon set (530 distinct vector
 * renders after component dedupe) would have taken ~40 minutes and forced the
 * import to drop most of its artwork against an asset-count cap. The canary is
 * not what needed relaxing — the session-per-file was.
 *
 * Returns the set of indices that TRIPPED, so the caller refuses exactly those
 * and keeps the rest. A tripped canary is still a hard refusal for that file.
 */
export async function runSvgExecutionCanaryBatch(sanitizedSvgs, { timeoutMs = 15_000 } = {}) {
  const tripped = new Set();
  if (sanitizedSvgs.length === 0) return tripped;
  const dir = mkdtempSync(join(tmpdir(), 'maude-import-svg-batch-'));
  const probePath = join(dir, 'probe.js');
  try {
    writeFileSync(probePath, 'window.__MAUDE_IMPORT_CANARY__ = false;\n');
    const paths = sanitizedSvgs.map((svg, i) => {
      const p = join(dir, `candidate-${i}.svg`);
      writeFileSync(p, svg);
      return p;
    });
    await withSandboxedRender(
      async (session) => {
        for (let i = 0; i < paths.length; i += 1) {
          session.open(pathToFileURL(paths[i]).href);
          // The probe re-runs on EVERY navigation in this session (it is
          // registered as an init script), so the flag is per-document — a
          // clean file after a tripped one still reads false.
          if (session.eval('window.__MAUDE_IMPORT_CANARY__ === true').trim() === 'true') {
            tripped.add(i);
          }
        }
      },
      { timeoutMs, initScriptPath: probePath }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return tripped;
}

/**
 * Sanitize + canary + write MANY SVGs. The batched counterpart of `importSvg`.
 * Returns one result per input, or `null` where the file was refused.
 */
export async function importSvgBatch(svgTexts, { root, designRootRel = '.design' }) {
  const sanitized = svgTexts.map((t) => {
    try {
      return sanitizeSvgAllowlist(t);
    } catch {
      return null;
    }
  });
  const live = [];
  for (let i = 0; i < sanitized.length; i += 1) if (sanitized[i] !== null) live.push(i);

  const tripped = await runSvgExecutionCanaryBatch(live.map((i) => sanitized[i]));
  return sanitized.map((svg, i) => {
    if (svg === null) return null;
    if (tripped.has(live.indexOf(i))) return null;
    return writeContainedAsset(root, designRootRel, Buffer.from(svg, 'utf8'), 'svg');
  });
}

export async function importPdf(inputPath, { root, designRootRel = '.design' }) {
  const buffer = readPdfCapped(inputPath);
  const pageCount = await getPdfPageCountIsolated(buffer);
  assertPdfPageCap(pageCount);

  const dir = mkdtempSync(join(tmpdir(), 'maude-import-pdfsrc-'));
  const tempPdfPath = join(dir, 'source.pdf');
  const results = [];
  try {
    writeFileSync(tempPdfPath, buffer);
    for (let page = 1; page <= pageCount; page += 1) {
      const png = await rasterizePdfPage(tempPdfPath, page);
      // Re-sniff — never trust the browser produced a real PNG just because
      // it was asked to.
      if (
        !(
          png.length >= 8 &&
          png[0] === 0x89 &&
          png[1] === 0x50 &&
          png[2] === 0x4e &&
          png[3] === 0x47
        )
      ) {
        throw new ImportAssetError(4, `page ${page} did not produce a valid PNG`);
      }
      results.push(writeContainedAsset(root, designRootRel, png, 'png'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

// ============================================================================
// Decision 4 (DDR-174, T15) — local raster (PNG/JPEG) ingestion. The vision-
// reconstruction flow's source image (a Figma-frame export) is a plain raster,
// not SVG/PDF — this is the "same asset-upload gate any other image upload
// already goes through" DDR-174 Decision 4 assumes exists, extended to a local
// CLI path (the browser drag-drop `POST /_api/asset` already accepts PNG/JPEG,
// just not from a bare filesystem path with no browser in the loop). No
// sanitize step is needed (raster pixels carry no markup/script surface the
// way SVG does) — containment + magic-byte re-sniff is the whole control.
// ============================================================================

export const RASTER_MAX_BYTES = 25 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Sniff the REAL format from bytes — never trust the input filename's extension. */
export function sniffRasterKind(bytes) {
  if (PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'png';
  if (JPEG_MAGIC.every((b, i) => bytes[i] === b)) return 'jpg';
  return null;
}

/**
 * Realpath-then-open, LEAF-symlink rejection checked against the ORIGINAL
 * (pre-resolution) path — mirrors `_import-tokens.mjs`'s `readTokenFileCapped`,
 * the corrected form of this repo's own symlink check (T11 found and fixed a
 * structurally-inert version of this same check elsewhere in this file,
 * `readPdfCapped`, which walks the POST-resolution path and can therefore
 * never observe a symlink — flagged there as a follow-up, not silently
 * repeated here).
 */
export function readRasterCapped(inputPath, maxBytes = RASTER_MAX_BYTES) {
  const absOriginal = resolve(inputPath);
  let leafStat;
  try {
    leafStat = lstatSync(absOriginal);
  } catch (err) {
    throw new ImportAssetError(4, `could not resolve path: ${err?.message ?? err}`);
  }
  if (leafStat.isSymbolicLink()) {
    throw new ImportAssetError(3, `refusing a path whose target is a symlink: ${absOriginal}`);
  }
  let real;
  try {
    real = realpathSync(inputPath);
  } catch (err) {
    throw new ImportAssetError(4, `could not resolve path: ${err?.message ?? err}`);
  }
  let buf;
  try {
    buf = readFileSync(real);
  } catch (err) {
    throw new ImportAssetError(4, `could not read file: ${err?.message ?? err}`);
  }
  if (buf.length === 0) throw new ImportAssetError(4, 'file is empty');
  if (buf.length > maxBytes) {
    throw new ImportAssetError(
      4,
      `raster image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB cap`
    );
  }
  return buf;
}

/** Full raster import: capped symlink-safe read → magic-byte sniff → contained write. */
export function importRaster(inputPath, { root, designRootRel = '.design' }) {
  const buf = readRasterCapped(inputPath);
  const kind = sniffRasterKind(buf);
  if (!kind) {
    throw new ImportAssetError(
      5,
      'not a recognized raster image (expected a PNG or JPEG magic-byte signature)'
    );
  }
  return writeContainedAsset(root, designRootRel, buf, kind);
}

// ============================================================================
// CLI entry
// ============================================================================

function parseArgv(argv) {
  const out = { file: null, root: null, designRoot: '.design', kind: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--root':
        out.root = argv[++i];
        break;
      case '--design-root':
        out.designRoot = argv[++i];
        break;
      case '--kind':
        out.kind = argv[++i];
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new ImportAssetError(2, `unknown flag ${a}`);
        if (out.file === null) out.file = a;
        else throw new ImportAssetError(2, `unexpected extra arg ${a}`);
    }
  }
  return out;
}

const HELP = `import-asset — hardened local-file SVG/PDF/raster ingestion (reached via \`maude design import-asset\`)

Usage:
  maude design import-asset <local-path> --root <repo> [--design-root .design]
                            [--kind svg|pdf|raster] [--json]

Sanitizes (SVG), rasterizes (PDF, one PNG per page), or content-addresses as-is
(raster PNG/JPEG — DDR-174 T15's vision-reconstruction source image path) a
LOCAL file, writing the result(s) to <designRoot>/assets/<sha8>.<ext> and
printing the reference path(s). See DDR-167 for the full security posture.

Exit: 0 ok · 2 usage · 3 sanitize/validation reject · 4 read/parse error ·
      5 unsupported media type · 6 write/containment error · 1 other.`;

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`import-asset: ${err.message}\n`);
    process.exit(err instanceof ImportAssetError ? err.code : 2);
  }
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!opts.file) {
    process.stderr.write('import-asset: <local-path> required\n');
    process.exit(2);
  }
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    let results;
    const lower = opts.file.toLowerCase();
    const defaultKind = lower.endsWith('.pdf')
      ? 'pdf'
      : lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'raster'
        : 'svg';
    const kind = opts.kind || defaultKind;
    if (kind === 'pdf') {
      results = await importPdf(opts.file, { root, designRootRel: opts.designRoot });
    } else if (kind === 'raster' || kind === 'png' || kind === 'jpg') {
      results = [importRaster(opts.file, { root, designRootRel: opts.designRoot })];
    } else {
      const text = readFileSync(opts.file, 'utf8');
      results = [await importSvg(text, { root, designRootRel: opts.designRoot })];
    }
    // S8.21 — where it came from, on THIS Mac only (`_canvas-state/asset-origins.json`, never synced): the details'
    // Advanced shows it as "Original". A record that cannot be kept never fails the import.
    for (const r of results) {
      if (r?.path) recordAssetOrigin(resolve(root, opts.designRoot), r.path, resolve(opts.file));
    }
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(results)}\n`);
    } else {
      for (const r of results) process.stdout.write(`${r.ref}\n`);
    }
  } catch (err) {
    process.stderr.write(`import-asset: ${err.message}\n`);
    process.exit(err instanceof ImportAssetError ? err.code : 1);
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
