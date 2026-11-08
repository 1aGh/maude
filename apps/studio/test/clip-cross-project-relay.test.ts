// #122 (122-C, contract 122-cross-canvas-clipboard.md §5.6) — the shell half of a paste between two projects on
// this Mac. A copy tells the desktop shell its handle (`clip_note`); a paste first asks which copy is the latest
// on this Mac (`clip_latest`): this tab's → the ordinary path; another project tab's → the shell's own confirm,
// on the person's schedule only (the 1 s paste intent), and only after Paste does Rust carry the clip
// (`clip_take`) — the paste then names the handle Rust brought, never one the canvas sent. Cloud tabs and the
// browser (no bridge) keep today's words.

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  _resetPasteIntent,
  _setHeldClip,
  CELL_NO_CROSS_PROJECT,
  type ClipBridge,
  type ClipHandle,
  confirmedPasteBody,
  NOTHING_TO_PASTE,
  noteClipResult,
  notePasteIntent,
  shapeClipPaste,
  tauriClipBridge,
} from '../client/clipboard-relay.ts';
import type { EditOpRequest, EditOpResult } from '../edit-ops/types.ts';

const HELD: ClipHandle = {
  id: 'c_00000000000000aa',
  kind: 'objects',
  count: 2,
  from: 'ui/Home.tsx',
};
const paste = (file = 'ui/Home.tsx', clip?: string): EditOpRequest => ({
  file,
  op: 'canvas.paste',
  targets: [],
  params: clip ? { clip } : {},
});

function fakeBridge(
  latest: Awaited<ReturnType<ClipBridge['latest']>>,
  take: ClipBridge['take'] = async () => ({
    id: 'c_00000000000000bb',
    kind: 'artboards',
    count: 1,
    from: 'ui/Pricing.tsx',
  })
) {
  const notes: ClipHandle[] = [];
  const takes: number[] = [];
  const bridge: ClipBridge = {
    note: (h) => {
      notes.push(h);
    },
    latest: async () => latest,
    take: async (seq) => {
      takes.push(seq);
      return take(seq);
    },
  };
  return { bridge, notes, takes };
}

const OTHER = {
  seq: 7,
  mine: false,
  kind: 'artboards' as const,
  count: 1,
  from: 'ui/Pricing.tsx',
  project: 'Acme site',
};

beforeEach(() => {
  _setHeldClip(null);
  _resetPasteIntent();
});

describe('clip_note — a copy tells the shell', () => {
  test('an ok copy notes its handle with the bridge; a refused one does not', () => {
    const { bridge, notes } = fakeBridge(null);
    const ok: EditOpResult = {
      ok: true,
      actionId: null,
      writeId: '',
      rev: '',
      refs: [],
      detail: { clip: HELD },
    };
    noteClipResult({ file: 'ui/Home.tsx', op: 'object.copy', targets: [] }, ok, bridge);
    noteClipResult(
      { file: 'ui/Home.tsx', op: 'object.copy', targets: [] },
      { ok: false, code: 'invalid', message: 'no' },
      bridge
    );
    expect(notes).toEqual([HELD]);
  });
});

