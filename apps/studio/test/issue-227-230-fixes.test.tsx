// The four reports closed together (#227 · #228 · #229 · #230).
//   #227  a canvas with no artboards but with annotations on it is not "empty": no "Your canvas is ready." / Ask AI
//   #228  Report a bug sits in the bottom-left island; the "Maude window" capture has no ask-once sheet over it
//   #229  a thread opened from the Comments panel is brought into view (the camera goes to its pin)
//   #230  "Create folder" no longer waits 8 s for a slow project before the folder appears
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { acceptFromCanvas } from '../bridge/dgn-protocol.ts';
import { commentRevealTarget } from '../canvas-shell.tsx';
import { createEmptyLane, emptyCanvasModel } from '../client/v2/empty/use-empty-canvas.js';
import { ZoomUndo } from '../client/v2/undo/zoom-undo.jsx';
import { COMMENT_REVEAL_EVENT, type CommentRevealDetail } from '../comments/reveal.ts';
import { commentArtboard, requestCommentReveal } from '../comments-overlay.tsx';
import {
  annotationCount,
  onAnnotationCount,
  setAnnotationCount,
} from '../editing/annotation-count.ts';
import { createEmptyReporter } from '../editing/empty-report.ts';

const STUDIO = join(import.meta.dir, '..');
const src = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  setAnnotationCount(0);
});
async function mount(el: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el as never);
  });
}

describe('#227 — annotations on a canvas with no artboards', () => {
  const base = {
    count: 0,
    mode: 'edit',
    canEdit: true,
    online: true,
    claude: 'present',
    canAsk: true,
  };

  test('the empty canvas is not offered once the canvas says it holds annotations', () => {
    expect(emptyCanvasModel(base)).not.toBeNull();
    expect(emptyCanvasModel({ ...base, annotations: 0 })).not.toBeNull();
    expect(emptyCanvasModel({ ...base, annotations: null })).not.toBeNull(); // an older canvas: not told
    expect(emptyCanvasModel({ ...base, annotations: 1 })).toBeNull();
    expect(emptyCanvasModel({ ...base, annotations: 40 })).toBeNull();
  });

  test('the lane keeps the annotation count per canvas and forgets it with the load', () => {
    const ORIGIN = 'http://127.0.0.1:4400';
    const win = {} as Window;
    const l = createEmptyLane({
      canvasOrigin: () => ORIGIN,
      activePath: () => '.design/ui/Board.tsx',
      frameOf: () => ({ contentWindow: win }),
    });
    const msg = (data: Record<string, unknown>) =>
      ({ origin: ORIGIN, source: win, data }) as unknown as MessageEvent;
    l.onMessage(msg({ dgn: 'artboards', count: 0, annotations: 3 }));
    expect(l.get()).toMatchObject({ count: 0, annotations: 3 });
    l.onMessage(msg({ dgn: 'artboards', count: 0, annotations: 0 }));
    expect(l.get().annotations).toBe(0);
    l.onMessage(msg({ dgn: 'artboards', count: 0, annotations: 2 }));
    l.loadStarted('.design/ui/Board.tsx');
    expect(l.get()).toMatchObject({ count: null, annotations: null });
  });

  test('the protocol accepts the count with and without `annotations`, and refuses a non-number', () => {
    const ORIGIN = 'http://127.0.0.1:4400';
    const win = {} as Window;
    const ev = (data: Record<string, unknown>) =>
      ({ origin: ORIGIN, source: win, data }) as unknown as MessageEvent;
    const gate = { canvasOrigin: ORIGIN, active: win };
    expect(acceptFromCanvas(ev({ dgn: 'artboards', count: 0 }), gate)).toMatchObject({ count: 0 });
    expect(
      acceptFromCanvas(ev({ dgn: 'artboards', count: 0, annotations: 5 }), gate)
    ).toMatchObject({ count: 0, annotations: 5 });
    expect(acceptFromCanvas(ev({ dgn: 'artboards', count: 0, annotations: 'x' }), gate)).toBeNull();
  });

  test('the reporter sends the annotation count with the artboard count, again when it changes', () => {
    document.body.innerHTML = '';
    const posts: Array<Record<string, unknown>> = [];
    const frames: Array<() => void> = [];
    let n = 0;
    const r = createEmptyReporter({
      doc: document,
      selectedArtboard: () => null,
      annotations: () => n,
      post: (m) => posts.push(m as Record<string, unknown>),
      raf: (fn: () => void) => frames.push(fn),
    });
    r.request();
    frames.shift()?.();
    expect(posts).toEqual([{ dgn: 'artboards', count: 0, annotations: 0 }]);
    r.request();
    frames.shift()?.();
    expect(posts.length).toBe(1); // nothing changed, nothing said
    n = 2; // the first stickies
    r.request();
    frames.shift()?.();
    expect(posts[1]).toEqual({ dgn: 'artboards', count: 0, annotations: 2 });
  });

  test('the annotation layer’s count reaches whoever listens, once per change', () => {
    let calls = 0;
    const off = onAnnotationCount(() => {
      calls++;
    });
    setAnnotationCount(4);
    setAnnotationCount(4);
    expect(annotationCount()).toBe(4);
    expect(calls).toBe(1);
    off();
    setAnnotationCount(1);
    expect(calls).toBe(1);
    // the layer writes the board's own count (hidden with ⇧P or folded far out still counts)
    expect(src('annotations-layer.tsx')).toContain(
      'const annotationTotal = boardStrokes.length + uploading.length;'
    );
  });
});

