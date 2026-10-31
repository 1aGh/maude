// p8-cell-copy (2) — the comment composer under the view-only gate. The V2-8.4 rig saw an OWNER of a
// project that still saves the old way press C, click the canvas, type and send — and only then read
// "read-only" (the studio refuses every comment write under the format gate, V2-1.12 §9 Q3, whoever the
// person is). Under a gate that refuses the write the comment control is OFF BEFORE typing, with the
// reason on it (the dead-controls rule: no reasonless disabled control). A role that may comment with no
// gate is untouched.
//
// The canvas reads `cg=1` once at boot (read-only-mode.ts), so this file boots with it set; the unpaused
// path is every other comment test in the suite (p8-c5-comments, gate-b-polish3, ...).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://x.test/?ro=1&cm=1&cg=1' });
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
import { canvasUrl } from '../client/canvas-url.js';
import { canCommentNow, frameAccessOn } from '../client/v2/access/access-client.js';
import { CommentComposer, CommentThread, type OverlayComment } from '../comments-overlay.tsx';
import { COMMENTS_PAUSED_REASON, commentsPausedCanvas } from '../read-only-mode.ts';
import { silentDisabled } from './_disabled-reasons.ts';

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
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;

const state = { selection: { selector: '' }, clientX: 10, clientY: 10 } as never;

describe('the frame is told comments are paused (client)', () => {
  const gated = (over: Record<string, unknown> = {}) => ({
    designRel: '.design',
    readOnly: true,
    readOnlyReason: 'format',
    formatGate: { projectFormat: 2, supported: 2, source: 'save-mode' },
    canComment: true,
    ...over,
  });
  const param = (cfg: unknown, name: string) =>
    new URL(canvasUrl('.design/ui/a.tsx', cfg), 'http://x').searchParams.get(name);

  test('a role that may comment, under a gate that refuses the write: cm=1 AND cg=1', () => {
    expect(frameAccessOn(gated(), 'ui/a.tsx')).toEqual({ ro: true, cm: true, cg: true });
    expect(param(gated(), 'cm')).toBe('1');
    expect(param(gated(), 'cg')).toBe('1');
  });

  test('no gate, or a role that may not comment: no cg (nothing is paused, nothing to explain)', () => {
    const ungated = gated({ formatGate: null, readOnlyReason: 'role' }); // Can comment viewer
    expect(frameAccessOn(ungated, 'ui/a.tsx')).toEqual({ ro: true, cm: true });
    expect(param(ungated, 'cg')).toBeNull();
    const observer = gated({ canComment: false }); // Can view: the tool is absent already
    expect(frameAccessOn(observer, 'ui/a.tsx')).toEqual({ ro: true, cm: false });
    expect(param(observer, 'cg')).toBeNull();
    expect(param({ designRel: '.design', readOnly: false }, 'cg')).toBeNull();
  });

  test('the Comments panel offers resolve / reopen / delete only where the write goes through', () => {
    expect(canCommentNow(gated())).toBe(false);
    expect(canCommentNow(gated({ formatGate: null, readOnlyReason: 'role' }))).toBe(true);
    expect(canCommentNow({ canComment: false })).toBe(false);
  });
});

describe('the canvas pauses the composer, and says why before anyone types', () => {
  test('cg=1 in the frame URL is read once at boot', () => {
    expect(commentsPausedCanvas()).toBe(true);
  });

  test('the field and the send are off, each with the reason, and the reason is on the card', () => {
    mount(<CommentComposer state={state} onSubmit={() => {}} onCancel={() => {}} />);
    const field = q<HTMLTextAreaElement>('.cm-composer__textarea');
    const send = q<HTMLButtonElement>('[data-testid="comment-composer-send"]');
    expect(field?.disabled).toBe(true);
    expect(field?.getAttribute('title')).toBe(COMMENTS_PAUSED_REASON);
    expect(send?.disabled).toBe(true);
    expect(send?.getAttribute('title')).toBe(COMMENTS_PAUSED_REASON);
    expect(q('[data-testid="comment-composer-paused"]')?.textContent).toBe(COMMENTS_PAUSED_REASON);
    // the dead-controls rule: nothing disabled without its reason
    expect(silentDisabled(document.body)).toEqual([]);
  });

  test('the reason is v2 voice: what is so, no blame, no "read-only" error after a send', () => {
    expect(COMMENTS_PAUSED_REASON).toBe('Comments are paused while this project is view only.');
    expect(COMMENTS_PAUSED_REASON).not.toMatch(/\b(we|I|oops)\b|error|fail/);
  });

  test('an open thread offers no reply, resolve or delete — the write would be refused', () => {
    const comment = {
      id: 'c1',
      file: '.design/ui/Pricing.tsx',
      selector: '',
      bounds: { x: 100, y: 100, w: 24, h: 24 },
      text: 'Yearly should be the default',
      status: 'open',
      created: new Date().toISOString(),
      resolved_at: null,
      author: 'Tereza',
      thread: [],
    } as unknown as OverlayComment;
    mount(
      <CommentThread
        comment={comment}
        onClose={() => {}}
        onPatch={() => {}}
        onDelete={() => {}}
        onReply={() => {}}
        mine
        me="Tereza"
      />
    );
    expect(q('[data-testid="comment-resolve-c1"]')).toBeNull();
    expect(q('[data-testid="comment-reopen-c1"]')).toBeNull();
    expect(q('.cm-thread__reply-form--field')).toBeNull();
    // ... and says why, once, where the reply would be
    expect(q('[data-testid="comment-paused-c1"]')?.textContent).toBe(COMMENTS_PAUSED_REASON);
  });
});
