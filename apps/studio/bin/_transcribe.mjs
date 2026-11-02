#!/usr/bin/env bun
// _transcribe.mjs — internal shim behind `maude design transcribe` (DDR-062).
// Local, no-key speech-to-text for automatic subtitles: spawn whisper.cpp
// (whisper-cli) on an audio/video file, parse its word-level JSON, and emit
// SRT/VTT through the SHARED captions.ts reflow (the same rules the cloud STT
// providers — ElevenLabs Scribe, Groq Whisper — run through, so local + cloud
// subtitles never drift on line-length / timing). Runs under Bun so it can
// import the `.ts` caption module directly (mirrors _svg-optimize.mjs).
//
// whisper.cpp is a SOFT dependency (plugins/design/dependencies.json): absent →
// this exits non-zero with an actionable message (install it, or use the cloud
// Scribe path). No dev server, no ffmpeg of our own — mirrors the footage-probe
// shim shape.
//
// Model + binary resolution (whisper.cpp ships neither a default model nor
// auto-download): `--model <path>` or $MAUDE_WHISPER_MODEL (a ggml .bin);
// `--whisper <path>` or $MAUDE_WHISPER_CLI, else whisper-cli / whisper / main.
//
// Stdout (last line): the produced .srt path. Stderr: progress/diagnostics.
// Exit: 0 ok / 1 dependency-or-input problem / 3 transcription failed.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { wordsToSrt, wordsToVtt } from '../generation/captions.ts';
import { resolveWhisperModel, WHISPER_MODELS } from '../generation/whisper-models.ts';
import { DecodeError } from '../video/decode.ts';
import {
  analyseSpeech,
  isSidecarableAsset,
  toTranscript,
  WhisperRunError,
  writeTranscriptSidecar,
} from '../video/words-run.ts';
import { chromiumDecoder } from './_transcribe-local.mjs';

/** Read `.design/config.json` → generation.transcription.whisperModel, or null
 *  (the preferred managed model id, e.g. "base"). */
function readConfigWhisperModel(repo) {
  try {
    const cfg = JSON.parse(readFileSync(join(repo, '.design', 'config.json'), 'utf8'));
    const m = cfg?.generation?.transcription?.whisperModel;
    return typeof m === 'string' ? m : null;
  } catch {
    return null;
  }
}

/**
 * whisper.cpp `-oj` JSON → word timings. With `-ml 1` each `transcription[]`
 * entry is ~one word; `offsets.from/to` are milliseconds from the audio start.
 * Pure + exported so the parsing is unit-testable without whisper installed.
 */
export function whisperJsonToWords(jsonText) {
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const segs = Array.isArray(doc?.transcription) ? doc.transcription : [];
  const words = [];
  for (const s of segs) {
    const text = typeof s?.text === 'string' ? s.text.trim() : '';
    if (!text) continue;
    const from = Number(s?.offsets?.from);
    const to = Number(s?.offsets?.to);
    words.push({
      text,
      start: Number.isFinite(from) ? from / 1000 : 0,
      end: Number.isFinite(to) ? to / 1000 : 0,
    });
  }
  return words;
}

