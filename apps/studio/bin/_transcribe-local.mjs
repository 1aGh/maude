#!/usr/bin/env bun
// _transcribe-local.mjs — internal shim behind `maude design transcribe-local` (S7.2, DDR-062,
// V2-1.10 §5.6–§5.7). Words → `assets/<sha8>.transcript.json` through the strict sidecar writer.
//
//   transcribe-local <assets/x.ext> [--lang xx] [--model <installed id>] [--speech-only] [--json]
//                    [--root <repo>]
//
// LOCAL ONLY, and that is why this verb is auto tier (V2-1.11 §5.3: effect `project`, no network,
// writes confined to the project): there is no --provider, no --whisper, no --out. It cannot reach a
// paid cloud engine (that stays `transcribe`, prompt tier), cannot run a binary a flag names, and
// NEVER downloads a model — a missing engine is exit 3 and a pointer to Settings, where the person
// downloads a model themselves (generation/whisper-models.ts).
//
// The engine is whisper.cpp (`whisper-cli`, a soft dependency — never bundled, DDR-177) plus an
// INSTALLED ggml model from Maude's managed cache. `--speech-only` needs neither: it writes speech
// regions from band-limited energy, labelled `engine.id: "energy"`.
//
// Stdout (last line): the sidecar path, design-root relative — or, with --json, one JSON object.
// Stderr: progress. Exit: 0 ok · 1 input/dependency problem · 2 usage · 3 no speech engine on this
// Mac · 4 decoding or transcription failed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, sep } from 'node:path';

import {
  getWhisperModel,
  resolveWhisperModel,
  WHISPER_MODELS,
  whisperModelPath,
} from '../generation/whisper-models.ts';
import { DecodeError, EXTRA_TOOL_DIRS, findFfmpeg } from '../video/decode.ts';
import {
  analyseSpeech,
  isLangCode,
  isSidecarableAsset,
  toTranscript,
  WhisperRunError,
  writeTranscriptSidecar,
} from '../video/words-run.ts';
import { INSTALL_HINT } from './_pw-launch.mjs';

const VERB = 'transcribe-local';
const SETTINGS_PATH = 'Settings › Advanced › Speech recognition';

export const EXIT = { ok: 0, input: 1, usage: 2, noEngine: 3, failed: 4 };

/** Homebrew's dirs, unless MAUDE_NO_EXTRA_TOOL_DIRS=1 (tests: PATH alone decides what is installed). */
function toolDirs() {
  return process.env.MAUDE_NO_EXTRA_TOOL_DIRS === '1' ? [] : EXTRA_TOOL_DIRS;
}

/**
 * `whisper-cli` — the one name, looked up on PATH and then in Homebrew's dirs (a GUI-launched app
 * has a stripped PATH). No `--whisper <bin>`, no env override: an auto-tier verb never runs a binary
 * the caller names. The probe EXECUTES the candidate (`--help`), so the bare legacy name `main` is
 * never among them (a seeded `main` on a `.` PATH — the Phase-2 security finding).
 */
export function findWhisperCli({ path = process.env.PATH ?? '', extraDirs = toolDirs() } = {}) {
  for (const dir of [...path.split(delimiter).filter(Boolean), ...extraDirs]) {
    const c = join(dir, 'whisper-cli');
    if (!existsSync(c)) continue;
    const probe = spawnSync(c, ['--help'], { stdio: 'ignore' });
    if (!probe.error) return c;
  }
  return null;
}

/** `.design/config.json` → generation.transcription.whisperModel, or undefined. */
function configuredModelId(repo) {
  try {
    const cfg = JSON.parse(readFileSync(join(repo, '.design', 'config.json'), 'utf8'));
    const m = cfg?.generation?.transcription?.whisperModel;
    return typeof m === 'string' ? m : undefined;
  } catch {
    return undefined;
  }
}

export function parseArgs(argv) {
  const out = { speechOnly: false, json: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lang') out.lang = next();
    else if (a === '--model') out.model = next();
    else if (a === '--speech-only') out.speechOnly = true;
    else if (a === '--json') out.json = true;
    else if (a === '--root') out.root = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) out.unknown = a;
    else out.positional.push(a);
  }
  return out;
}

const USAGE =
  `usage: maude design ${VERB} <assets/x.ext> [--lang xx] [--model <installed id>]\n` +
  '                                  [--speech-only] [--json] [--root <repo>]\n' +
  '\n' +
  '  Words and speech regions for ONE project asset, written to assets/<name>.transcript.json.\n' +
  '  Local whisper.cpp only; it never downloads a model. --speech-only needs no engine and\n' +
  '  writes regions from energy. For a cloud engine use `maude design transcribe --provider`.\n';

function fail(code, message) {
  process.stderr.write(`${VERB}: ${message}\n`);
  process.exit(code);
}

function noEngine(reason) {
  process.stderr.write(
    `${VERB}: No speech engine on this Mac.\n` +
      `  ${reason}\n` +
      `  Set it up in ${SETTINGS_PATH} — Maude never downloads a model by itself.\n`
  );
  process.exit(EXIT.noEngine);
}

