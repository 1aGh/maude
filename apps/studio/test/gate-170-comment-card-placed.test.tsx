// #170 — a comment card (composer / thread) drew its first frame at the window's top-left, before the
// anchor loop measured and placed it. It now renders hidden until it is placed, and is placed before the
// first paint (a layout effect), so no frame shows it unplaced.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  const { act } = await import('react');
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentComposer, CommentThread, type OverlayComment } from '../comments-overlay.tsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
});
const mount = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(el));
};

const css = readFileSync(new URL('../client/comments-overlay.css', import.meta.url), 'utf8');

describe('a comment card is hidden until it is placed', () => {
  test('the stylesheet hides both cards until data-placed', () => {
    expect(css).toMatch(/\.cm-composer:not\(\[data-placed\]\)[^{]*\{[^}]*visibility:\s*hidden/s);
    expect(css).toMatch(/\.cm-thread:not\(\[data-placed\]\)[^{]*\{[^}]*visibility:\s*hidden/s);
  });

  test('the composer is placed (data-placed + left/top) as soon as it mounts', () => {
    mount(
      <CommentComposer
        state={{ selection: { selector: '' }, clientX: 10, clientY: 10 } as never}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    const card = document.querySelector('.cm-composer') as HTMLElement;
    expect(card.dataset.placed).toBe('1');
    expect(card.style.left).not.toBe('');
    expect(card.style.top).not.toBe('');
  });

  test('the thread is placed as soon as it mounts', () => {
    const comment = {
      id: 'c1',
      text: 'hello',
      status: 'open',
      created: new Date().toISOString(),
      author: 'Jonas',
      thread: [],
      selector: '',
      x: 20,
      y: 20,
    } as unknown as OverlayComment;
    mount(
      <CommentThread
        comment={comment}
        sequence={1}
        onClose={() => {}}
        onPatch={() => {}}
        onReply={async () => true}
        onDelete={() => {}}
      />
    );
    const card = document.querySelector('.cm-thread') as HTMLElement;
    expect(card.dataset.placed).toBe('1');
    expect(card.style.left).not.toBe('');
  });
});
