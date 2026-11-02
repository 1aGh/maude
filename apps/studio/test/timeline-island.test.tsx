// S7.7 — the timeline island in the shell: summoned by the canvas's `artboard-anchor`, placed under the video,
// slid out again, kept open by ⇧⌘T, resized by Expand / Compact, and wired to the v1 flag `timelineOpen`
// (client/v2/timeline/TimelineHost.jsx). Plus the empty video artboard's words (05 · es-timeline).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { COPY } from '../client/v2/empty/empty-copy.js';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import { KeptStatus, SizeButton } from '../client/v2/timeline/island-controls.jsx';
import TimelineHost from '../client/v2/timeline/TimelineHost.jsx';
import {
  cutPrompt,
  footageHint,
  TimelineEmpty,
  timelineEmptyWords,
} from '../client/v2/timeline/timeline-empty.jsx';
import { timelineStore } from '../client/v2/timeline/timeline-store.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PATH = '.design/ui/video.tsx';
const rect = { x: 414, y: 80, w: 250, h: 444 };

// The shell store, reduced to what the host reads; `timelineOpen` is real state so the round trip is tested.
function Shell({
  win,
  probe,
  children,
}: {
  win: unknown;
  probe: { open: boolean; active: string | null; frames: number[]; setOpen?: (v: boolean) => void };
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  probe.open = open;
  probe.setOpen = setOpen;
  const store = {
    shellCore: {
      activeComps: [],
      activePath: PATH,
      cfg: { canvasOrigin: window.location.origin },
      iframesRef: {
        current: new Map([
          [PATH, { contentWindow: win, getBoundingClientRect: () => ({ left: 0, top: 0 }) }],
        ]),
      },
      postToActiveCanvas: () => {},
      setCanvasActiveArtboard: (id: string) => {
        probe.active = id;
      },
      setTimelineFrame: (f: number) => {
        probe.frames.push(f);
      },
      setTimelineOpen: setOpen,
      timelineFrame: 0,
      timelineOpen: open,
      viewerMode: false,
    },
  };
  return createElement(ShellStoreContext.Provider, { value: store }, children);
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  timelineStore.close();
  timelineStore.compact();
  timelineStore.reset();
});

async function mount(children: React.ReactNode = createElement('div', { 'data-testid': 'body' })) {
  const win = {} as Window;
  const probe = { open: false, active: null as string | null, frames: [] as number[] } as {
    open: boolean;
    active: string | null;
    frames: number[];
    setOpen?: (v: boolean) => void;
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(Shell, { win, probe }, createElement(TimelineHost, null, children)));
  });
  const send = async (data: Record<string, unknown>) => {
    const ev = new Event('message');
    Object.assign(ev, { data, origin: window.location.origin, source: win });
    await act(async () => {
      window.dispatchEvent(ev);
    });
  };
  const video = (id = 'reels', x = rect.x) =>
    send({
      dgn: 'artboard-anchor',
      artboardId: id,
      kind: 'video',
      label: 'Reels',
      rect: { ...rect, x },
    });
  const island = () =>
    document.querySelector('[data-testid="timeline-island"]') as HTMLElement | null;
  return { win, probe, send, video, island };
}