describe('shapeClipPaste — which copy a paste takes', () => {
  test('no bridge (the browser): today’s shape, synchronously', () => {
    const shaped = shapeClipPaste(paste(), { bridge: null });
    expect(shaped).toEqual({
      kind: 'reply',
      result: { ok: false, code: 'invalid', message: NOTHING_TO_PASTE },
    });
  });

  test('a cloud tab never asks the shell: its words', () => {
    const { bridge } = fakeBridge(OTHER);
    const shaped = shapeClipPaste(paste(), { bridge, cloudTab: true });
    expect(shaped).toEqual({
      kind: 'reply',
      result: { ok: false, code: 'invalid', message: CELL_NO_CROSS_PROJECT },
    });
  });

  test('a non-paste op stays synchronous and is forwarded as is', () => {
    const { bridge } = fakeBridge(OTHER);
    const body: EditOpRequest = { file: 'ui/Home.tsx', op: 'object.copy', targets: [] };
    expect(shapeClipPaste(body, { bridge })).toEqual({ kind: 'forward', body });
  });

  test('the latest copy was this tab’s: the ordinary path with the shell’s own handle', async () => {
    _setHeldClip(HELD);
    const { bridge, takes } = fakeBridge({ ...OTHER, mine: true });
    const shaped = await shapeClipPaste(paste('ui/Home.tsx', 'c_ffffffffffffffff'), { bridge });
    expect(shaped).toEqual({ kind: 'forward', body: paste('ui/Home.tsx', HELD.id) });
    expect(takes).toEqual([]);
  });

  test('another project’s copy: the shell asks in its own words, and takes nothing yet', async () => {
    _setHeldClip(HELD);
    const now = 1_000_000;
    notePasteIntent(now);
    const { bridge, takes } = fakeBridge(OTHER);
    const shaped = await shapeClipPaste(paste('ui/Home.tsx', 'c_ffffffffffffffff'), {
      bridge,
      now,
    });
    expect(shaped.kind).toBe('confirm');
    if (shaped.kind !== 'confirm') return;
    expect(shaped.line).toBe('Paste the artboard copied in Pricing · Acme site?');
    expect(shaped.reply).toMatchObject({ ok: true, queued: true });
    // the canvas's handle is gone; nothing names one until Rust brought it
    expect(shaped.body.params?.clip).toBeUndefined();
    expect(takes).toEqual([]);
  });

  test('without a paste the shell saw (planted canvas code): refused in the canvas’s words, no ask', async () => {
    const { bridge, takes } = fakeBridge(OTHER);
    const shaped = await shapeClipPaste(paste(), { bridge, now: 5_000_000 });
    expect(shaped).toEqual({
      kind: 'reply',
      result: {
        ok: false,
        code: 'invalid',
        message: 'To paste the artboard copied in Pricing · Acme site, press ⌘V.',
      },
    });
    expect(takes).toEqual([]);
  });

  test('one intent answers one ask', async () => {
    const now = 2_000_000;
    notePasteIntent(now);
    const { bridge } = fakeBridge(OTHER);
    expect((await shapeClipPaste(paste(), { bridge, now })).kind).toBe('confirm');
    expect((await shapeClipPaste(paste(), { bridge, now })).kind).toBe('reply');
  });

  test('the shell could not answer: today’s path', async () => {
    _setHeldClip(HELD);
    const bridge: ClipBridge = {
      note: () => {},
      latest: async () => {
        throw new Error('no app');
      },
      take: async () => HELD,
    };
    expect(await shapeClipPaste(paste(), { bridge })).toEqual({
      kind: 'forward',
      body: paste('ui/Home.tsx', HELD.id),
    });
  });
});

describe('confirmedPasteBody — after Paste', () => {
  test('Rust carries the clip; the paste names the handle it brought', async () => {
    notePasteIntent(3_000_000);
    const { bridge, takes } = fakeBridge(OTHER);
    const shaped = await shapeClipPaste(paste(), { bridge, now: 3_000_000 });
    if (shaped.kind !== 'confirm') throw new Error(shaped.kind);
    const out = await confirmedPasteBody(shaped);
    expect(takes).toEqual([7]);
    expect(out).toEqual({ ok: true, body: paste('ui/Home.tsx', 'c_00000000000000bb') });
  });

  test('a refusal from the shell is said in its words; a malformed handle is refused', async () => {
    notePasteIntent(4_000_000);
    const gone = fakeBridge(OTHER, async () => {
      throw 'That copy is gone; copy it again.';
    });
    const s1 = await shapeClipPaste(paste(), { bridge: gone.bridge, now: 4_000_000 });
    if (s1.kind !== 'confirm') throw new Error(s1.kind);
    expect(await confirmedPasteBody(s1)).toEqual({
      ok: false,
      message: 'That copy is gone; copy it again.',
    });
    notePasteIntent(4_000_001);
    const odd = fakeBridge(OTHER, async () => ({
      id: '../x',
      kind: 'objects',
      count: 1,
      from: 'x',
    }));
    const s2 = await shapeClipPaste(paste(), { bridge: odd.bridge, now: 4_000_001 });
    if (s2.kind !== 'confirm') throw new Error(s2.kind);
    expect((await confirmedPasteBody(s2)).ok).toBe(false);
  });

  test('a same-project confirm needs no take', async () => {
    expect(
      await confirmedPasteBody({
        kind: 'confirm',
        body: paste('ui/About.tsx', HELD.id),
        line: '',
        reply: { ok: true, actionId: null, writeId: '', rev: '', refs: [], queued: true },
      })
    ).toEqual({ ok: true, body: paste('ui/About.tsx', HELD.id) });
  });
});

describe('tauriClipBridge', () => {
  test('null outside the app; the three caller-checked commands inside it', async () => {
    expect(tauriClipBridge({})).toBeNull();
    const calls: Array<[string, unknown]> = [];
    const win = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args: unknown) => {
            calls.push([cmd, args]);
            return cmd === 'clip_take' ? { handle: HELD } : null;
          },
        },
      },
    };
    const b = tauriClipBridge(win);
    if (!b) throw new Error('no bridge');
    await b.note(HELD);
    await b.latest();
    expect(await b.take(3)).toEqual(HELD);
    expect(calls).toEqual([
      ['clip_note', { id: HELD.id, kind: 'objects', count: 2, from: 'ui/Home.tsx' }],
      ['clip_latest', undefined],
      ['clip_take', { seq: 3 }],
    ]);
  });
});
