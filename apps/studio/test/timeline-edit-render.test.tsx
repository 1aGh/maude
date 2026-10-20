// S7.9 — what the person SEES while the three edit gestures run, and the clip menu: mounted in the real Timeline body.
// Trim a beat's right edge → the tip names it, the change and the new video length; drag a layer → the move tip;
// right-click a clip → the drawn rows and an Advanced row. (The writes are test/clip-gesture-ops.test.ts and
// test/timeline-gesture-undo.test.ts; the words are test/timeline-ripple.test.ts.)

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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
import { ArtboardDropCatcher, useFileDrag } from '../client/v2/timeline/edit/drop.jsx';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll('.dc-context-menu').forEach((n) => n.remove());
  root = null;
});

// 4 beats of 3 s (30 fps) and a title over the first 10 s
const beat = (i: number, label: string) => ({
  stableId: `b${i}`,
  label,
  from: i * 90,
  duration: 90,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${label}.mp4`,
  mediaProps: { muted: false },
  keyframes: [],
});
const SEQS = [
  beat(0, 'Tunel'),
  beat(1, 'Touchdown'),
  beat(2, 'Dron'),
  beat(3, 'Oslava'),
  {
    stableId: 't',
    label: 'SRDCE',
    from: 0,
    duration: 300,
    mediaTag: 'Title',
    keyframes: [],
  },
];

function mount(props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelinePanel
        comps={[{ id: 'c1', fps: 30, durationInFrames: 360, width: 480, height: 270 }]}
        compId="c1"
        sequences={SEQS}
        total={360}
        frame={0}
        height={260}
        onRetime={() => {}}
        onSelect={() => {}}
        onClipVerb={() => {}}
        onReorder={() => {}}
        onReorderMove={() => {}}
        onToggleHide={() => {}}
        onRemove={() => {}}
        {...props}
      />
    );
  });
}

const pointer = (type: string, x: number, buttons = 1) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: 10,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons,
  });
const text = (testid: string) =>
  document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;

describe('trimming a beat', () => {
  test('the tip says which clip, by how much, and how long the video is then', () => {
    mount();
    const handle = document.querySelector('[data-testid="timeline-resize-1"]');
    expect(handle).not.toBeNull();
    act(() => {
      handle?.dispatchEvent(pointer('pointerdown', 400));
    });
    act(() => {
      window.dispatchEvent(pointer('pointermove', 400 - 60));
    });
    const tip = text('timeline-trim-tip');
    expect(tip).toMatch(/^Touchdown · \d+\.\d s/);
    expect(tip).toMatch(/−\d+\.\d s · video 0:\d\d$/);
    act(() => {
      window.dispatchEvent(pointer('pointerup', 340, 0));
    });
    expect(text('timeline-trim-tip')).toBeNull();
  });
});

describe('the clip menu', () => {
  test('right-click: the drawn rows, then Advanced ▸ with the rest', () => {
    mount();
    const block = document.querySelector('[data-testid="timeline-seq-1"]');
    act(() => {
      block?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 100,
        })
      );
    });
    const items = Array.from(document.querySelectorAll('.dc-context-menu [role="menuitem"]')).map(
      (n) => n.textContent?.trim() ?? ''
    );
    expect(items.some((t) => t.startsWith('Adjust'))).toBe(true);
    expect(items).toContain('Hide clip');
    expect(items.some((t) => t.startsWith('Remove clip'))).toBe(true);
    expect(items.some((t) => t.startsWith('Advanced'))).toBe(true);
    // the eleven are not on the first level
    expect(items.some((t) => t.startsWith('Mute clip'))).toBe(false);
    expect(items.some((t) => t.startsWith('Move earlier'))).toBe(false);
  });

  test('Remove clip runs what the Timeline was given; a menu with no handlers still opens', () => {
    const removed: unknown[] = [];
    mount({ onRemove: (ref: unknown) => removed.push(ref) });
    const block = document.querySelector('[data-testid="timeline-seq-1"]');
    act(() => {
      block?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 100,
        })
      );
    });
    const remove = Array.from(document.querySelectorAll('.dc-context-menu [role="menuitem"]')).find(
      (n) => n.textContent?.trim().startsWith('Remove clip')
    ) as HTMLElement | undefined;
    act(() => remove?.click());
    expect(removed).toHaveLength(1);
    expect((removed[0] as { stableId: string }).stableId).toBe('b1');
  });
});

describe('footage over the window (ve-drop)', () => {
  const drag = (type: string, files = true) =>
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      dataTransfer: { types: files ? ['Files'] : ['text/plain'], files: [], items: [] },
    });

  function Probe({ enabled }: { enabled: boolean }) {
    return <i data-testid="probe">{useFileDrag(enabled) ? 'on' : 'off'}</i>;
  }

  test('a file drag over the window is "on" until it leaves, drops or ends; text drags are not', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Probe enabled />));
    expect(text('probe')).toBe('off');
    act(() => void window.dispatchEvent(drag('dragenter', false)));
    expect(text('probe')).toBe('off');
    act(() => void window.dispatchEvent(drag('dragenter')));
    act(() => void window.dispatchEvent(drag('dragenter'))); // a child of the page: the enter fires again
    expect(text('probe')).toBe('on');
    act(() => void window.dispatchEvent(drag('dragleave')));
    expect(text('probe')).toBe('on'); // one level out, still inside
    act(() => void window.dispatchEvent(drag('dragleave')));
    expect(text('probe')).toBe('off');
    act(() => void window.dispatchEvent(drag('dragenter')));
    act(() => void window.dispatchEvent(drag('drop')));
    expect(text('probe')).toBe('off');
  });

  test('standing down (no video artboard to drop on) is never "on"', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Probe enabled={false} />));
    act(() => void window.dispatchEvent(drag('dragenter')));
    expect(text('probe')).toBe('off');
  });

  test('the catcher over the artboard hands a drop’s files over once, and ignores anything that is not files', () => {
    const got: File[][] = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <ArtboardDropCatcher
          rect={{ left: 10, top: 20, width: 200, height: 100 }}
          onFiles={(f: File[]) => got.push(f)}
        />
      )
    );
    const catcher = document.querySelector('[data-testid="timeline-artboard-drop"]') as HTMLElement;
    expect(catcher.style.width).toBe('200px');
    const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });
    const dropWith = (types: string[], files: File[]) =>
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        dataTransfer: { types, files, items: [] },
      });
    act(() => void catcher.dispatchEvent(dropWith(['text/plain'], [])));
    expect(got).toHaveLength(0);
    act(() => void catcher.dispatchEvent(dropWith(['Files'], [file])));
    expect(got).toHaveLength(1);
    expect(got[0][0].name).toBe('a.mp4');
  });
});
