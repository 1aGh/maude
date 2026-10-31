// r2-p1-create · TD10 (Michal, UX audit F10): Image (I) opens a file picker at once — the shell's HTML file input, so a
// DOM e2e and an agent can drive it — and the picked picture is placed at the next click (or ↵: the middle of the
// view). It no longer switches the left panel to Assets. Generate stays one click away (its own slot panel). The F
// tooltip reads "Artboard / Frame (F)".

import { describe, expect, test } from 'bun:test';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { menuPaths } from '../actions/menu.ts';
import { ALL_CAPS, MODE_TOOLS, toolKeyAction } from '../bridge/canvas-modes.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import {
  createImagePick,
  IMAGE_INPUT_TESTID,
  NOT_A_PICTURE_LINE,
} from '../client/v2/shell/image-pick.js';
import { PANEL_HOSTS } from '../client/v2/shell/tool-panels.js';
import { createToolPanelLane } from '../client/v2/shell/use-tool-panels.js';
import { askForImageAt, imageRequestFrom } from '../editing/place-image.tsx';

const ORIGIN = 'http://canvas.test';
const activeWin = { name: 'active' } as unknown as Window;
const ev = (data: unknown, source: unknown, origin = ORIGIN) =>
  ({ data, source, origin }) as unknown as MessageEvent;

describe('the Image slot and the F tooltip', () => {
  const edit = MODE_TOOLS.edit.slots;
  test('F is "Artboard / Frame"', () => {
    expect(edit.find((s) => s.key === 'F')?.label).toBe('Artboard / Frame');
  });
  test('I asks the shell for the picture picker, not the Assets tab', () => {
    expect(edit.find((s) => s.key === 'I')?.panel).toBe('image');
    expect(toolKeyAction('edit', 'I', ALL_CAPS)).toEqual({ kind: 'panel', panel: 'image' });
  });
  test('Generate is a slot panel of its own, one click away', () => {
    expect(PANEL_HOSTS.image).toBe('picker');
    expect(PANEL_HOSTS.generate).toBe('command');
  });
});

describe('the shell lane: image → the picker, generate → Generate…, never the Assets tab', () => {
  function lane() {
    const calls: string[] = [];
    const l = createToolPanelLane({
      canvasOrigin: () => ORIGIN,
      activePath: () => 'a.tsx',
      frameOf: () => ({ contentWindow: activeWin }) as unknown as HTMLIFrameElement,
      viewport: () => ({ w: 1280, h: 900 }),
      openStickers: () => calls.push('stickers'),
      openAssets: () => calls.push('assets'),
      pickImage: (canvas: string) => calls.push(`pick:${canvas}`),
      openGenerate: () => calls.push('generate'),
      canEdit: () => true,
      deny: () => calls.push('deny'),
      hasFocus: () => true,
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })(),
    });
    return { l, calls };
  }
  test('image opens the picker for the active canvas', () => {
    const { l, calls } = lane();
    l.onMessage(ev({ dgn: 'tool-panel-open', panel: 'image', anchor: null }, activeWin));
    l.onMessage(ev({ dgn: 'tool-panel-open', panel: 'generate', anchor: null }, activeWin));
    expect(calls).toEqual(['pick:a.tsx', 'generate']);
  });
  test('a foreign window opens nothing', () => {
    const { l, calls } = lane();
    l.onMessage(ev({ dgn: 'tool-panel-open', panel: 'image', anchor: null }, {}));
    expect(calls).toEqual([]);
  });
});

describe('createImagePick: the picked file is uploaded and handed to the canvas to place', () => {
  const file = (name: string, type: string) => ({ name, type }) as unknown as File;
  test('a picture: upload, then place-image to the canvas it was asked for', async () => {
    const posted: Array<{ canvas: string; msg: unknown }> = [];
    const pick = createImagePick({
      upload: async (f: File) => ({ path: `assets/${f.name}` }),
      natural: async () => ({ w: 640, h: 480 }),
      post: (canvas: string, msg: unknown) => posted.push({ canvas, msg }),
      toast: () => {},
    });
    await pick.placeFiles('a.tsx', [file('cat.png', 'image/png')]);
    expect(posted).toEqual([
      {
        canvas: 'a.tsx',
        msg: {
          dgn: 'place-image',
          asset: 'assets/cat.png',
          natural: { w: 640, h: 480 },
          label: 'cat.png',
        },
      },
    ]);
  });
  test('not a picture: one line, nothing uploaded or posted', async () => {
    const lines: string[] = [];
    let uploads = 0;
    const pick = createImagePick({
      upload: async () => {
        uploads++;
        return { path: 'assets/x' };
      },
      natural: async () => null,
      post: () => {
        throw new Error('no post');
      },
      toast: (l: string) => lines.push(l),
    });
    await pick.placeFiles('a.tsx', [file('notes.txt', 'text/plain')]);
    expect(uploads).toBe(0);
    expect(lines).toEqual([NOT_A_PICTURE_LINE]);
  });
  test('the HTML input a DOM e2e drives has a stable testid', () => {
    expect(IMAGE_INPUT_TESTID).toBe('image-tool-input');
  });
});

describe('the canvas end: place-image is a parent-gated message; a click asks image.place at that point', () => {
  test('the bridge accepts it only from the parent', () => {
    const win = { parent: { p: 1 } } as unknown as Window;
    const msg = { dgn: 'place-image', asset: 'assets/cat.png', natural: { w: 64, h: 48 } };
    expect(acceptFromShell(ev(msg, win.parent), win)).toMatchObject({ asset: 'assets/cat.png' });
    expect(acceptFromShell(ev(msg, {}), win)).toBeNull();
  });
  test('a malformed request is ignored; a good one keeps its label', () => {
    expect(imageRequestFrom({ asset: 3 })).toBeNull();
    expect(imageRequestFrom({ asset: 'assets/cat.png', label: 'cat.png' })).toEqual({
      asset: 'assets/cat.png',
      natural: null,
      label: 'cat.png',
    });
  });
  test('the ask: loose on the artboard, at the point, the picture centred on it', () => {
    expect(
      askForImageAt(
        { asset: 'assets/cat.png', natural: { w: 100, h: 60 }, label: 'cat.png' },
        'desktop',
        { x: 300, y: 200 }
      )
    ).toEqual({
      op: 'image.place',
      targets: [],
      params: {
        asset: 'assets/cat.png',
        mode: 'loose',
        artboard: 'desktop',
        natural: { w: 100, h: 60 },
        at: { x: 250, y: 170 },
      },
    });
  });
});

describe('File › New artboard › with the size presets (TD10)', () => {
  test('every preset row lives under File › New artboard, not behind Edit › Advanced', () => {
    const paths = menuPaths(ACTIONS_BY_ID);
    for (const id of ['desktop', 'laptop', 'tablet', 'mobile', 'a4', 'letter', 'video']) {
      const at = paths.get(`artboard.new-${id}`) ?? [];
      expect(at.map((p) => p.path.split(' › ').slice(0, 3).join(' › '))).toEqual([
        'Menu › File › New artboard',
      ]);
      expect(at[0]?.advanced).toBe(false);
    }
  });
});
