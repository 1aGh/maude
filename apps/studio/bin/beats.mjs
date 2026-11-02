// beats.mjs — `maude design beats <asset> [--bpm N] [--dry-run] [--json]` (S7.3, V2-1.10 §5.6 / §5.7).
// Detects the beat grid of one music asset and writes the versioned sidecar `assets/<base>.beats.json`
// (`maude.beats` v1) through the strict writer in `video/schema.ts`. `--bpm N` fixes the tempo (a person or
// AI correcting an octave error — `bpmSource: "set"`), re-tracks only the beats, and keeps the bar phase of
// the grid already on disk. `--dry-run` prints and writes nothing.
//
// Decode: ffmpeg when it is on PATH, headless-Chromium WebAudio when it is not (identical beats, V2-1.10
// §6.3). No dev server, no network, nothing downloaded. Reached via `maude design beats` (DDR-062).
//
// Exit: 0 ok · 2 usage · 3 no decoder (no ffmpeg, no Chromium) · 4 asset missing / undecodable · 1 other.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyzeBeats, beatGridFrom, downbeatsOf } from '../video/beats.ts';
import { DecodeError, decodeAudio, findFfmpeg } from '../video/decode.ts';
import { chromiumDecoder } from '../video/decode-webaudio.ts';
import {
  BPM_RANGE,
  readBeats,
  SIDECAR_ASSET_RE,
  SidecarWriteError,
  serializeBeats,
  sidecarRelFor,
} from '../video/schema.ts';

class Usage extends Error {
  constructor(msg) {
    super(msg);
    this.code = 2;
  }
}

const HELP = `beats — detect the beats of one music asset and write assets/<base>.beats.json
(reached via \`maude design beats\`)

Usage:
  maude design beats <assets/<base>.<ext>> [--bpm N] [--dry-run] [--json]
                     [--root <repo>] [--design-root .design] [--decode auto|ffmpeg|chromium]

  --bpm N      fix the tempo (20-400): re-tracks the beats at that tempo, keeps the bar phase of the
               existing grid, writes bpmSource "set". Use it to fix a half or double tempo.
  --dry-run    print the grid, write nothing
  --json       print { sidecar, written, grid } instead of the one-line summary
  --decode     force the decoder (default auto: ffmpeg, then headless Chromium when ffmpeg is missing)

Exit: 0 ok · 2 usage · 3 no decoder · 4 asset missing or undecodable · 1 other.`;

export function parseArgv(argv) {
  const o = {
    asset: null,
    bpm: undefined,
    dryRun: false,
    json: false,
    root: null,
    designRoot: '.design',
    decode: 'auto',
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--bpm': {
        const raw = argv[++i];
        const n = Number(raw);
        if (raw === undefined || raw.trim() === '' || !Number.isFinite(n))
          throw new Usage(`--bpm needs a number, got ${raw ?? 'nothing'}`);
        if (n < BPM_RANGE[0] || n > BPM_RANGE[1])
          throw new Usage(`--bpm must be between ${BPM_RANGE[0]} and ${BPM_RANGE[1]}`);
        o.bpm = n;
        break;
      }
      case '--dry-run':
        o.dryRun = true;
        break;
      case '--json':
        o.json = true;
        break;
      case '--root':
        o.root = argv[++i];
        break;
      case '--design-root':
        o.designRoot = argv[++i];
        break;
      case '--decode': {
        const d = argv[++i];
        if (!['auto', 'ffmpeg', 'chromium'].includes(d))
          throw new Usage('--decode must be auto, ffmpeg or chromium');
        o.decode = d;
        break;
      }
      case '--help':
      case '-h':
        o.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new Usage(`unknown flag ${a}`);
        if (o.asset !== null) throw new Usage(`unexpected extra argument ${a}`);
        o.asset = a;
    }
  }
  return o;
}