describe('#228 — Report a bug, bottom left; a capture without the ask-once sheet', () => {
  test('the island ends in a Report a bug button in every form', async () => {
    const calls: string[] = [];
    for (const form of ['full', 'zoom-only']) {
      await mount(
        <ZoomUndo
          zoom={1}
          form={form}
          onUndo={() => {}}
          onRedo={() => {}}
          onFit={() => {}}
          onReportBug={() => calls.push(form)}
        />
      );
      const btn = host?.querySelector<HTMLButtonElement>('[data-testid="zoom-undo-report-bug"]');
      expect(btn?.getAttribute('aria-label')).toBe('Report a bug');
      expect(host?.querySelector('[data-testid="zoom-undo"]')?.lastElementChild).toBe(btn ?? null);
      act(() => btn?.click());
      act(() => root?.unmount());
      host?.remove();
    }
    expect(calls).toEqual(['full', 'zoom-only']);
  });

  test('without a handler the island is what it was', async () => {
    await mount(<ZoomUndo zoom={1} onUndo={() => {}} onRedo={() => {}} onFit={() => {}} />);
    expect(host?.querySelector('[data-testid="zoom-undo-report-bug"]')).toBeNull();
  });

  test('the shell wires the button to Help › Report a bug…', () => {
    expect(src('client/v2/preview/preview-chrome-host.jsx')).toContain(
      "onReportBug={() => menuRunner.run('help.report-bug')}"
    );
  });

  test('a shell capture marks its window, and the sync consent sheet stays down in it', () => {
    expect(src('bin/_capture-init.js')).toContain('window.__MAUDE_CAPTURE__ = true;');
    const sh = src('bin/screenshot.sh');
    expect(sh).toContain('open_extra=(--init-script "$(dirname "$0")/_capture-init.js")');
    expect(sh).toMatch(
      /\[ "\$MODE" = "shell" \] && \[ -f "\$\(dirname "\$0"\)\/_capture-init\.js" \]/
    );
    const dlg = src('client/panels/SyncConsentDialog.jsx');
    expect(dlg).toContain('window.__MAUDE_CAPTURE__ === true');
    expect(dlg).toContain('const due = !capture && !cloud &&');
  });
});

