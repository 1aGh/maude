// V2-7.3 — the tour engine skips an `optional` step whose target is absent, but still shows any other step
// centred; a target list resolves to the first element that is actually on screen.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

import { TourOverlay } from '../client/tour/overlay.jsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mount(steps: unknown[], onComplete = () => {}, onClose = () => {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(h(TourOverlay, { steps, open: true, onComplete, onClose } as never));
  });
  return {
    host,
    title: () => host.querySelector('.mdcc-tour__title')?.textContent ?? '',
    counter: () => host.querySelector('.mdcc-tour__step')?.textContent ?? '',
    next: () => host.querySelector('.mdcc-tour__next') as HTMLButtonElement,
    back: () => host.querySelector<HTMLButtonElement>('.mdcc-tour__back'),
    unmount: () => act(async () => root.unmount()),
  };
}

// happy-dom has no layout: give an element a box the way the browser would.
function box(el: HTMLElement, w = 100, hgt = 30) {
  el.getBoundingClientRect = () =>
    ({
      top: 10,
      left: 10,
      right: 10 + w,
      bottom: 10 + hgt,
      width: w,
      height: hgt,
      x: 10,
      y: 10,
    }) as DOMRect;
  return el;
}

describe('TourOverlay optional steps', () => {
  test('an optional step with no target is skipped; the counter and Done follow', async () => {
    const present = box(document.body.appendChild(document.createElement('div')));
    present.setAttribute('data-testid', 'tour-present');
    let completed = 0;
    const t = await mount(
      [
        { target: "[data-testid='tour-present']", title: 'One', body: 'a' },
        { target: "[data-testid='tour-absent']", optional: true, title: 'Two', body: 'b' },
        { title: 'Three', body: 'c' },
      ],
      () => {
        completed += 1;
      }
    );
    expect(t.title()).toBe('One');
    expect(t.counter()).toBe('1 / 3');
    await act(async () => t.next().click());
    // the absent optional step is polled briefly, then stepped over
    await act(async () => {
      await wait(1500);
    });
    expect(t.title()).toBe('Three');
    expect(t.counter()).toBe('2 / 2');
    expect(t.next().textContent).toBe('Done');
    // Back lands on the previous showable step, not the skipped one
    await act(async () => t.back()?.click());
    expect(t.title()).toBe('One');
    await t.unmount();
    expect(completed).toBe(0);
    present.remove();
  });

  test('a step without optional and with no target still shows, centred', async () => {
    const t = await mount([
      { target: "[data-testid='tour-absent']", title: 'Missing', body: 'still here' },
      { title: 'Next', body: 'x' },
    ]);
    await act(async () => {
      await wait(500);
    });
    expect(t.title()).toBe('Missing');
    expect(t.host.querySelector('.mdcc-tour__scrim')).not.toBeNull();
    await t.unmount();
  });

  test('when the last steps are all skipped the tour finishes instead of dead-ending', async () => {
    const present = box(document.body.appendChild(document.createElement('div')));
    present.setAttribute('data-testid', 'tour-present');
    let completed = 0;
    let closed = 0;
    const t = await mount(
      [
        { target: "[data-testid='tour-present']", title: 'One', body: 'a' },
        { target: "[data-testid='tour-absent']", optional: true, title: 'Two', body: 'b' },
      ],
      () => {
        completed += 1;
      },
      () => {
        closed += 1;
      }
    );
    // Next goes to Two, which is found absent and skipped; nothing is left, so the tour completes
    await act(async () => t.next().click());
    await act(async () => {
      await wait(1500);
    });
    expect(completed).toBe(1);
    expect(closed).toBe(1);
    await t.unmount();
    present.remove();
  });

  test('a target list resolves to the first match that is on screen (a hidden element does not win)', async () => {
    const hidden = document.body.appendChild(document.createElement('div'));
    hidden.setAttribute('data-testid', 'tour-island'); // zero box: the folded island
    const icon = box(document.body.appendChild(document.createElement('div')));
    icon.setAttribute('data-testid', 'tour-icon');
    const t = await mount([
      { target: "[data-testid='tour-island'], [data-testid='tour-icon']", title: 'AI', body: 'x' },
    ]);
    await act(async () => {
      await wait(400);
    });
    expect(t.host.querySelector('.mdcc-tour__spot')).not.toBeNull();
    await t.unmount();
    hidden.remove();
    icon.remove();
  });
});
