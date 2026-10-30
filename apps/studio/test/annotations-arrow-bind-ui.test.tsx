// S4.11 — an-arrow-bind (canvas 15 cell 5), an-rebind, an-dangling: aim an arrow at the thing you
// mean. The ring names it ("Button · See the work"); over an artboard's edge the whole artboard
// lights up; an element with no authored id is named first through `element.stamp` (Q12), and a
// busy file falls back to the artboard with "Bound to the artboard". Point to… re-aims a lost end.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { resolverFromRects } from '../annotations/hosts.ts';
import {
  type AimRects,
  asHostRects,
  attachHosts,
  BOUND_TO_ARTBOARD,
  bindEnd,
  bindNow,
  edgeBand,
  hostRefOf,
  kindWord,
  pickCandidate,
  type StampFn,
} from '../annotations/ui/arrow-bind.ts';
import {
  AimOverlay,
  ArrowLabelEditor,
  BoundTag,
  HostMarks,
  nearbyOutlines,
} from '../annotations/ui/arrow-cards.tsx';
import type { ArrowStroke } from '../annotations-model.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

const DESKTOP = { id: 'desktop', x: 500, y: 600, w: 1440, h: 900 };
const RECTS: AimRects = {
  artboards: [DESKTOP, { id: 'mobile', x: 2100, y: 600, w: 390, h: 844 }],
  elements: [
    // the page-sized wrapper is the artboard itself, not "an element"
    { cdId: 'page', artboard: 'desktop', x: 500, y: 600, w: 1440, h: 900, tag: 'div', text: '' },
    {
      cdId: 'hero',
      artboard: 'desktop',
      x: 540,
      y: 640,
      w: 700,
      h: 300,
      tag: 'div',
      text: 'Hello',
    },
    {
      cdId: 'see-the-work',
      artboard: 'desktop',
      x: 600,
      y: 700,
      w: 140,
      h: 44,
      index: 0,
      tag: 'button',
      text: 'See the work',
    },
    {
      cdId: 'a3f9c2b1',
      artboard: 'desktop',
      x: 800,
      y: 700,
      w: 120,
      h: 40,
      tag: 'a',
      text: 'Pricing',
    },
    {
      cdId: 'row',
      artboard: 'desktop',
      x: 600,
      y: 1000,
      w: 300,
      h: 20,
      index: 2,
      tag: 'p',
      text: 'Third row',
    },
  ],
};
const aim = (x: number, y: number) =>
  pickCandidate(RECTS, x, y, { band: 12, labelOf: (id) => (id === 'desktop' ? 'Desktop' : id) });

describe('what the pointer is over', () => {
  test('the button, not the page: the smallest element under the point, named', () => {
    const c = aim(650, 720);
    expect(c).toMatchObject({ kind: 'el', word: 'Button', text: 'See the work', stamped: true });
    expect(hostRefOf(c as never)).toBe('el:desktop/see-the-work');
  });

  test('inside a bigger element but off the button: that element', () => {
    expect(aim(560, 900)).toMatchObject({ kind: 'el', text: 'Hello', word: 'Element' });
  });

  test('over an artboard edge: the whole artboard lights up (edge light)', () => {
    const c = aim(496, 800);
    expect(c).toMatchObject({ kind: 'ab', edge: true, text: 'Desktop', word: 'Artboard' });
    expect(c?.box).toEqual({ x: 500, y: 600, w: 1440, h: 900 });
    expect(hostRefOf(c as never)).toBe('ab:desktop');
  });

  test('inside the edge band counts too (the end slides along the side)', () => {
    expect(aim(1000, 606)).toMatchObject({ kind: 'ab', edge: true });
  });

  test('the artboard body with no element, and empty canvas: nothing to point at', () => {
    expect(aim(1500, 1300)).toBeNull();
    expect(aim(0, 0)).toBeNull();
  });

  test('a computed (8-hex) id is "not stamped": it cannot be a durable reference yet', () => {
    expect(aim(820, 720)).toMatchObject({ kind: 'el', stamped: false, cdId: 'a3f9c2b1' });
  });

  test('the nth instance of a repeated element keeps its occurrence', () => {
    expect(hostRefOf(aim(700, 1010) as never)).toBe('el:desktop/row#2');
  });

  test('words: kind word by tag; the edge band grows as you zoom out', () => {
    expect(kindWord('a')).toBe('Link');
    expect(kindWord('h2')).toBe('Heading');
    expect(kindWord(undefined)).toBe('Element');
    expect(edgeBand(0.5)).toBe(24);
    expect(edgeBand(2)).toBe(6);
  });

  test('candidate outlines: the nearest things, never more than six', () => {
    const near = nearbyOutlines(RECTS, 650, 720, 400);
    expect(near.length).toBeLessThanOrEqual(6);
    expect(near.length).toBeGreaterThan(1);
  });
});

