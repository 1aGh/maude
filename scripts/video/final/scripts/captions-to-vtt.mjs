#!/usr/bin/env node
/**
 * Caption[] JSON (sub.mjs / @remotion/captions) → WebVTT for the site's <track kind="captions">.
 *
 * Cues break at the end of a sentence, or before a cue passes MAX_CHARS. Whisper's spellings of
 * our own names are fixed from FIXES (it hears "Maude Cloud" as "ModCloud", "maude.sh" as "maud.sh").
 *
 * Usage: node scripts/captions-to-vtt.mjs <captions.json> <out.vtt>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: captions-to-vtt.mjs <captions.json> <out.vtt>');
  process.exit(2);
}
const MAX_CHARS = 64;
const FIXES = [
  [/\bMod ?Cloud\b/gi, 'Maude Cloud'],
  [/\bMaud\b/g, 'Maude'],
  [/\bmaud\.sh\b/gi, 'maude.sh'],
  [/\bmood board\b/gi, 'moodboard'],
  [/^screens\b/, 'Screens'],
  // Intro2's script punctuation, where whisper heard the pause differently.
  [/^Draw it yourself or just ask\./, 'Draw it yourself, or just ask.'],
  [/\bslides, and print\b/, 'slides and print'],
  [/\blive on one canvas\b/, 'live, on one canvas'],
  [/^Maude, built around AI/, 'Maude. Built around AI'],
];

const words = JSON.parse(readFileSync(input, 'utf8'));
const cues = [];
let cur = null;
for (const w of words) {
  const text = w.text.trim();
  if (!text || /^\[.*\]$/.test(text)) continue; // whisper's [BLANK_AUDIO] and friends
  if (cur && (cur.text + ' ' + text).length > MAX_CHARS) {
    cues.push(cur);
    cur = null;
  }
  if (!cur) cur = { start: w.startMs, end: w.endMs, text };
  else {
    cur.text += ' ' + text;
    cur.end = w.endMs;
  }
  if (/[.?!]$/.test(text)) {
    cues.push(cur);
    cur = null;
  }
}
if (cur) cues.push(cur);

const ts = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = String(Math.floor(t / 3600000)).padStart(2, '0');
  const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(t % 1000).padStart(3, '0')}`;
};
const fix = (s) => FIXES.reduce((acc, [re, to]) => acc.replace(re, to), s);

let vtt = 'WEBVTT\n\n';
cues.forEach((c, i) => {
  const next = cues[i + 1];
  // Hold each cue a little past its last word, never into the next one.
  const end = Math.min(c.end + 400, next ? next.start - 20 : c.end + 400);
  vtt += `${i + 1}\n${ts(c.start)} --> ${ts(end)}\n${fix(c.text)}\n\n`;
});
writeFileSync(output, vtt);
console.log(`✓ ${output} (${cues.length} cues)`);