/** The Chromium decoder for video/decode.ts: its own process, so a missing browser stays contained. */
export function chromiumDecoder(file, sampleRate) {
  const shim = join(import.meta.dir, '_decode-chromium.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'maude-decode-'));
  const raw = join(dir, 'pcm.f32');
  try {
    const run = spawnSync(process.execPath, [shim, file, String(sampleRate), raw], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (run.status === 3) throw new DecodeError('no-decoder', INSTALL_HINT);
    if (run.status !== 0 || !existsSync(raw))
      throw new DecodeError('failed', 'Chromium could not read this file’s sound');
    const bytes = readFileSync(raw);
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stderr.write(USAGE);
    process.exit(EXIT.ok);
  }
  if (args.unknown) fail(EXIT.usage, `unknown option ${args.unknown}\n${USAGE}`);
  if (args.positional.length !== 1)
    fail(EXIT.usage, `exactly one asset path is required\n${USAGE}`);
  if (args.lang !== undefined && !isLangCode(args.lang))
    fail(EXIT.usage, `--lang must be an ISO 639 code like "en" or "cs", not '${args.lang}'`);

  const repo = args.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const designRoot = join(repo, '.design');
  if (!existsSync(designRoot)) fail(EXIT.input, `no .design/ in ${repo} (use --root <repo>)`);

  // The asset: assets/<name>.<ext> in this project, nothing else. A sidecar is named after it, so a
  // path outside assets/ has nowhere to write; and no ".." can climb out.
  const asset = args.positional[0].replace(/^\.\//, '');
  if (!isSidecarableAsset(asset))
    fail(
      EXIT.usage,
      `'${args.positional[0]}' is not a project asset (assets/<name>.<ext>) — add the file to the project first (maude design import-asset)`
    );
  const input = join(designRoot, asset);
  if (!existsSync(input)) fail(EXIT.input, `asset not found: ${asset}`);
  // a symlink inside assets/ must not read a file from outside the project
  const assetsReal = realpathSync(join(designRoot, 'assets'));
  if (!realpathSync(input).startsWith(assetsReal + sep))
    fail(EXIT.input, `${asset} points outside assets/ — refusing`);

  let whisper = null;
  let modelPath = null;
  let modelId = null;
  if (!args.speechOnly) {
    whisper = findWhisperCli();
    if (!whisper) noEngine('whisper.cpp is not installed (brew install whisper-cpp).');
    if (args.model !== undefined) {
      const m = getWhisperModel(args.model);
      if (!m)
        fail(
          EXIT.usage,
          `unknown model '${args.model}' — one of ${WHISPER_MODELS.map((x) => x.id).join(', ')}`
        );
      modelPath = whisperModelPath(m);
      if (!existsSync(modelPath)) noEngine(`The ${m.id} model is not installed on this Mac.`);
      modelId = m.id;
    } else {
      modelPath = resolveWhisperModel(configuredModelId(repo));
      if (!modelPath) noEngine('No speech model is installed on this Mac.');
      const file = basename(modelPath);
      modelId = WHISPER_MODELS.find((m) => m.file === file)?.id ?? null;
    }
    // The owner's Czech-footage gotcha: an English-only `.en` model garbles other languages.
    if (modelId?.endsWith('.en') && args.lang && args.lang !== 'en')
      process.stderr.write(
        `${VERB}: WARNING — ${modelId} is English-only but --lang ${args.lang} was given; expect garbled output (use a multilingual model).\n`
      );
  }

  let analysis;
  try {
    analysis = await analyseSpeech({
      input,
      whisper,
      modelPath,
      modelId,
      lang: args.lang,
      speechOnly: args.speechOnly,
      decode: { ffmpeg: findFfmpeg({ extraDirs: toolDirs() }), chromium: chromiumDecoder },
      log: (l) => process.stderr.write(`${VERB}: ${l}\n`),
    });
  } catch (err) {
    if (err instanceof DecodeError) {
      if (err.code === 'no-decoder') fail(EXIT.failed, `${err.message}`);
      fail(EXIT.failed, err.message);
    }
    if (err instanceof WhisperRunError) fail(EXIT.failed, err.message);
    throw err;
  }
  if (!args.speechOnly && analysis.words.length === 0)
    fail(EXIT.failed, 'no words recognized (silent or unsupported audio?)');

  const rel = writeTranscriptSidecar(designRoot, toTranscript(analysis, asset));
  const speechSec =
    Math.round(analysis.regions.reduce((s, [a, b]) => s + (b - a), 0) * 1000) / 1000;
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        asset,
        sidecar: rel,
        engine: analysis.engine,
        lang: analysis.lang ?? null,
        words: analysis.words.length,
        loopWords: analysis.words.filter((w) => w.flags?.includes('loop')).length,
        speechRegions: analysis.regions.length,
        speechSec,
        durationSec: analysis.durationSec,
        decodedBy: analysis.via,
      })}\n`
    );
  } else {
    process.stderr.write(
      `${VERB}: ${analysis.words.length} words, ${speechSec}s of speech in ${analysis.durationSec}s\n`
    );
    process.stdout.write(`${rel}\n`);
  }
}

// Only run when invoked directly, so the tests can import the pure parts without spawning anything.
if (import.meta.main) await main();
