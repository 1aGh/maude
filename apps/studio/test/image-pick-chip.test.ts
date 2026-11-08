// #168 F1 — Image (I) is a canvas asking the shell for the platform's file dialog. A canvas decides when it asks, so
// it must not be able to throw the native dialog at the person: the shell first shows its OWN chip ("Choose a
// picture for <canvas>"), and only a click on that chip opens the dialog. Two cancelled dialogs in a row and the
// shell stops offering the chip for a while (the canvas that keeps asking is ignored); a placed picture resets it.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createImagePick, PICK_BACKOFF_MS } from '../client/v2/shell/image-pick.js';

type Chip = { id: string; title: string; action?: { label: string; onClick: () => void } };

function rig(picks: Array<Array<{ name: string }> | null>) {
  const chips: Chip[] = [];
  let dialogs = 0;
  let t = 1_000_000;
  const pick = createImagePick({
    post: () => true,
    upload: async (f: { name: string }) => ({ path: `assets/${f.name}` }),
    natural: async () => null,
    toast: () => {},
    notify: (c: Chip) => {
      chips.push(c);
      return c.id;
    },
    nameOf: (p: string) => (p.endsWith('home.tsx') ? 'Home' : p),
    now: () => t,
    isNative: () => true,
    pickNative: async () => {
      dialogs++;
      return picks.shift() ?? null;
    },
    nativeSource: (p: { name: string }) => ({ name: p.name, type: 'image/png' }),
  });
  return { pick, chips, dialogs: () => dialogs, tick: (ms: number) => (t += ms) };
}

describe('a canvas ask shows the shell’s chip, never the dialog', () => {
  test('the ask draws one chip naming the canvas; no dialog until the chip is clicked', async () => {
    const r = rig([[{ name: 'cat.png' }]]);
    expect(r.pick.ask('ui/home.tsx')).toBe(true);
    expect(r.dialogs()).toBe(0);
    expect(r.chips).toHaveLength(1);
    expect(r.chips[0]?.title).toBe('Choose a picture for Home');
    expect(r.chips[0]?.action?.label).toBe('Choose…');
    r.chips[0]?.action?.onClick();
    await new Promise((res) => setTimeout(res, 5));
    expect(r.dialogs()).toBe(1);
  });

  test('a repeat ask reuses the one chip id (it replaces, never stacks)', () => {
    const r = rig([]);
    r.pick.ask('ui/home.tsx');
    r.pick.ask('ui/home.tsx');
    expect(new Set(r.chips.map((c) => c.id)).size).toBe(1);
  });
});

describe('two cancels and the shell backs off', () => {
  const cancelVia = async (r: ReturnType<typeof rig>) => {
    r.pick.ask('ui/home.tsx');
    r.chips.at(-1)?.action?.onClick();
    await new Promise((res) => setTimeout(res, 5));
  };

  test('after two cancelled dialogs an ask shows nothing until the back-off is over', async () => {
    const r = rig([[], null]);
    await cancelVia(r);
    await cancelVia(r);
    const before = r.chips.length;
    expect(r.pick.ask('ui/home.tsx')).toBe(false);
    expect(r.chips.length).toBe(before);
    r.tick(PICK_BACKOFF_MS + 1);
    expect(r.pick.ask('ui/home.tsx')).toBe(true);
  });

  test('a picture placed in between resets the count', async () => {
    const r = rig([[], [{ name: 'cat.png' }], []]);
    await cancelVia(r);
    await cancelVia(r); // picked: resets
    await cancelVia(r); // one cancel only
    expect(r.pick.ask('ui/home.tsx')).toBe(true);
  });
});

describe('the lane wires the ask', () => {
  test('use-tool-panels hands a canvas ask to the chip, not to the dialog', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client/v2/shell/use-tool-panels.js'),
      'utf8'
    );
    expect(src).toContain('pickImage: (canvas) => void imagePick().ask(canvas)');
    expect(src).not.toContain('imagePick().open(canvas)');
  });
});
