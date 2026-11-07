#!/usr/bin/env node
// _video-proxy.mjs — make an H.264 / constant-frame-rate / single-AAC copy of one video asset, behind
// `maude design video-proxy` (DDR-062 dispatch). #128 §1, root cause of #127.
//
// WHY: an iPhone clip (HEVC, variable frame rate) or a `.mov` with a second audio track plays in the Player
// but the export's audio renderer cannot decode it — the export then falls back to frame-by-frame capture
// and the file ships with no sound. A proxy is the fix: the same picture and sound in a form the export can
// read. It is an EXPLICIT action, never automatic: the user's file is never converted behind their back, and
// the original is only ever read. The copy is a new asset next to it, `assets/<sha8>.mp4` (content-
// addressed like every asset, so it resolves everywhere one does); put it in the canvas in place of the clip.
//
// Needs ffmpeg + ffprobe (a soft dependency, never bundled — DDR-177). The file is read only from inside
// `<designRoot>/assets/` (realpath-checked). Reached via `maude design video-proxy`, never a raw path.
//
// stdout = JSON { source, proxy, reused, found:[label], width?, height?, fps }. Exit: 0 ok · 2 usage ·
// 3 no ffmpeg/ffprobe · 4 not a readable video · 6 outside assets/ · 1 other.

import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { makeProxy, ProxyError, proxyFps } from './_media-probe.mjs';

class UsageError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

const VIDEO_EXT = /\.(?:mp4|m4v|mov|webm)$/i;

/** The absolute path of a video inside `<root>/<designRootRel>/assets`, or throw. */
export function resolveAsset(asset, root, designRootRel = '.design') {
  const assetsDir = realpathSync(resolve(root, designRootRel, 'assets'));
  const given = String(asset);
  const abs = isAbsolute(given)
    ? given
    : resolve(root, designRootRel, given.replace(/^\.?\/+/, ''));
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    throw new UsageError(`no such asset: ${given}`);
  }
  const rel = relative(assetsDir, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
    throw new UsageError('the clip must be a file directly inside the project’s assets/ folder', 6);
  }
  if (!VIDEO_EXT.test(rel)) throw new UsageError(`${rel} is not a video (mp4, m4v, mov, webm)`, 4);
  if (!statSync(real).isFile()) throw new UsageError(`${rel} is not a file`, 4);
  return { real, assetsDir, name: rel };
}

/** Make the proxy. Returns the manifest the verb prints. */
export function videoProxy({ asset, root, designRootRel = '.design', ffmpeg, ffprobe }) {
  const { real, assetsDir, name } = resolveAsset(asset, root, designRootRel);
  const r = makeProxy({ src: real, outDir: assetsDir, ffmpeg, ffprobe });
  return {
    source: `assets/${name}`,
    proxy: `assets/${r.name}`,
    reused: r.reused,
    found: r.issues.map((i) => i.label),
    width: r.probe.video.width,
    height: r.probe.video.height,
    fps: proxyFps(r.probe),
  };
}

const HELP = `video-proxy — make an H.264 copy of a video asset that exports with sound
(reached via \`maude design video-proxy\`)

Usage:
  maude design video-proxy assets/<clip> --root <repo> [--design-root .design]

Writes a new asset next to the original — assets/<sha8>.mp4: H.264, constant frame rate,
the first audio track as AAC. The original is never changed; use the copy in the canvas in
its place. Needs ffmpeg and ffprobe. Do this for a clip the import or an export said is HEVC,
variable frame rate, or has more than one audio track.

Exit: 0 ok · 2 usage · 3 no ffmpeg · 4 not a readable video · 6 outside assets/ · 1 other.`;

function parseArgv(argv) {
  const out = { asset: null, root: null, designRoot: '.design', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--design-root') out.designRoot = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown flag ${a}`);
    else if (out.asset === null) out.asset = a;
    else throw new UsageError(`unexpected extra arg ${a}`);
  }
  return out;
}

function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`video-proxy: ${err.message}\n`);
    process.exit(err.code ?? 2);
  }
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!opts.asset) {
    process.stderr.write('video-proxy: an asset is required (assets/<clip>)\n');
    process.exit(2);
  }
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    process.stderr.write(
      'video-proxy: making an H.264 copy — this can take a while for a long clip\n'
    );
    const r = videoProxy({ asset: opts.asset, root, designRootRel: opts.designRoot });
    if (r.found.length)
      process.stderr.write(`video-proxy: the original is ${r.found.join(', ')}\n`);
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`video-proxy: ${err.message}\n`);
    process.exit(err instanceof UsageError || err instanceof ProxyError ? err.code : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
