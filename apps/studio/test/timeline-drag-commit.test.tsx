// One drag, one write (plan T31, L15 timeline move).
//
// The timeline committed a clip move from INSIDE a state updater. React may
// run an updater more than once — StrictMode does it on purpose, which is how
// this test sees it — so one drag could write the clip's position twice. The
// release now reads the drag's live state and commits exactly once.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TimelinePanel from '../client/panels/TimelinePanel.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const overlay = {
  stableId: 'clip-title',
  label: 'Title',
  from: 0,
  duration: 90,
  mediaTag: 'Title',
  keyframes: [],
};

function mount(onRetime: (ref: unknown, patch: unknown) => void) {
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <StrictMode>
        <TimelinePanel
          comps={[{ id: 'c1', fps: 30, durationInFrames: 300, width: 480, height: 270 }]}
          compId="c1"
          sequences={[overlay]}
          total={300}
          frame={0}
          height={260}
          onRetime={onRetime}
          onSelect={() => {}}
        />
      </StrictMode>
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

describe('a timeline clip drag', () => {
  test('commits the move exactly once, even when React replays updaters', () => {
    const calls: unknown[] = [];
    mount((_ref, patch) => calls.push(patch));
    const block = document.querySelector('[data-testid="timeline-seq-0"]');
    expect(block).not.toBeNull();
    act(() => {
      block?.dispatchEvent(pointer('pointerdown', 100));
    });
    for (let i = 1; i <= 6; i++) {
      act(() => {
        window.dispatchEvent(pointer('pointermove', 100 + i * 40));
      });
    }
    act(() => {
      window.dispatchEvent(pointer('pointerup', 340, 0));
    });
    expect(calls.length).toBe(1);
    expect((calls[0] as { from?: number }).from).toBeGreaterThan(0);
  });
});
