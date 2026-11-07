#!/usr/bin/env node
// _ingest-footage.mjs — ingest a DIRECTORY of raw footage into the design root's
// content-addressed asset store, behind `maude design ingest-footage` (DDR-062
// dispatch). The folder-scale counterpart to `_fetch-asset.mjs` (single URL).
//
// feature-footage-analysis-director, Task 3. WHY THIS EXISTS: the `/design-video:reel`
// director pipeline wants to start from a folder of client clips
// (`/…/podklady/video`). This verb copies each recognised video (and any image/
// audio) into `<designRoot>/assets/<sha8>.<ext>` — the SAME content-addressed
// convention `/_api/asset` + `_fetch-asset.mjs` use, so a clip references
// uniformly as `assets/<sha8>.mp4` on both the main and the canvas origin.
//
// SECURITY / DISCIPLINE (mirrors _fetch-asset.mjs):
//   • magic-byte sniff decides the category + extension — the source name /
//     extension is NEVER trusted (a `.mp4` that is really an HTML polyglot →
//     skipped). Mirrors api.ts sniffAssetType (mp4/mov/m4v/webm video · mp3/wav/
//     m4a audio · png/jpg/gif/webp image); SVG/script → null → skipped.
//   • content-addressed `<sha8>.<ext>` name, `[a-z0-9._-]` only, written FLAT
//     under assets/ with a realpath containment assertion.
//   • per-file size cap (default 100 MB — the DDR-148 video ceiling); oversized
//     files are SKIPPED LOUDLY (listed in the manifest), never silently dropped.
//   • the source directory is READ-ONLY — this never writes back into it.
//   • no network, no shell interpolation, no container parsing (magic bytes only).
//
// Reached via `maude design ingest-footage <dir> --root <repo>`, never a raw path.
// stdout (default) = a JSON manifest { clips:[{asset,src,bytes,category,warning?}],
// skipped:[{src,why}], warnings:[string], assetsDir }. A video that is HEVC, variable frame
// rate or has a second audio track carries a `warning` naming the asset and the codec (#128 §1;
// needs ffprobe, silently absent without it) and is echoed on stderr. Exit: 0 ok (even with
// skips) · 2 usage · 6 write/containment error · 1 other.

import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describeMedia, findTool, probeMedia } from './_media-probe.mjs';

// The DDR-148 video ceiling (100 MB). Images/audio also ride this generous cap
// here — the reel pipeline's inputs are dominated by video. Override per-file
// via --max-bytes.
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

class IngestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── magic-byte sniff (mirrors apps/studio/api.ts sniffAssetType) ──────────────

/** Sniff → { ext, category } or null. Bytes decide; name/extension untrusted. */
export function sniffAsset(b) {
  // Images (mirrors sniffImageType).
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return { ext: 'png', category: 'image' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { ext: 'jpg', category: 'image' };
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  )
    return { ext: 'gif', category: 'image' };
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return { ext: 'webp', category: 'image' };
  // ISO-BMFF (mp4 / mov / m4a / m4v): "ftyp" at offset 4, brand at 8.
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (brand === 'qt  ') return { ext: 'mov', category: 'video' };
    if (brand.startsWith('M4A')) return { ext: 'm4a', category: 'audio' };
    if (brand.startsWith('M4V')) return { ext: 'm4v', category: 'video' };
    return { ext: 'mp4', category: 'video' };
  }
  // Matroska / WebM — EBML header.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return { ext: 'webm', category: 'video' };
  // MP3 — "ID3" or frame-sync.
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)
    return { ext: 'mp3', category: 'audio' };
  if (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)
    return { ext: 'mp3', category: 'audio' };
  // WAV.
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x41 &&
    b[10] === 0x56 &&
    b[11] === 0x45
  )
    return { ext: 'wav', category: 'audio' };
  return null;
}

// ── path helpers (mirror _fetch-asset.mjs containment) ───────────────────────

/** Resolve `<root>/<designRootRel>/assets` with a containment assertion. */
export function assetsDirFor(root, designRootRel) {
  const rootAbs = resolve(root);
  const assetsDir = resolve(rootAbs, designRootRel, 'assets');
  if (assetsDir !== rootAbs && !assetsDir.startsWith(rootAbs + sep))
    throw new IngestError(6, `assets dir escapes root: ${assetsDir}`);
  return assetsDir;
}

/** Assert a content-addressed name and resolve it inside assets/ (no traversal). */
export function containedName(assetsDir, name) {
  if (!/^[a-z0-9]{8}\.(png|jpg|gif|webp|mp4|mov|m4v|webm|mp3|wav|m4a)$/.test(name))
    throw new IngestError(6, `generated name failed the charset contract: ${name}`);
  const fileAbs = resolve(assetsDir, name);
  if (fileAbs !== join(assetsDir, name) || !fileAbs.startsWith(assetsDir + sep))
    throw new IngestError(6, `resolved asset path escapes assets dir: ${fileAbs}`);
  return fileAbs;
}

// ── sniff head + full-file hash (streamed — clips can be 100 MB) ─────────────

/** Read the first `n` bytes of a file for the magic-byte sniff. */
function readHead(file, n = 16) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

/** Full-file sha256 (streamed) → first 8 hex chars. */
function hashFile(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('error', rej)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex').slice(0, 8)));
  });
}

// ── directory walk + ingest ──────────────────────────────────────────────────

