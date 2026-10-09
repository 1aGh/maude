// V2-2.8 S6, client half — the in-canvas composer still suggests @names when
// the canvas origin's committer list carries no e-mail field.
//
// The server now answers the canvas origin with `{ name, commits }` rows only
// (committers-canvas-projection.test.ts). The composer's filter used to read
// `c.email.toLowerCase()` whenever a query did not match a name, which throws on
// an absent field and takes the whole thread down. This mounts the real thread
// (happy-dom), serves it the projected rows, and types two queries: one that
// matches a name and one that matches nothing.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const PROJECTED = [
  { name: 'Alice Example', commits: 12 },
  { name: 'Bob Builder', commits: 3 },
];

let realFetch: typeof fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/_api/git-committers')) return Response.json({ committers: PROJECTED });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentThread, type OverlayComment } from '../comments-overlay.tsx';

const comment = {
  id: 'c1',
  file: '.design/ui/Home.tsx',
  text: 'Spacing looks off',
  author: 'Alice Example',
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

type ReactProps = { onChange?: (e: unknown) => void; onFocus?: () => void };
function reactProps(el: Element): ReactProps {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
  return key ? (el as unknown as Record<string, ReactProps>)[key] : {};
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('mention suggestions from an e-mail-less committer list (V2-2.8 S6)', () => {
  test('a matching query lists the names; a non-matching one lists nothing and does not crash', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <CommentThread
          comment={comment}
          sequence={1}
          onClose={() => {}}
          onPatch={() => {}}
          onDelete={() => {}}
          onReply={async () => true}
          mine={false}
        />
      );
    });
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]');
    expect(field).not.toBeNull();
    if (!field) return;

    // First focus loads the committer list (once, cached).
    act(() => reactProps(field).onFocus?.());
    await settle();

    const type = (text: string) =>
      act(() => {
        field.value = text;
        field.setSelectionRange(text.length, text.length);
        reactProps(field).onChange?.({ target: field });
      });

    type('@ali');
    await settle();
    const names = () =>
      [...document.querySelectorAll('.cm-mention-popup__name')].map((n) => n.textContent);
    expect(names()).toEqual(['@alice']);
    // No e-mail line is rendered for a row that has none.
    expect(document.querySelector('.cm-mention-popup__email')).toBeNull();

    // A query that matches no NAME used to fall through to `c.email.toLowerCase()`.
    type('@zzz');
    await settle();
    expect(names()).toEqual([]);
    expect(document.querySelector('textarea[aria-label="Reply"]')).not.toBeNull();

    type('@');
    await settle();
    expect(names()).toEqual(['@alice', '@bob']);
  });
});