describe('binding the end (Q12: an unstamped target is stamped first)', () => {
  const ok =
    (element: string, occurrence?: number): StampFn =>
    async ({ artboard }) => ({
      ok: true,
      refs: [{ artboard, element, ...(occurrence ? { occurrence } : {}) }],
    });

  test('an authored id binds at once — no stamp call', async () => {
    let calls = 0;
    const c = aim(650, 720);
    if (!c) throw new Error('no candidate');
    const r = await bindEnd(c, async () => {
      calls++;
      return { ok: false, code: 'invalid', message: '' };
    });
    expect(calls).toBe(0);
    expect(r?.bind).toMatchObject({ ref: 'el:desktop/see-the-work', label: 'See the work' });
    expect(r?.bind.box).toEqual({ x: 600, y: 700, w: 140, h: 44 });
    expect(bindNow(c)).not.toBeNull();
  });

  test('an unstamped element is named through element.stamp, then bound to the id it got', async () => {
    const asked: unknown[] = [];
    const c = aim(820, 720);
    if (!c) throw new Error('no candidate');
    expect(bindNow(c)).toBeNull(); // needs the round trip
    const r = await bindEnd(c, async (t) => {
      asked.push(t);
      return ok('pricing-link')(t);
    });
    expect(asked).toEqual([{ artboard: 'desktop', element: 'a3f9c2b1' }]);
    expect(r?.bind.ref).toBe('el:desktop/pricing-link');
    expect(r?.fallback).toBeUndefined();
  });

  test('the file is busy (an AI run holds it): the bind falls back to the artboard, with the tag', async () => {
    const c = aim(820, 720);
    if (!c) throw new Error('no candidate');
    const r = await bindEnd(c, async () => ({
      ok: false,
      code: 'held-by-ai',
      message: "Pricing is AI's until it's done",
    }));
    expect(r?.bind.ref).toBe('ab:desktop');
    expect(r?.fallback).toBe('busy');
    expect(r?.tag).toBe(BOUND_TO_ARTBOARD);
    expect(BOUND_TO_ARTBOARD).toBe('Bound to the artboard');
  });

  test('stale: one retry with the fresh rev, then it binds', async () => {
    const c = aim(820, 720);
    if (!c) throw new Error('no candidate');
    let n = 0;
    const r = await bindEnd(c, async (t) => {
      n++;
      return n === 1 ? { ok: false, code: 'stale', message: 'moved' } : ok('pricing-link')(t);
    });
    expect(n).toBe(2);
    expect(r?.bind.ref).toBe('el:desktop/pricing-link');
  });

  test('Can comment (forbidden) or a refusal we do not know: the end stays free', async () => {
    const c = aim(820, 720);
    if (!c) throw new Error('no candidate');
    expect(
      await bindEnd(c, async () => ({ ok: false, code: 'forbidden', message: 'no' }))
    ).toBeNull();
  });

  test('a stamped answer that is still a computed id never becomes a reference', async () => {
    const c = aim(820, 720);
    if (!c) throw new Error('no candidate');
    const r = await bindEnd(c, ok('deadbeef'));
    expect(r?.bind.ref).toBe('ab:desktop');
  });

  test('an artboard edge binds at once, no stamp', async () => {
    const c = aim(496, 800);
    if (!c) throw new Error('no candidate');
    const r = await bindEnd(c, async () => {
      throw new Error('must not stamp an artboard');
    });
    expect(r?.bind).toMatchObject({ ref: 'ab:desktop', label: 'Desktop' });
  });
});

describe('the end lands where it meets the host', () => {
  const free: ArrowStroke = {
    id: 'a',
    tool: 'arrow',
    color: '#000',
    width: 2,
    x1: 100,
    y1: 720,
    x2: 650,
    y2: 722,
  };
  test('a bound end sits on the host box facing the other end; the stroke bind it replaces is dropped', () => {
    const c = aim(650, 720);
    const b = c ? bindNow(c) : null;
    if (!b) throw new Error('no bind');
    const a = attachHosts(
      { ...free, endBind: { hostId: 'x', nx: 0, ny: 0.5 } },
      { end: b.bind },
      resolverFromRects(asHostRects(RECTS))
    );
    expect(a.endHost?.ref).toBe('el:desktop/see-the-work');
    expect(a.endBind).toBeUndefined();
    // facing the start on the left → the button's left side
    expect([a.x2, a.y2]).toEqual([600, 722]);
    // the free start is untouched
    expect([a.x1, a.y1]).toEqual([100, 720]);
  });

  test('both ends bound face each other’s hosts, not each other’s old points', () => {
    const s = aim(496, 800);
    const e = aim(650, 720);
    const bs = s ? bindNow(s) : null;
    const be = e ? bindNow(e) : null;
    if (!bs || !be) throw new Error('no bind');
    const a = attachHosts(
      free,
      { start: bs.bind, end: be.bind },
      resolverFromRects(asHostRects(RECTS))
    );
    expect(a.startHost?.ref).toBe('ab:desktop');
    expect(a.endHost?.ref).toBe('el:desktop/see-the-work');
    expect(a.x1).toBeLessThan(a.x2);
  });
});