describe('#229 — a thread opened from the Comments panel is brought into view', () => {
  const view = { left: 0, top: 0, right: 1000, bottom: 800 };
  const vp = { x: 10, y: 20, zoom: 0.5 };

  test('a pin already in view (with room for its card) moves nothing', () => {
    expect(commentRevealTarget(view, { x: 400, y: 300, w: 24, h: 24 }, vp)).toBeNull();
  });

  test('a pin out of view is put in the middle of the view, zoom kept', () => {
    const t = commentRevealTarget(view, { x: 4988, y: -2012, w: 24, h: 24 }, vp);
    // pin centre (5000, -2000) → view centre (500, 400)
    expect(t).toEqual({ x: 10 - 4500, y: 20 + 2400, zoom: 0.5 });
  });

  test('a pin at the very edge has no room for its card: it is centred too', () => {
    const t = commentRevealTarget(view, { x: 970, y: 388, w: 24, h: 24 }, vp);
    expect(t).not.toBeNull();
    expect(t?.x).toBe(10 + (500 - 982));
    expect(t?.y).toBe(20);
  });

  test('the view box is the host minus what the shell covers', () => {
    const covered = { left: 300, top: 0, right: 1000, bottom: 800 };
    // inside the whole host, but under the left panel
    expect(commentRevealTarget(view, { x: 200, y: 388, w: 24, h: 24 }, vp)).toBeNull();
    expect(commentRevealTarget(covered, { x: 200, y: 388, w: 24, h: 24 }, vp)).toEqual({
      x: 10 + (650 - 212),
      y: 20,
      zoom: 0.5,
    });
  });

  test('the overlay asks for the comment’s place and names its artboard', () => {
    const seen: CommentRevealDetail[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<CommentRevealDetail>).detail);
    document.addEventListener(COMMENT_REVEAL_EVENT, on);
    const comment = {
      id: 'c1',
      created: '2026-11-14T10:00:00Z',
      status: 'open',
      body: 'x',
      author: 'I',
      selector: '[data-dc-screen="mobile-showcase"] [data-cd-id="hero"]',
      bounds: { x: 5, y: 6, w: 7, h: 8 },
    };
    requestCommentReveal(comment as never);
    document.removeEventListener(COMMENT_REVEAL_EVENT, on);
    expect(seen.length).toBe(1);
    expect(seen[0].artboard).toBe('mobile-showcase');
    // its element is not on this page: the last known place answers
    expect(seen[0].locate()).toEqual({ x: 5, y: 6, w: 7, h: 8 });
    expect(commentArtboard({ ...comment, artboard: 'own' } as never)).toBe('own');
    expect(commentArtboard({ ...comment, selector: undefined } as never)).toBeNull();
  });

  test('a focus from the shell asks for the reveal; the canvas answers through the camera', () => {
    const overlay = src('comments-overlay.tsx');
    expect(overlay).toContain('revealWantRef.current = id;');
    expect(overlay).toMatch(
      /useEffect\(\(\) => \{\s*revealWanted\(\);\s*\}, \[comments, revealWanted\]\);/
    );
    const shell = src('canvas-shell.tsx');
    expect(shell).toContain('document.addEventListener(COMMENT_REVEAL_EVENT, onReveal);');
    expect(shell).toContain('if (next) zoomController.animateTo(next, 220);');
  });
});

describe('#230 — Create folder does not wait out a slow project', () => {
  test('dir.create waits a moment, not 8 s; delete and move keep the long wait', () => {
    const sync = src('sync/index.ts');
    const ms = Number(sync.match(/const FOLDER_CREATE_WAIT_MS = ([\d_]+);/)?.[1].replace(/_/g, ''));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(2000);
    expect(sync).toContain('acceptedLink.dirCreate(op.path, FOLDER_CREATE_WAIT_MS)');
    expect(sync).toContain('acceptedLink.dirDelete(op.path)');
    expect(sync).toContain('acceptedLink.dirMove(op.from, op.to)');
  });
});
