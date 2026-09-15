// Editing your own comment (plan T31, L11 "edit owned comment").
//
// The thread offered reply, resolve/reopen and delete, but no way to fix a
// typo in what you wrote. The author sees Edit; saving sends the new text
// through the same patch channel resolve uses. Someone else's comment has no
// Edit.

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

const comment = {
  id: 'c1',
  file: '.design/ui/Home.tsx',
  text: 'Tighten the heding spacing',
  author: 'Alice',
  status: 'open',
  created: new Date().toISOString(),
  thread: [],
} as unknown as OverlayComment;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function mount(mine: boolean, patches: Record<string, unknown>[]) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentThread
        comment={comment}
        sequence={1}
        onClose={() => {}}
        onPatch={(p) => patches.push(p)}
        onDelete={() => {}}
        onReply={async () => true}
        mine={mine}
      />
    );
  });
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;

describe('editing a comment', () => {
  test('the author edits the text in place and saves it as a patch', () => {
    const patches: Record<string, unknown>[] = [];
    mount(true, patches);
    const edit = button('Edit');
    expect(edit).not.toBeNull();
    act(() => edit?.click());
    const field = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit comment"]'
    );
    expect(field?.value).toBe('Tighten the heding spacing');
    act(() => {
      if (!field) return;
      // Typing, as the component receives it: its own change handler with the
      // new text (happy-dom's input events do not reach React's tracker).
      const propsKey = Object.keys(field).find((k) => k.startsWith('__reactProps'));
      const props = propsKey
        ? (field as unknown as Record<string, { onChange?: (e: unknown) => void }>)[propsKey]
        : undefined;
      field.value = 'Tighten the heading spacing';
      props?.onChange?.({ target: field, currentTarget: field });
    });
    act(() => button('Save')?.click());
    expect(patches).toEqual([{ text: 'Tighten the heading spacing' }]);
    expect(document.querySelector('textarea[aria-label="Edit comment"]')).toBeNull();
  });

  test("someone else's comment offers no Edit", () => {
    mount(false, []);
    expect(button('Edit')).toBeNull();
    expect(button('Delete')).not.toBeNull();
  });
});