describe('summon, follow, slide back', () => {
  test('nothing selected: no island, and the v1 flag stays off', async () => {
    const { probe, island } = await mount();
    expect(island()).toBeNull();
    expect(probe.open).toBe(false);
  });

  test('a video anchor slides the island out under it, notch on its centre; the v1 flag follows', async () => {
    const { probe, video, island } = await mount();
    await video();
    const el = island();
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-size')).toBe('compact');
    expect(el?.getAttribute('data-artboard')).toBe('reels');
    expect(el?.querySelector('[data-testid="body"]')).not.toBeNull();
    // 1024 wide happy-dom window: 900 wide, centred on 539, clamped inside 16 px
    const left = Number.parseInt(el?.style.left ?? '', 10);
    const width = Number.parseInt(el?.style.width ?? '', 10);
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth - 16);
    const notch = document.querySelector('[data-testid="timeline-notch"]') as HTMLElement;
    expect(Number.parseInt(notch.style.left, 10) + left).toBe(539);
    expect(probe.open).toBe(true);
    expect(probe.active).toBe('reels');
  });

  test('it follows pan and zoom: the same video re-anchored moves the notch', async () => {
    const { video } = await mount();
    await video('reels', 414);
    const n0 = Number.parseInt(
      (document.querySelector('[data-testid="timeline-notch"]') as HTMLElement).style.left,
      10
    );
    await video('reels', 100);
    const n1 = Number.parseInt(
      (document.querySelector('[data-testid="timeline-notch"]') as HTMLElement).style.left,
      10
    );
    expect(n0).toBe(450);
    expect(n1).toBe(225 - 16); // the artboard's centre (225) less the island's clamped left (16)
  });

  test('anything else sends it back: it leaves, then the v1 flag goes off', async () => {
    const { probe, send, video, island } = await mount();
    await video();
    await send({
      dgn: 'artboard-anchor',
      artboardId: 'post',
      kind: 'digital',
      label: 'Post',
      rect,
    });
    expect(island()?.className).toContain('is-leaving');
    expect(island()?.getAttribute('data-occludes')).toBeNull();
    await act(async () => {
      await sleep(320);
    });
    expect(island()).toBeNull();
    expect(probe.open).toBe(false);
  });

  test('a frame that is not the active canvas cannot summon it', async () => {
    const { island } = await mount();
    const ev = new Event('message');
    Object.assign(ev, {
      data: { dgn: 'artboard-anchor', artboardId: 'r', kind: 'video', label: 'R', rect },
      origin: window.location.origin,
      source: {},
    });
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(island()).toBeNull();
  });
});

describe('⇧⌘T, Expand and the v1 openers', () => {
  test('kept open it stays when a page is selected, says so, and ⇧⌘T again hides it', async () => {
    const { send, video, island } = await mount(
      createElement('div', null, createElement(KeptStatus), createElement(SizeButton))
    );
    await video();
    await act(async () => timelineStore.toggleKeep());
    expect(document.querySelector('[data-testid="timeline-kept"]')?.textContent).toContain(
      'Kept open'
    );
    await send({
      dgn: 'artboard-anchor',
      artboardId: 'post',
      kind: 'digital',
      label: 'Post',
      rect,
    });
    await act(async () => {
      await sleep(320);
    });
    expect(island()).not.toBeNull();
    await act(async () => timelineStore.toggleKeep());
    await act(async () => {
      await sleep(320);
    });
    expect(island()).toBeNull();
  });

  test('Expand makes it edge to edge with no notch; Compact brings the notch back', async () => {
    const { video, island } = await mount(
      createElement('div', null, createElement(KeptStatus), createElement(SizeButton))
    );
    await video();
    const btn = () => document.querySelector('[data-testid="timeline-size"]') as HTMLElement;
    expect(btn().textContent).toContain('Expand');
    await act(async () => btn().click());
    expect(island()?.getAttribute('data-size')).toBe('full');
    expect(island()?.style.left).toBe('16px');
    expect(document.querySelector('[data-testid="timeline-notch"]')).toBeNull();
    expect(btn().textContent).toContain('Compact');
    await act(async () => btn().click());
    expect(island()?.getAttribute('data-size')).toBe('compact');
    expect(document.querySelector('[data-testid="timeline-notch"]')).not.toBeNull();
  });

  test('a v1 opener (the artboard menu / New video) keeps it open; the × (v1 closer) hides it', async () => {
    const { probe, island } = await mount();
    await act(async () => probe.setOpen?.(true));
    expect(island()).not.toBeNull();
    expect(timelineStore.state().keepOpen).toBe(true);
    await act(async () => probe.setOpen?.(false));
    await act(async () => {
      await sleep(320);
    });
    expect(island()).toBeNull();
    expect(timelineStore.state().keepOpen).toBe(false);
  });

  test('the island publishes its bottom inset once it has settled', async () => {
    const { video, island } = await mount();
    await video();
    expect(island()?.getAttribute('data-occludes')).toBeNull(); // still sliding in
    await act(async () => {
      await sleep(320);
    });
    expect(island()?.getAttribute('data-occludes')).toBe('bottom');
  });
});

