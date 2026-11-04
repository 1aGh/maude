#!/usr/bin/env node
/**
 * Intro2 captions: whisper each clean VO take (not the mixed film, where the music bed blurs
 * whisper's word timing), shift every word by that line's offset in the mix, and write one
 * Caption[] JSON for captions-to-vtt.mjs. Same whisper.cpp + model as sub.mjs (whisper-config).
 *
 * Usage: node scripts/intro2-captions.mjs <vo_dir> "<vo-1:400 vo-2:5400 …>" <out.json> [script.json]
 *
 * With script.json ({ "vo-1": "<the approved line>", … }) the caption TEXT is the script, word for
 * word, and whisper gives only the timing: when whisper's word count matches, each script word takes
 * its whisper word's time; when it does not (whisper merges or splits words), the script words are
 * spread over the line's spoken span in proportion to their length.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadWhisperModel, installWhisperCpp, toCaptions, transcribe } from '@remotion/install-whisper-cpp';
import { WHISPER_LANG, WHISPER_MODEL, WHISPER_PATH, WHISPER_VERSION } from '../whisper-config.mjs';

const [, , voDir, list, out, scriptPath] = process.argv;
const SCRIPT = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : {};
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
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(voDir, `${name}.mp3`), '-af', 'apad=pad_dur=1', '-ar', '16000', '-ac', '1', wav]);
    const whisperCppOutput = await transcribe({
      inputPath: wav, model: WHISPER_MODEL, tokenLevelTimestamps: true, whisperPath: WHISPER_PATH,
      whisperCppVersion: WHISPER_VERSION, printOutput: false, translateToEnglish: false,
      language: WHISPER_LANG, splitOnWord: true,
    });
    const { captions: raw } = toCaptions({ whisperCppOutput });
    let captions = raw.filter((c) => !/^\s*\[.*\]\s*$/.test(c.text)); // [BLANK_AUDIO] and friends
    const line = SCRIPT[name];
    if (line && captions.length) {
      const words = line.split(/\s+/);
      if (words.length === captions.length) {
        captions = captions.map((c, i) => ({ ...c, text: ` ${words[i]}` }));
      } else {
        const a = captions[0].startMs;
        const b = captions[captions.length - 1].endMs;
        const total = words.reduce((n, w) => n + w.length + 1, 0);
        let acc = 0;
        captions = words.map((w) => {
          const s0 = a + ((b - a) * acc) / total;
          acc += w.length + 1;
          const s1 = a + ((b - a) * acc) / total;
          return { text: ` ${w}`, startMs: s0, endMs: s1, timestampMs: s0, confidence: null };
        });
      }
    }
    const o = Number(offset);
    for (const c of captions) all.push({ ...c, startMs: c.startMs + o, endMs: c.endMs + o, timestampMs: c.timestampMs == null ? null : c.timestampMs + o });
    console.log(`  ${name} +${offset} ms: ${captions.map((c) => c.text).join('').trim()}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(out, JSON.stringify(all, null, 2));
console.log(`✓ ${out} (${all.length} words)`);
