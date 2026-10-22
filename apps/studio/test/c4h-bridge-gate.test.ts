// gate-b-c4h — the bridge half: the shell relays no write for a frame of a canvas that imports
// another canvas. The server cannot refuse these (the shell writes on the main origin with the
// viewer's own access), so ONE capture-phase window listener drops them before any bridge host sees
// them (client/v2/access/frame-write-gate.js). Fail closed: only READ_ONLY_FRAME_TYPES pass.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { c2sSpec } from '../bridge/dgn-protocol.ts';
import {
  _resetFrameWriteGate,
  canvasOfFrameSrc,
  installFrameWriteGate,
  READ_ONLY_FRAME_TYPES,
  refusesRelay,
  setImportingCanvases,
} from '../client/v2/access/frame-write-gate.js';

const MAP = { '.design/ui/imp-b.tsx': ['ui/canary-b-zx.tsx'] };
const SRC_A =
  'http://127.0.0.1:4401/_canvas-shell.html?canvas=ui%2Fimp-b.tsx&designRel=.design&ro=1';
const SRC_H =
  'http://127.0.0.1:4401/_canvas-shell.html?canvas=ui%2Fuses-helper.tsx&designRel=.design';

/** Every relay the shell turns into a write (use-canvas-bridge.jsx, comment-bridge.js, hosts). */
const WRITES = [
  'edit-op',
  'edit-text',
  'apply-edit',
  'undo-barrier',
  'undo-key',
  'reorder-request',
  'reorder-slot',
  'reorder-revert',
  'reposition-request',
  'resize-request',
  'insert-request',
  'insert-image-request',
  'insert-artboard-request',
  'delete-request',
  'duplicate-request',
  'delete-artboard-request',
  'duplicate-artboard-request',
  'rename-artboard-request',
  'resize-artboard-request',
  'set-artboard-kind-request',
  'replace-media-request',
  'convert-to-absolute-request',
  'replace-annotation-media-request',
  'edit-annotation-photo-request',
  'paste-style',
  'comment-op',
  'comment-submit',
  'comment-patch',
  'comment-delete',
  'comment-compose',
  'annotations-changed',
  'annotation-to-comment',
  'annotation-ask-ai',
  'ask-selection',
  'ask-selection-rect',
  'vote-cast',
  'vote-board',
  'export-request',
  'asset-relink-request',
  'size-place',
  'take-step',
  'annotation-prefs-set',
];

const fake = (src: string) => {
  const win = { name: src };
  return { frame: { contentWindow: win, getAttribute: () => src }, win };
};

describe('the allowlist', () => {
  test('names only real canvas→shell types', () => {
    for (const t of READ_ONLY_FRAME_TYPES)
      expect({ t, known: c2sSpec(t) !== null }).toEqual({ t, known: true });
  });
  test('holds none of the write relays (every one is a real type too)', () => {
    for (const t of WRITES) {
      expect({ t, known: c2sSpec(t) !== null }).toEqual({ t, known: true });
      expect({ t, passes: READ_ONLY_FRAME_TYPES.has(t) }).toEqual({ t, passes: false });
    }
  });
});

describe('refusesRelay', () => {
  const a = fake(SRC_A);
  const h = fake(SRC_H);
  const frames = [a.frame, h.frame];
  test('a write relay from the importing canvas’s frame is dropped', () => {
    for (const t of WRITES)
      expect({ t, drop: refusesRelay({ data: { dgn: t }, source: a.win }, frames, MAP) }).toEqual({
        t,
        drop: true,
      });
  });
  test('the same from a helper-only canvas, or a read-only type, passes', () => {
    expect(refusesRelay({ data: { dgn: 'edit-op' }, source: h.win }, frames, MAP)).toBe(false);
    expect(refusesRelay({ data: { dgn: 'select' }, source: a.win }, frames, MAP)).toBe(false);
    expect(refusesRelay({ data: { dgn: 'canvas-rendered' }, source: a.win }, frames, MAP)).toBe(
      false
    );
  });
  test('not a dgn message, or from no shell frame: not this gate’s call', () => {
    expect(refusesRelay({ data: 'x', source: a.win }, frames, MAP)).toBe(false);
    expect(refusesRelay({ data: { dgn: 'edit-op' }, source: {} }, frames, MAP)).toBe(false);
  });
  test('the frame is named by the shell-owned src, designRel included', () => {
    expect(canvasOfFrameSrc(SRC_A)).toBe('.design/ui/imp-b.tsx');
    expect(canvasOfFrameSrc('http://x/?canvas=ui%2Fa.tsx&designRel=%2Fdesign%2F')).toBe(
      'design/ui/a.tsx'
    );
    expect(canvasOfFrameSrc('http://x/')).toBeNull();
  });
});

describe('installed on the window', () => {
  afterEach(() => {
    _resetFrameWriteGate();
    for (const f of document.querySelectorAll('iframe')) f.remove();
  });
  test('runs before a bridge host’s listener and stops a write relay; a read relay reaches it', () => {
    const heard: string[] = [];
    // a host listener registered FIRST still loses to the capture-phase gate
    const host = (e: MessageEvent) => heard.push((e.data as { dgn: string }).dgn);
    window.addEventListener('message', host);
    installFrameWriteGate(window);
    setImportingCanvases(MAP);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', SRC_A);
    document.body.append(iframe);
    const source = iframe.contentWindow as unknown as Window;
    expect(source).toBeTruthy();
    for (const dgn of ['edit-op', 'select', 'comment-op'])
      window.dispatchEvent(new MessageEvent('message', { data: { dgn }, source }));
    window.removeEventListener('message', host);
    expect(heard).toEqual(['select']);
  });
});
