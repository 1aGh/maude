// #122-C hardening — a paste from ANOTHER project lands only on a paste the shell itself saw: a keydown in the
// shell document, or the shell's own menu / ⌘K row. A ⌘V the canvas frame relayed is the canvas's say, so it
// may unlock a paste between two canvases of this project, never one from another project. The toast's Paste
// button is inert for a moment after it appears (a lured click lands on nothing), and a synced target is named.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  _resetPasteIntent,
  _setHeldClip,
  type ClipBridge,
  CLIP_CONFIRM_ARM_MS,
  noteFramePasteIntent,
  notePasteIntent,
  shapeClipPaste,
} from '../client/clipboard-relay.ts';
import type { EditOpRequest } from '../edit-ops/types.ts';
import { dismissNotice, NoticeCard, noticeEntries, notify } from '../notifications.tsx';

const paste = (file = 'ui/Home.tsx'): EditOpRequest => ({
  file,
  op: 'canvas.paste',
  targets: [],
  params: {},
});
const OTHER = {
  seq: 7,
  mine: false,
  kind: 'artboards' as const,
  count: 1,
  from: 'ui/Pricing.tsx',
  project: 'Acme site',
};
const bridge: ClipBridge = {
  note: () => {},
  latest: async () => OTHER,
  take: async () => ({
    id: 'c_00000000000000bb',
    kind: 'artboards',
    count: 1,
    from: 'ui/Pricing.tsx',
  }),
};

beforeEach(() => {
  _setHeldClip(null);
  _resetPasteIntent();
});

describe('a cross-project paste needs a paste the shell saw', () => {
  test('a frame-relayed ⌘V never unlocks a paste from another project', async () => {
    const now = 1_000_000;
    noteFramePasteIntent(now);
    const shaped = await shapeClipPaste(paste(), { bridge, now });
    expect(shaped.kind).toBe('reply');
    if (shaped.kind === 'reply') expect(shaped.result.ok).toBe(false);
  });

  test('a frame-relayed ⌘V still unlocks a paste between two canvases of this project', async () => {
    _setHeldClip({ id: 'c_00000000000000aa', kind: 'objects', count: 1, from: 'ui/About.tsx' });
    const now = 2_000_000;
    noteFramePasteIntent(now);
    const shaped = await shapeClipPaste(paste('ui/Home.tsx'), { bridge: null, now });
    expect(shaped.kind).toBe('confirm');
  });

  test('the shell’s own paste unlocks it', async () => {
    const now = 3_000_000;
    notePasteIntent(now);
    const shaped = await shapeClipPaste(paste(), { bridge, now });
    expect(shaped.kind).toBe('confirm');
  });

  test('a synced target is named as one', async () => {
    const now = 4_000_000;
    notePasteIntent(now);
    const shaped = await shapeClipPaste(paste(), { bridge, now, synced: true, here: 'Beta' });
    expect(shaped.kind).toBe('confirm');
    if (shaped.kind === 'confirm')
      expect(shaped.line).toBe(
        'Paste the artboard copied in Pricing · Acme site into the synced project Beta?'
      );
  });

  test('the bridge notes a relayed ⌘V as the frame’s, never as the shell’s', () => {
    const src = readFileSync(
      join(import.meta.dir, '../client/hooks/use-canvas-bridge.jsx'),
      'utf8'
    );
    const at = src.indexOf("m.chord === '⌘V'");
    expect(at).toBeGreaterThan(0);
    const branch = src.slice(at, src.indexOf('return;', at));
    expect(branch).toContain('noteFramePasteIntent()');
    expect(branch).not.toMatch(/[^e]notePasteIntent\(/);
    // and the clip ask's Paste button arms after a moment
    const ask = src.slice(src.indexOf("id: 'canvas-clip-confirm'"));
    expect(ask.slice(0, 400)).toContain('armAfterMs: CLIP_CONFIRM_ARM_MS');
  });
});

describe('the toast’s Paste button is inert at first', () => {
  test('a click before the delay does nothing; after it, it pastes', async () => {
    expect(CLIP_CONFIRM_ARM_MS).toBeGreaterThanOrEqual(500);
    let clicks = 0;
    const id = notify({
      id: 'arm-test',
      title: 'Paste?',
      action: { label: 'Paste', onClick: () => clicks++, armAfterMs: 300 },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const entry = () => noticeEntries().find((e) => e.id === id);
    const draw = () => {
      const e = entry();
      if (e) root.render(<NoticeCard entry={e} />);
    };
    await act(async () => draw());
    const button = () => host.querySelector('.maude-notice-action') as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    await act(async () => button().click());
    expect(clicks).toBe(0);
    expect(entry()).toBeDefined(); // not acknowledged either
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    await act(async () => draw());
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    expect(clicks).toBe(1);
    await act(async () => root.unmount());
    dismissNotice(id);
  });
});