function parseArgs(argv) {
  const out = { format: 'srt', words: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--source') out.source = next();
    else if (a === '--root') out.root = next();
    else if (a === '--out') out.out = next();
    else if (a === '--format')
      out.format = next(); // srt | vtt | both
    else if (a === '--model') out.model = next();
    else if (a === '--whisper') out.whisper = next();
    else if (a === '--provider')
      out.provider = next(); // whisper | elevenlabs | groq
    else if (a === '--lang') out.lang = next();
    else if (a === '--segments')
      out.words = false; // segment-level, not per-word
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const CLOUD_PROVIDERS = new Set(['elevenlabs', 'groq']);
const KNOWN_PROVIDERS = new Set(['auto', 'whisper', 'elevenlabs', 'groq']);

/**
 * Resolve the transcription engine as an EXPLICIT choice (Task 2.6): the
 * --provider flag wins; else the project's `generation.transcription.provider`
 * config default; else `whisper` (local, free) — and we SAY which we chose.
 * Maude never silently reaches for a paid cloud engine. Returns { provider,
 * defaulted } where `defaulted` means neither the flag nor config set it.
 */
export function resolveProvider(flag, repo) {
  if (flag) {
    if (!KNOWN_PROVIDERS.has(flag)) {
      process.stderr.write(
        `transcribe: unknown --provider '${flag}' (use auto | whisper | elevenlabs | groq)\n`
      );
      process.exit(2);
    }
    return { provider: flag, defaulted: false };
  }
  const configured = readConfigProvider(repo);
  if (configured && KNOWN_PROVIDERS.has(configured))
    return { provider: configured, defaulted: false };
  return { provider: 'whisper', defaulted: true };
}

/**
 * Settle an `auto` choice into a concrete engine. `auto` prefers a cloud engine
 * whose key is set (ElevenLabs Scribe first), else local whisper — mirroring
 * generation/whisper-models.ts `resolveAutoEngine`. Key presence lives
 * server-side (the keychain), so this asks the local dev server; with no server
 * reachable there is no key to use anyway, so it settles on local whisper.
 *
 * Still no SILENT cloud switch (DDR-164): `auto` is a chosen mode, and the
 * caller prints which engine it resolved to before transcribing.
 */
export async function settleAutoProvider(provider, port) {
  if (provider !== 'auto') return { provider, autoReason: null };
  const base = `http://127.0.0.1:${port || process.env.MAUDE_PORT || 4399}`;
  try {
    const res = await fetch(`${base}/_api/generate/providers`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const body = await res.json();
      const keyed = new Set(
        (body.providers || []).filter((p) => p && p.configured).map((p) => p.id)
      );
      if (keyed.has('elevenlabs'))
        return { provider: 'elevenlabs', autoReason: 'auto → ElevenLabs Scribe (key is set)' };
      if (keyed.has('groq'))
        return { provider: 'groq', autoReason: 'auto → Groq Whisper (key is set)' };
    }
  } catch {
    /* no server / no keys — local whisper is the honest answer */
  }
  return { provider: 'whisper', autoReason: 'auto → local whisper.cpp (no cloud key set)' };
}

/** Read `.design/config.json` → generation.transcription.provider, or null. */
function readConfigProvider(repo) {
  try {
    const raw = readFileSync(join(repo, '.design', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw);
    const p = cfg?.generation?.transcription?.provider;
    return typeof p === 'string' ? p : null;
  } catch {
    return null;
  }
}

function resolveWhisper(explicit) {
  // Security (Phase-2 ethical-hacker): do NOT include the bare name `main`
  // (whisper.cpp's legacy binary) in the fallback chain — it is one of the most
  // common executable names in the wild, and the probe below EXECUTES each
  // candidate (`--help`). A user running this inside an untrusted repo with `.`
  // on $PATH could otherwise auto-run a seeded `main`. Only the explicit
  // --whisper / $MAUDE_WHISPER_CLI (owner's own choice) and the specific
  // whisper-cli / whisper names are probed.
  const candidates = [explicit, process.env.MAUDE_WHISPER_CLI, 'whisper-cli', 'whisper'].filter(
    Boolean
  );
  for (const c of candidates) {
    const probe = spawnSync(c, ['--help'], { stdio: 'ignore' });
    if (!probe.error) return c;
  }
  return null;
}

/**
 * Cloud STT path (Task 2.6): the user CHOSE elevenlabs / groq. The transcription
 * runs on the dev server's privileged generate route (the key is resolved
 * server-side — never handed to this CLI), which writes the SRT sidecar next to
 * the source and returns its `assets/<sha8>.srt` path. No-silent-switch: if the
 * server is down or the source isn't an assets/ path, we ERROR clearly naming
 * the fix AND the local alternative — we NEVER quietly fall back to whisper.
 */
async function runCloud(args, repo, provider) {
  const source = args.source;
  if (!source.startsWith('assets/') || source.includes('..')) {
    process.stderr.write(
      `transcribe: cloud engine '${provider}' needs a content-addressed source (assets/<sha8>.<ext>).\n` +
        '  Ingest the file into the project first, or use --provider whisper for an arbitrary local path.\n'
    );
    process.exit(2);
  }
  const serverPath = join(repo, '.design', '_server.json');
  if (!existsSync(serverPath)) {
    process.stderr.write(
      `transcribe: cloud engine '${provider}' needs the dev server running (it resolves your key server-side).\n` +
        '  Start it: maude design server-up   — or use --provider whisper (local, no server, no key).\n'
    );
    process.exit(1);
  }
  let port;
  try {
    port = JSON.parse(readFileSync(serverPath, 'utf8'))?.port;
  } catch {
    /* handled below */
  }
  if (!port) {
    process.stderr.write(`transcribe: could not read a port from ${serverPath}\n`);
    process.exit(1);
  }

  const base = `http://127.0.0.1:${port}/_api/generate-jobs`;
  const body = { modality: 'transcription', provider, sourceAsset: source };
  if (args.model) body.model = args.model;
  if (args.lang) body.params = { language: args.lang };

  process.stderr.write(`transcribe: submitting to ${provider} (cloud STT)…\n`);
  let jobId;
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      process.stderr.write(
        `transcribe: ${provider} enqueue rejected: ${json?.error ?? res.status}\n`
      );
      process.exit(3);
    }
    jobId = json.jobId;
  } catch (err) {
    process.stderr.write(`transcribe: could not reach the dev server: ${err?.message ?? err}\n`);
    process.exit(1);
  }
  if (!jobId) {
    process.stderr.write('transcribe: enqueue returned no job id\n');
    process.exit(3);
  }

  const deadline = Date.now() + 300_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    let job;
    try {
      const jobs = await (await fetch(base)).json();
      job = Array.isArray(jobs?.jobs) ? jobs.jobs.find((j) => j.id === jobId) : null;
    } catch {
      /* transient — keep polling until the deadline */
    }
    if (job?.status === 'done') {
      const out = job.assets?.[0];
      if (!out) {
        process.stderr.write('transcribe: job done but produced no caption sidecar\n');
        process.exit(3);
      }
      // Chosen engine may only produce SRT; the shared reflow output is SRT. If a
      // VTT was asked for, note that the cloud path currently writes SRT only.
      process.stdout.write(`${out.startsWith('/') ? out.slice(1) : out}\n`);
      return;
    }
    if (job?.status === 'failed') {
      process.stderr.write(
        `transcribe: ${provider} transcription failed: ${job.error ?? 'unknown'}\n`
      );
      process.exit(3);
    }
    if (Date.now() >= deadline) {
      process.stderr.write(`transcribe: timed out waiting for ${provider} (job ${jobId})\n`);
      process.exit(3);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stderr.write(
      'usage: maude design transcribe --source <assets/x.mp4|file> [--root <repo>]\n' +
        '  [--provider whisper|elevenlabs|groq] [--format srt|vtt|both] [--model <id>]\n' +
        '  [--whisper <bin>] [--lang <code>] [--segments]\n' +
        '\n' +
        '  The engine is an EXPLICIT choice: --provider wins, else the project\n' +
        '  generation.transcription.provider, else local whisper (never a silent\n' +
        '  switch to a paid cloud engine). whisper = local/free/no-key;\n' +
        '  elevenlabs|groq = cloud (needs the dev server + a key in Settings).\n'
    );
    process.exit(0);
  }
  if (!args.source) {
    process.stderr.write('transcribe: --source is required\n');
    process.exit(1);
  }

  const repo = args.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Resolve the engine as an explicit choice (Task 2.6). A chosen cloud engine
  // routes through the dev server (key server-side); the local default stays
  // whisper. We NEVER auto-switch between them.
  const { provider: chosen, defaulted } = resolveProvider(args.provider, repo);
  // `auto` settles into a concrete engine here, and we SAY which — the engine is
  // never a mystery even when the user delegated the pick (DDR-164).
  const { provider, autoReason } = await settleAutoProvider(chosen, args.port);
  if (autoReason) process.stderr.write(`transcribe: ${autoReason}\n`);
  if (defaulted)
    process.stderr.write(
      'transcribe: no engine configured — using local whisper ' +
        '(set generation.transcription.provider or pass --provider to choose)\n'
    );
  if (CLOUD_PROVIDERS.has(provider)) {
    await runCloud(args, repo, provider);
    return;
  }

  // Resolve the input: an `assets/<name>` under the design root, or a plain path.
  // For the assets/ form, reject `..` so the content-addressed branch can't be
  // used to climb out of <designRoot>/assets/ (parity with api.readAssetBytes —
  // the network Scribe path is fully contained; keep this local path close). The
  // plain-path branch intentionally accepts an owner-named file (transcribing an
  // arbitrary local clip is a legitimate CLI use; there is no untrusted caller).
  if (args.source.startsWith('assets/') && args.source.includes('..')) {
    process.stderr.write('transcribe: invalid assets/ path (no "..")\n');
    process.exit(1);
  }
  const input = args.source.startsWith('assets/')
    ? join(repo, '.design', args.source)
    : resolve(repo, args.source);
  if (!existsSync(input)) {
    process.stderr.write(`transcribe: input not found: ${input}\n`);
    process.exit(1);
  }

  const whisper = resolveWhisper(args.whisper);
  if (!whisper) {
    process.stderr.write(
      'transcribe: whisper.cpp not found (whisper-cli / whisper / main).\n' +
        '  Install: brew install whisper-cpp  (or build https://github.com/ggml-org/whisper.cpp)\n' +
        '  Or set $MAUDE_WHISPER_CLI. For cloud STT instead, use ElevenLabs Scribe / Groq Whisper.\n'
    );
    process.exit(1);
  }

  // Model resolution (Task 2.7 — one-click): explicit --model / $MAUDE_WHISPER_MODEL
  // wins; otherwise auto-resolve a model downloaded via Settings ("Download &
  // enable"), preferring the configured `generation.transcription.whisperModel`.
  const model =
    args.model ||
    process.env.MAUDE_WHISPER_MODEL ||
    resolveWhisperModel(readConfigWhisperModel(repo));
  if (!model || !existsSync(model)) {
    process.stderr.write(
      'transcribe: no whisper.cpp model available.\n' +
        '  One-click: open Settings (⌘,) → Subtitles → "Download model" (base is a good multilingual default).\n' +
        '  Or pass --model <ggml-*.bin> / set $MAUDE_WHISPER_MODEL, or use a cloud engine (--provider elevenlabs|groq).\n'
    );
    process.exit(1);
  }

  // The owner's Czech-footage gotcha: an English-only `.en` model garbles other
  // languages. Warn (don't block — the user may know their audio is English).
  if (/\.en\.bin$/i.test(model) && args.lang && args.lang.toLowerCase() !== 'en') {
    process.stderr.write(
      `transcribe: WARNING — model ${basename(model)} is English-only but --lang ${args.lang} was given; expect garbled output. Use a multilingual model (e.g. ggml-base.bin).\n`
    );
  }

  const outBase = args.out
    ? args.out.replace(/\.(srt|vtt|json)$/i, '')
    : join(dirname(input), basename(input, extname(input)));

  // The words pipeline (S7.2, V2-1.10 §5.6) — the same one `transcribe-local` runs: decode (ffmpeg,
  // else Chromium), whisper.cpp `-ojf -ml 1 -sow -dtw -nfa` into a PRIVATE temp dir (never a bare
  // `assets/<sha8>.json` beside the source), lag calibration + energy snap + loop flags. `--segments`
  // is kept as a no-op for old callers: words are always timed now.
  process.stderr.write(`transcribe: running ${whisper} (${basename(model)})…\n`);
  let analysis;
  try {
    analysis = await analyseSpeech({
      input,
      whisper,
      modelPath: model,
      modelId: WHISPER_MODELS.find((m) => m.file === basename(model))?.id ?? null,
      lang: args.lang,
      decode: { chromium: chromiumDecoder },
      log: (l) => process.stderr.write(`transcribe: ${l}\n`),
    });
  } catch (err) {
    if (err instanceof DecodeError || err instanceof WhisperRunError) {
      process.stderr.write(
        `transcribe: ${err.message} — if the input is a non-WAV container, install ffmpeg so Maude can read its sound.\n`
      );
      process.exit(3);
    }
    throw err;
  }
  if (analysis.words.length === 0) {
    process.stderr.write('transcribe: no words recognized (silent or unsupported audio?)\n');
    process.exit(3);
  }

  // The machine-written sidecar for a project asset — through the strict writer, so the word timings
  // reach peers and the Transcript panel; the SRT below is an export artefact (C36).
  if (args.source.startsWith('assets/') && isSidecarableAsset(args.source)) {
    const rel = writeTranscriptSidecar(join(repo, '.design'), toTranscript(analysis, args.source));
    process.stderr.write(`transcribe: wrote ${rel}\n`);
  }

  // Loop-flagged words are left out of captions until a person confirms them (V2-1.10 Q1).
  const words = analysis.words
    .filter((w) => !w.flags?.includes('loop'))
    .map((w) => ({ text: w.text, start: w.t0, end: w.t1 }));
  if (words.length === 0) {
    process.stderr.write('transcribe: only repeated noise was recognized — no captions written\n');
    process.exit(3);
  }

  const written = [];
  if (args.format === 'srt' || args.format === 'both') {
    const p = `${outBase}.srt`;
    writeFileSync(p, wordsToSrt(words));
    written.push(p);
  }
  if (args.format === 'vtt' || args.format === 'both') {
    const p = `${outBase}.vtt`;
    writeFileSync(p, wordsToVtt(words));
    written.push(p);
  }
  // Last stdout line = the primary (SRT-preferred) caption path, for $(…) capture.
  process.stdout.write(`${written[0]}\n`);
}

// Only run main when invoked directly (import.meta.main) so the parser can be
// imported by the test without spawning whisper (mirrors the F3 CLI-guard fix).
if (import.meta.main) main();