describe('controls draw nothing without an island', () => {
  test('SizeButton and KeptStatus stand down when the panel is mounted on its own', () => {
    expect(renderToStaticMarkup(createElement(SizeButton))).toBe('');
    expect(renderToStaticMarkup(createElement(KeptStatus))).toBe('');
  });

  test('kept shows the pin line; compact shows Expand', () => {
    const value = { size: 'compact', kept: true, onToggleSize: () => {}, empty: null };
    const html = renderToStaticMarkup(
      createElement(
        TimelineIslandContext.Provider,
        { value },
        createElement(KeptStatus),
        createElement(SizeButton)
      )
    );
    expect(html).toContain('Kept open');
    expect(html).toContain('Expand');
  });
});

describe('the empty video artboard (05 · es-timeline)', () => {
  const rows = [
    { kind: 'video', path: 'assets/Combine 2026/a.mp4' },
    { kind: 'video', path: 'assets/Combine 2026/b.mp4' },
    { kind: 'video', path: 'assets/other/c.mp4' },
    { kind: 'image', path: 'assets/Combine 2026/p.png' },
  ];

  test('footage the project has: how many clips, and where most of them are', () => {
    expect(footageHint(rows)).toEqual({ count: 3, source: 'Combine 2026' });
    expect(footageHint([])).toEqual({ count: 0, source: 'this project' });
    expect(footageHint(null).count).toBe(0);
  });

  test('the words are the copy table’s, filled in, with the clip count named', () => {
    const w = timelineEmptyWords({ artboard: 'Reels · nábor 2027', rows });
    expect(w.title).toBe('No clips on Reels · nábor 2027 yet.');
    expect(w.next).toBe(
      'Drag footage here from Assets or Finder. 3 clips from Combine 2026 are ready in Assets.'
    );
    expect(w.action).toBe('Cut 15 s from those clips');
    expect(COPY['es-timeline.timeline-none'].action).toBe(w.action);
  });

  test('no footage in the project: no claim that clips are ready, and no chip’s worth of footage', () => {
    const w = timelineEmptyWords({ artboard: 'Reels', rows: [] });
    expect(w.next).toBe('Drag footage here from Assets or Finder.');
    expect(w.hint.count).toBe(0);
  });

  test('the empty comp keeps the timeline anatomy: ruler 0:00-0:30, one drop track, Captions and Music lanes', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineEmpty, { artboard: 'Reels', canAsk: false })
    );
    const ticks = [...html.matchAll(/<i>([^<]+)<\/i>/g)].map((m) => m[1]);
    expect(ticks).toEqual(['0:00', '0:05', '0:10', '0:15', '0:20', '0:25', '0:30']);
    expect(html).toContain('data-testid="timeline-empty-drop"');
    expect(html).toContain('No clips on Reels yet.');
    expect(html.match(/tl-kit-lane/g)?.length).toBe(2);
    expect(html).toMatch(/Captions/);
    expect(html).toMatch(/Music/);
    expect(html).not.toContain('timeline-empty-ask'); // no chip without the AI chat
  });

  test('the chip pre-fills a prompt that names the video and the folder', () => {
    expect(cutPrompt({ artboard: 'Reels', source: 'Combine 2026' })).toBe(
      'Cut 15 s for Reels from the clips in Combine 2026.'
    );
  });
});

describe('the moved panel keeps its surface', () => {
  const STUDIO = join(import.meta.dir, '..');
  const src = readFileSync(join(STUDIO, 'client/v2/timeline/Timeline.jsx'), 'utf8');
  test('every v1 testid is still produced by the moved file', () => {
    for (const id of [
      'timeline-panel',
      'timeline-playpause',
      'timeline-readout',
      'timeline-zoom',
      'timeline-track',
      'timeline-split',
      'timeline-empty',
      'timeline-resize-handle',
    ]) {
      expect(src).toContain(`data-testid="${id}"`);
    }
  });
  test('the island pieces are drawn from the context (the body knows no island)', () => {
    expect(src).toContain('useTimelineIsland');
    expect(src).toContain('<SizeButton />');
    expect(src).toContain('<KeptStatus />');
  });
});