/** `assets/m.mp3` or `m.mp3` → { abs, rel, base } inside <root>/<designRoot>/assets, symlinks resolved. */
export function resolveAsset(root, designRoot, asset) {
  const cleaned = String(asset).replace(/^\/+/, '');
  const rel = cleaned.startsWith('assets/') ? cleaned : `assets/${cleaned}`;
  const m = SIDECAR_ASSET_RE.exec(rel);
  if (!m) throw new Usage(`not an asset path (expected assets/<name>.<ext>): ${asset}`);
  const assetsDir = resolve(root, designRoot, 'assets');
  const abs = join(assetsDir, `${m[1]}.${m[2]}`);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    const e = new Error(`asset not found: ${rel}`);
    e.code = 4;
    throw e;
  }
  if (!st.isFile() && !st.isSymbolicLink()) {
    const e = new Error(`not a file: ${rel}`);
    e.code = 4;
    throw e;
  }
  const real = realpathSync(abs);
  if (!real.startsWith(`${realpathSync(assetsDir)}${sep}`))
    throw new Usage(`asset escapes assets/: ${rel}`);
  return { abs: real, rel, base: m[1], assetsDir };
}

function readExisting(sidecarAbs, sidecarRel) {
  if (!existsSync(sidecarAbs)) return null;
  try {
    const r = readBeats(readFileSync(sidecarAbs, 'utf8'), sidecarRel);
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

/** Keep every key a newer peer's file carries: spread the old value under the new one, one level down. */
function mergeUnknown(existing, grid) {
  if (!existing) return grid;
  return {
    ...existing,
    ...grid,
    analyzer: { ...existing.analyzer, ...grid.analyzer },
    bar: { ...existing.bar, ...grid.bar },
  };
}

export async function run(
  opts,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }
) {
  if (!opts.asset) throw new Usage('<assets/<base>.<ext>> required');
  const root = opts.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { abs, rel, assetsDir } = resolveAsset(root, opts.designRoot, opts.asset);
  const sidecarRel = sidecarRelFor(rel, 'beats');
  const sidecarAbs = join(assetsDir, sidecarRel.slice('assets/'.length));
  const existing = readExisting(sidecarAbs, sidecarRel);

  const decoded = await decodeAudio(abs, {
    sampleRate: 22_050,
    maxSeconds: 1800,
    prefer: opts.decode,
    wavDirect: false, // the sidecar records ffmpeg | chromium
    // PATH only (no Homebrew dirs): the beats verb's own contract, pinned by beats-verb.test
    ffmpeg: opts.decode === 'chromium' ? null : findFfmpeg({ extraDirs: [] }),
    chromium: chromiumDecoder,
    onFallback: (why) => io.err(`beats: ${why}\n`),
  });
  const analysis = analyzeBeats(decoded.pcm, {
    ...(opts.bpm !== undefined ? { bpm: opts.bpm } : {}),
    ...(opts.bpm !== undefined && existing ? { keepDownbeats: downbeatsOf(existing) } : {}),
  });
  const createdAt = process.env.MAUDE_BEATS_NOW || new Date().toISOString();
  const grid = mergeUnknown(existing, beatGridFrom(rel, analysis, decoded.via, createdAt));
  const text = serializeBeats(grid, sidecarRel);

  if (!opts.dryRun) {
    mkdirSync(dirname(sidecarAbs), { recursive: true });
    const tmp = `${sidecarAbs}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, text);
      renameSync(tmp, sidecarAbs);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }
  if (opts.json) {
    io.out(`${JSON.stringify({ sidecar: sidecarRel, written: !opts.dryRun, grid }, null, 2)}\n`);
  } else {
    const weak = grid.tempoStrength < 0.15 ? ' (no clear beat)' : '';
    io.out(
      `${sidecarRel}  ${grid.bpm} BPM (${grid.bpmSource})${weak}  ${grid.beats.length} beats  ` +
        `bar phase ${grid.bar.phase} (${grid.bar.confidence})  via ${grid.analyzer.decode}` +
        `${opts.dryRun ? '  [dry run]' : ''}\n`
    );
  }
  return grid;
}

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
    if (opts.help) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    await run(opts);
  } catch (err) {
    process.stderr.write(`beats: ${err.message}\n`);
    if (err instanceof DecodeError) {
      process.exit(err.code === 'no-decoder' ? 3 : 4);
    }
    if (err instanceof SidecarWriteError) process.exit(1);
    process.exit(err.code === 2 || err.code === 4 ? err.code : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