describe('the ring, the tag and the cards', () => {
  test('the ring names what it is on; the edge draws the whole artboard', async () => {
    const hot = aim(650, 720);
    const host = await mount(
      <AimOverlay aim={{ hot, near: nearbyOutlines(RECTS, 650, 720, 300) }} zoom={1} />
    );
    expect(host.querySelector('[data-testid="annot-arrow-aim-ring"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="annot-arrow-aim-tag"]')?.textContent).toBe(
      'Button · See the work'
    );
    expect(host.querySelectorAll('[data-testid="annot-arrow-candidate"]').length).toBeGreaterThan(
      0
    );

    const edge = aim(496, 800);
    const h2 = await mount(<AimOverlay aim={{ hot: edge, near: [] }} zoom={1} />);
    const light = h2.querySelector('[data-testid="annot-arrow-edge"]') as HTMLElement | null;
    expect(light).not.toBeNull();
    expect(light?.style.width).toBe(`${1440 + 6}px`);
  });

  test('over nothing there is no ring and no tag', async () => {
    const host = await mount(<AimOverlay aim={{ hot: null, near: [] }} zoom={1} />);
    expect(host.querySelector('[data-testid="annot-arrow-aim-ring"]')).toBeNull();
    expect(host.querySelector('[data-testid="annot-arrow-aim-tag"]')).toBeNull();
  });

  test('"Bound to the artboard" is announced politely', async () => {
    const host = await mount(<BoundTag text={BOUND_TO_ARTBOARD} at={[10, 10]} zoom={1} />);
    const tag = host.querySelector('[data-testid="annot-arrow-bound-tag"]');
    expect(tag?.textContent).toBe('Bound to the artboard');
    expect(tag?.getAttribute('role')).toBe('status');
  });

  test('a lost end: the open circle always, the card only for the selected arrow, Point to… acts', async () => {
    const picked: Array<[string, string]> = [];
    const d = {
      arrowId: 'arw',
      end: 'end' as const,
      name: 'Book a call',
      lead: 'Pointed at “Book a call” — moved to the trash',
      cause: 'element' as const,
      at: [670, 744] as [number, number],
    };
    const props = {
      zoom: 1,
      dangling: [d],
      rewritten: [],
      onPointTo: (a: string, e: string) => picked.push([a, e]),
      canEdit: true,
    };
    const idle = await mount(<HostMarks {...props} selectedId={null} />);
    expect(idle.querySelectorAll('[data-testid="annot-dangling-mark"]')).toHaveLength(1);
    expect(idle.querySelector('[data-testid="annot-dangling-card"]')).toBeNull();

    const sel = await mount(<HostMarks {...props} selectedId="arw" />);
    const card = sel.querySelector('[data-testid="annot-dangling-card"]');
    expect(card?.textContent).toContain('Pointed at “Book a call” — moved to the trash');
    await act(async () => {
      (sel.querySelector('[data-testid="annot-point-to"]') as HTMLElement).click();
    });
    expect(picked).toEqual([['arw', 'end']]);

    // A person who cannot edit sees why, but no button.
    const ro = await mount(<HostMarks {...props} selectedId="arw" canEdit={false} />);
    expect(ro.querySelector('[data-testid="annot-point-to"]')).toBeNull();
  });

  test('AI rewrote the element: the ring names the new words', async () => {
    const host = await mount(
      <HostMarks
        zoom={1}
        dangling={[]}
        selectedId="arw"
        rewritten={[
          {
            box: { x: 580, y: 690, w: 220, h: 64 },
            word: 'Button',
            text: 'See our work · rewritten by AI',
          },
        ]}
        onPointTo={() => {}}
        canEdit
      />
    );
    expect(host.querySelector('[data-testid="annot-arrow-rewritten"]')?.textContent).toBe(
      'Button · See our work · rewritten by AI'
    );
  });
});

describe('writing on the line (double-click an arrow)', () => {
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      input.value = value;
    });
  };
  const key = async (input: HTMLInputElement, k: string) => {
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      );
    });
  };

  test('Enter commits what was typed, once', async () => {
    const got: string[] = [];
    const host = await mount(
      <ArrowLabelEditor
        at={{ x: 5, y: 5 }}
        initial=""
        zoom={1}
        onCommit={(t) => got.push(t)}
        onCancel={() => got.push('CANCEL')}
      />
    );
    const input = host.querySelector('input') as HTMLInputElement;
    await type(input, 'swipe up');
    await key(input, 'Enter');
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(got).toEqual(['swipe up']);
  });

  test('Esc cancels and does not commit', async () => {
    const got: string[] = [];
    const host = await mount(
      <ArrowLabelEditor
        at={{ x: 5, y: 5 }}
        initial="old"
        zoom={1}
        onCommit={(t) => got.push(t)}
        onCancel={() => got.push('CANCEL')}
      />
    );
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('old');
    await key(input, 'Escape');
    expect(got).toEqual(['CANCEL']);
  });

  test('leaving the field saves what is there', async () => {
    const got: string[] = [];
    const host = await mount(
      <ArrowLabelEditor
        at={{ x: 5, y: 5 }}
        initial=""
        zoom={1}
        onCommit={(t) => got.push(t)}
        onCancel={() => {}}
      />
    );
    const input = host.querySelector('input') as HTMLInputElement;
    await type(input, 'then here');
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(got).toEqual(['then here']);
  });
});
