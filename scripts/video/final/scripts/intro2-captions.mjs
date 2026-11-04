#!/usr/bin/env node
/**
 * Intro2 captions: whisper each clean VO take (not the mixed film, where the music bed blurs
 * whisper's word timing), shift every word by that line's offset in the mix, and write one
 * Caption[] JSON for captions-to-vtt.mjs. Same whisper.cpp + model as sub.mjs (whisper-config).
 *
 * Usage: node scripts/intro2-captions.mjs <vo_dir> "<vo-1:400 vo-2:5400 …>" <out.json>
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
} from '@remotion/install-whisper-cpp';
import { WHISPER_LANG, WHISPER_MODEL, WHISPER_PATH, WHISPER_VERSION } from '../whisper-config.mjs';

const [, , voDir, list, out] = process.argv;
if (!voDir || !list || !out) {
  console.error('usage: intro2-captions.mjs <vo_dir> "<name:offset_ms …>" <out.json>');
  process.exit(2);
}
await installWhisperCpp({ to: WHISPER_PATH, version: WHISPER_VERSION });
await downloadWhisperModel({ folder: WHISPER_PATH, model: WHISPER_MODEL });

const tmp = mkdtempSync(path.join(tmpdir(), 'intro2-captions-'));
const all = [];
try {
  for (const entry of list.trim().split(/\s+/)) {
    const [name, offset] = entry.split(':');
    const wav = path.join(tmp, `${name}.wav`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      path.join(voDir, `${name}.mp3`),
      '-af',
      'apad=pad_dur=1',
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    const whisperCppOutput = await transcribe({
      inputPath: wav,
      model: WHISPER_MODEL,
      tokenLevelTimestamps: true,
      whisperPath: WHISPER_PATH,
      whisperCppVersion: WHISPER_VERSION,
      printOutput: false,
      translateToEnglish: false,
      language: WHISPER_LANG,
      splitOnWord: true,
    });
    const { captions } = toCaptions({ whisperCppOutput });
    for (const c of captions) {
      if (/^\s*\[.*\]\s*$/.test(c.text)) continue; // [BLANK_AUDIO] and friends
      const o = Number(offset);
      all.push({
        ...c,
        startMs: c.startMs + o,
        endMs: c.endMs + o,
        timestampMs: c.timestampMs == null ? null : c.timestampMs + o,
      });
    }
    console.log(
      `  ${name} +${offset} ms: ${captions
        .map((c) => c.text)
        .join('')
        .trim()}`
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(out, JSON.stringify(all, null, 2));
console.log(`✓ ${out} (${all.length} words)`);
