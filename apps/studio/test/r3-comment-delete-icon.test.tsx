// R3 (7) — "Delete comment" was a text button wedged on a line of its own under Edit / Resolve. It is a trash icon
// in the SAME row as Edit / Resolve / ×, with an aria-label and a tooltip; one press arms it, a second deletes
// (a comment and its replies cannot be brought back, and an icon is easy to hit by accident).
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
import { CommentThread, type OverlayComment } from '../comments-overlay.tsx';

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const plain = (): OverlayComment =>
  ({
    id: 'c_2',
    file: '.design/ui/Site.tsx',
    text: 'Photo is small',
    author: 'Michal',
    created: new Date().toISOString(),
    status: 'open',
    thread: [],
  }) as unknown as OverlayComment;

async function render(mine = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <CommentThread
        comment={plain()}
        sequence={1}
        onClose={() => calls.push('close')}
        onPatch={() => {}}
        onDelete={() => calls.push('delete')}
        onReply={async () => true}
        mine={mine}
        me="Michal"
      />
    );
  });
  return { host, calls };
}
const click = (el: Element | null) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });

describe('the comment card: Delete comment is an icon in the action row', () => {
  test('a trash icon button sits in the same row as Edit and Resolve; no text button is left', async () => {
    const { host } = await render();
    const del = host.querySelector<HTMLElement>('[data-testid="comment-delete-c_2"]');
    expect(del).not.toBeNull();
    expect(del?.getAttribute('aria-label')).toBe('Delete comment');
    expect(del?.getAttribute('title')).toBe('Delete comment');
    expect(del?.textContent?.trim()).toBe(''); // an icon, not words
    expect(del?.querySelector('svg')).not.toBeNull();
    // same row: Edit, Resolve and the trash share one actions container, one line
    const row = del?.closest('.cm-thread__actions');
    expect(row).not.toBeNull();
    expect(row?.querySelector('[data-testid="comment-edit"]')).not.toBeNull();
    expect(row?.querySelector('[data-testid="comment-resolve-c_2"]')).not.toBeNull();
    expect(row?.closest('.cm-thread__head-end')?.querySelector('.cm-thread__close')).not.toBeNull();
    // the old red text button is gone
    expect(host.textContent).not.toContain('Delete comment');
    expect(host.querySelector('.cm-btn--danger:not(.cm-btn--trash)')).toBeNull();
  });

  test('one press only asks; the second deletes and closes the card', async () => {
    const { host, calls } = await render();
    const del = () => host.querySelector<HTMLElement>('[data-testid="comment-delete-c_2"]');
    await click(del());
    expect(calls).toEqual([]);
    expect(del()?.getAttribute('data-armed')).toBe('true');
    expect(del()?.getAttribute('aria-label')).toBe('Confirm delete comment');
    expect(del()?.getAttribute('title')).toBe('Press again to delete');
    await click(del());
    expect(calls).toEqual(['delete', 'close']);
  });

  test('a double-click only asks — its second click never deletes, and the armed icon is still the trash', async () => {
    // r3 security delta (low): the second click of one double-click landed on the armed button and deleted
    const { host, calls } = await render();
    const del = () => host.querySelector<HTMLElement>('[data-testid="comment-delete-c_2"]');
    const glyph = () => del()?.querySelector('path')?.getAttribute('d');
    const trash = glyph();
    await act(async () => {
      del()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
      del()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 2 }));
    });
    expect(calls).toEqual([]);
    expect(del()?.getAttribute('data-armed')).toBe('true');
    expect(glyph()).toBe(trash); // never the Resolve check beside it
    await click(del());
    expect(calls).toEqual(['delete', 'close']);
  });

  test('blur, or Esc, puts it back: nothing is deleted', async () => {
    const { host, calls } = await render();
    const del = () => host.querySelector<HTMLElement>('[data-testid="comment-delete-c_2"]');
    await click(del());
    await act(async () => {
      del()?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(del()?.getAttribute('data-armed')).toBeNull();
    await click(del());
    await act(async () => {
      del()?.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    });
    expect(del()?.getAttribute('data-armed')).toBeNull();
    expect(calls).toEqual([]);
  });

  test('only the author sees it', async () => {
    const { host } = await render(false);
    expect(host.querySelector('[data-testid="comment-delete-c_2"]')).toBeNull();
  });
});