function listFiles(dir, recursive) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (e) {
      throw new IngestError(2, `cannot read directory ${d}: ${e?.message ?? e}`);
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // skip dotfiles / .DS_Store
      const abs = join(d, ent.name);
      if (ent.isDirectory()) {
        if (recursive) walk(abs);
      } else if (ent.isFile()) {
        out.push(abs);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Ingest every recognised media file under `dir` into assets/. Returns
 * { clips, skipped, assetsDir }. Never throws on a per-file problem (that file
 * is skipped with a reason); throws IngestError only for whole-run failures
 * (unreadable dir, containment breach).
 */
export async function ingestFootage({
  dir,
  root,
  designRootRel = '.design',
  maxBytes = DEFAULT_MAX_BYTES,
  recursive = false,
  probe, // ffprobe path, or null for "none" (a test seam); default = look it up
}) {
  const srcDir = resolve(dir);
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory())
    throw new IngestError(2, `not a directory: ${srcDir}`);

  const assetsDir = assetsDirFor(root, designRootRel);
  mkdirSync(assetsDir, { recursive: true });

  const clips = [];
  const skipped = [];
  const seen = new Set(); // sha8 dedupe within this run
  const warnings = [];
  const ffprobe = probe === undefined ? findTool('ffprobe') : probe;

  for (const file of listFiles(srcDir, recursive)) {
    let size;
    try {
      size = statSync(file).size;
    } catch (e) {
      skipped.push({ src: file, why: `stat failed: ${e?.message ?? e}` });
      continue;
    }
    if (size === 0) {
      skipped.push({ src: file, why: 'empty file' });
      continue;
    }
    if (size > maxBytes) {
      skipped.push({
        src: file,
        why: `exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB per-file cap (${Math.round(size / (1024 * 1024))} MB)`,
      });
      continue;
    }
    let info;
    try {
      info = sniffAsset(readHead(file));
    } catch (e) {
      skipped.push({ src: file, why: `read failed: ${e?.message ?? e}` });
      continue;
    }
    if (!info) {
      skipped.push({
        src: file,
        why: `unrecognised media (not video/image/audio); ext ${extname(file) || '(none)'}`,
      });
      continue;
    }
    let sha8;
    try {
      sha8 = await hashFile(file);
    } catch (e) {
      skipped.push({ src: file, why: `hash failed: ${e?.message ?? e}` });
      continue;
    }
    const name = `${sha8}.${info.ext}`;
    let fileAbs;
    try {
      fileAbs = containedName(assetsDir, name);
    } catch (e) {
      skipped.push({ src: file, why: e?.message ?? 'containment error' });
      continue;
    }
    // Content-addressed dedupe: identical bytes → identical name → copy once.
    if (!existsSync(fileAbs)) {
      try {
        copyFileSync(file, fileAbs);
      } catch (e) {
        skipped.push({ src: file, why: `copy failed: ${e?.message ?? e}` });
        continue;
      }
    }
    if (!seen.has(sha8)) {
      seen.add(sha8);
      const clip = { asset: `assets/${name}`, src: file, bytes: size, category: info.category };
      // #128 §1 — a clip that plays but cannot be exported with sound (HEVC, variable frame rate, a
      // second audio track) is named now, not after a muted export. No ffprobe = nothing to say.
      if (info.category === 'video' && ffprobe) {
        const warning = describeMedia(clip.asset, probeMedia(fileAbs, { ffprobe }));
        if (warning) {
          clip.warning = warning;
          warnings.push(warning);
        }
      }
      clips.push(clip);
    }
  }

  return { clips, skipped, warnings, assetsDir };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const out = {
    dir: null,
    root: null,
    designRoot: '.design',
    maxBytes: DEFAULT_MAX_BYTES,
    recursive: false,
    json: true,
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
      case '--max-bytes':
        out.maxBytes = Number(argv[++i]);
        break;
      case '--recursive':
        out.recursive = true;
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new IngestError(2, `unknown flag ${a}`);
        if (out.dir === null) out.dir = a;
        else throw new IngestError(2, `unexpected extra arg ${a}`);
    }
  }
  return out;
}

const HELP = `ingest-footage — copy a folder of raw footage into the design asset store
(reached via \`maude design ingest-footage\`)

Usage:
  maude design ingest-footage <dir> --root <repo> [--design-root .design]
                              [--recursive] [--max-bytes N]

Walks <dir>, magic-byte-sniffs each file (mp4/mov/m4v/webm video · mp3/wav/m4a
audio · png/jpg/gif/webp image; SVG/script/unrecognised skipped), content-
addresses each to <designRoot>/assets/<sha8>.<ext>, and prints a JSON manifest.
Oversized / unrecognised files are SKIPPED and listed under "skipped" — never
silently dropped. The source directory is read-only.

Exit: 0 ok (even with skips) · 2 usage · 6 write/containment error · 1 other.`;

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`ingest-footage: ${err.message}\n`);
    process.exit(err instanceof IngestError ? err.code : 2);
  }
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!opts.dir) {
    process.stderr.write('ingest-footage: <dir> required\n');
    process.exit(2);
  }
  if (!Number.isFinite(opts.maxBytes) || opts.maxBytes <= 0) {
    process.stderr.write('ingest-footage: --max-bytes must be a positive number\n');
    process.exit(2);
  }
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const r = await ingestFootage({
      dir: opts.dir,
      root,
      designRootRel: opts.designRoot,
      maxBytes: opts.maxBytes,
      recursive: opts.recursive,
    });
    for (const w of r.warnings) process.stderr.write(`ingest-footage: ⚠ ${w}\n`);
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`ingest-footage: ${err.message}\n`);
    process.exit(err instanceof IngestError ? err.code : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
