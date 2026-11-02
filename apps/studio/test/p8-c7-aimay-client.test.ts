// P8 c7 follow-up (decision maude/v2-p8-c7-ai-may-enforced) — the panel sends Advanced › AI may as the
// `may` field of its main-origin prompt / warm frames; the server holds it (acp-may-gate.test.ts). The
// `[maude-may …]` line in the ask text stays a hint (p8-c7-ai.test.tsx).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mayField, promptFrame } from '../client/v2/ai/ask-frame.js';

describe('promptFrame carries the may switches', () => {
  test('both keys, booleans only; only an explicit false is off', () => {
    expect(promptFrame({ text: 'x', may: { assets: true, web: false } }).may).toEqual({
      assets: true,
      web: false,
    });
    expect(mayField({ web: 'no' })).toEqual({ assets: true, web: true });
    expect(mayField({ assets: false })).toEqual({ assets: false, web: true });
  });
  test('no may given → no field (an older caller sends what it sent)', () => {
    expect(promptFrame({ text: 'x' }).may).toBeUndefined();
    expect(mayField(null)).toBeUndefined();
  });
});

describe('the socket sends the per-Mac switches with every prompt and warm frame', () => {
  const src = readFileSync(
    join(import.meta.dir, '..', 'client', 'panels', 'acp-runtime.js'),
    'utf8'
  );
  test('prompt: may read per send', () => {
    const at = src.indexOf('promptFrame({');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 600)).toContain('may: readMay()');
  });
  test('warm: may too, so a warmed session is spawned with the rules', () => {
    const at = src.indexOf("t: 'warm'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toContain('may: mayField(readMay())');
  });
});
