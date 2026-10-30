// V2-8.9 attacker L2 — the shell's "Paste … copied in X?" ask fires on the PERSON's schedule, not the
// canvas's: a canvas-originated paste of another canvas's clip raises the trusted toast only within ~1 s
// of a paste the shell saw (its own ⌘V / menu / ⌘K row, or a ⌘V the active frame relayed while it held
// the focus of a focused window — the sec-a undo-key focus gate). Otherwise the canvas hears a refusal.
// Attacker L3 addition — the clip handle never travels back into the canvas frame: the reply keeps only
// what the canvas draws (kind + count).

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  _resetPasteIntent,
  _setHeldClip,
  frameClipResult,
  notePasteIntent,
  PASTE_INTENT_MS,
  shapeClipRequest,
} from '../client/clipboard-relay.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const handle = {
  id: 'c_0123456789abcdef',
  kind: 'objects' as const,
  count: 2,
  from: 'ui/Home.tsx',
};
const paste = (file: string) => ({ file, op: 'canvas.paste', targets: [], params: {} });

describe('the cross-canvas paste ask needs a paste the shell saw', () => {
  beforeEach(() => {
    _setHeldClip(handle);
    _resetPasteIntent();
  });

  test('no recent paste: the canvas hears a refusal, no ask, nothing forwarded', () => {
    const s = shapeClipRequest(paste('.design/ui/Other.tsx'), { now: 10_000 });
    expect(s.kind).toBe('reply');
    if (s.kind !== 'reply') return;
    expect(s.result.ok).toBe(false);
    expect(!s.result.ok && s.result.message).toMatch(/press ⌘V/i);
  });

  test('within the window of a paste the shell saw: the shell asks', () => {
    notePasteIntent(10_000);
    const s = shapeClipRequest(paste('.design/ui/Other.tsx'), { now: 10_000 + PASTE_INTENT_MS });
    expect(s.kind).toBe('confirm');
  });

  test('a stale intent does not count, and one intent answers one ask', () => {
    notePasteIntent(10_000);
    expect(
      shapeClipRequest(paste('.design/ui/Other.tsx'), { now: 10_001 + PASTE_INTENT_MS }).kind
    ).toBe('reply');
    notePasteIntent(20_000);
    expect(shapeClipRequest(paste('.design/ui/Other.tsx'), { now: 20_100 }).kind).toBe('confirm');
    expect(shapeClipRequest(paste('.design/ui/Other.tsx'), { now: 20_200 }).kind).toBe('reply');
  });

  test('a paste into the canvas the clip came from needs no ask and no intent', () => {
    expect(shapeClipRequest(paste('.design/ui/Home.tsx'), { now: 10_000 }).kind).toBe('forward');
  });
});

describe('the clip handle stays in the shell', () => {
  test('a copy answer reaches the canvas with kind + count only', () => {
    const result: EditOpResult = {
      ok: true,
      actionId: null,
      writeId: '',
      rev: 'r',
      refs: [],
      detail: { clip: handle, other: 1 },
    };
    const out = frameClipResult({ file: 'f', op: 'object.copy', targets: [] }, result);
    expect(out.ok && out.detail).toEqual({ clip: { kind: 'objects', count: 2 }, other: 1 });
    expect(JSON.stringify(out)).not.toContain(handle.id);
    // the shell's own copy of the answer is untouched
    expect((result as { detail: { clip: unknown } }).detail.clip).toEqual(handle);
  });

  test('any other answer passes as is', () => {
    const r: EditOpResult = { ok: false, code: 'invalid', message: 'no' };
    expect(frameClipResult({ file: 'f', op: 'object.copy', targets: [] }, r)).toBe(r);
  });
});
