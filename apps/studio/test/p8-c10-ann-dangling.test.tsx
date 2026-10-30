// P8 c10 ann - 15 an-dangling: the arrow keeps its end AND the trashed target keeps its place - a dashed outline
// where the host last was (the board's `.an-gone`: 1.5 px dashed, --fg-2), carried by the bind's last resolved box.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { danglingEnds } from '../annotations/hosts.ts';
import { danglingCard, HostMarks } from '../annotations/ui/arrow-cards.tsx';
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

const BOX = { x: 612, y: 130, w: 96, h: 32 };
const arrow = (withBox: boolean) =>
  ({
    id: 'arw',
    tool: 'arrow',
    x1: 700,
    y1: 300,
    x2: 660,
    y2: 170,
    endHost: { ref: 'el:desktop/book', label: 'Book a call', ...(withBox ? { box: BOX } : {}) },
  }) as unknown as ArrowStroke;

describe('15 an-dangling: the trashed target keeps a dashed outline', () => {
  test('a dangling end carries the bind box it last had (none stored = none drawn)', () => {
    const none = () => null;
    expect(danglingEnds([arrow(true)], none)[0].box).toEqual(BOX);
    expect(danglingEnds([arrow(false)], none)[0].box).toBeUndefined();
    const m = danglingCard(danglingEnds([arrow(true)], none)[0], {
      artboards: [{ id: 'desktop' }],
    } as never);
    expect(m.box).toEqual(BOX);
  });

  test('HostMarks outlines that place, once per lost end, from the world box', async () => {
    const d = {
      arrowId: 'arw',
      end: 'end' as const,
      name: 'Book a call',
      lead: 'Pointed at “Book a call” — moved to the trash',
      cause: 'element' as const,
      at: [660, 170] as [number, number],
      box: BOX,
    };
    const host = await mount(
      <HostMarks
        zoom={1}
        dangling={[d]}
        selectedId="arw"
        rewritten={[]}
        onPointTo={() => {}}
        canEdit
      />
    );
    const g = host.querySelector<HTMLElement>('[data-testid="annot-dangling-ghost"]');
    expect(g).not.toBeNull();
    expect(g?.style.left).toBe('612px');
    expect(g?.style.top).toBe('130px');
    expect(g?.style.width).toBe('96px');
    expect(g?.style.height).toBe('32px');
    // a lost end with no remembered box draws only its open circle
    const bare = await mount(
      <HostMarks
        zoom={1}
        dangling={[{ ...d, box: undefined }]}
        selectedId={null}
        rewritten={[]}
        onPointTo={() => {}}
        canEdit
      />
    );
    expect(bare.querySelector('[data-testid="annot-dangling-ghost"]')).toBeNull();
    expect(bare.querySelector('[data-testid="annot-dangling-mark"]')).not.toBeNull();
  });
});
