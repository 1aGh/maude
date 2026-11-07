// #151 §5 (T2.3, D5) — "Re-attach to element": a comment op that moves a thread's anchor onto a
// new element. Judged by comments/ops.ts like every other op, so the studio's door and the hub's
// comment door agree; validated like `add` (same bounds), role gate unchanged (any session that may
// comment — the same rule as resolve / reopen, the door's `comment` capability decides).

import { describe, expect, test } from 'bun:test';

import {
  applyCommentOp,
  type CommentOp,
  type CommentRecord,
  type OpContext,
  parseCommentOp,
} from '../comments/ops.ts';

let seq = 0;
const ctx = (name: string, extra: Partial<OpContext['actor']> = {}): OpContext => ({
  actor: { name, ...extra },
  now: '2026-11-07T10:00:00.000Z',
  newId: () => `c_${(++seq).toString(16).padStart(12, '0')}`,
  newReplyId: () => `r_${(++seq).toString(16).padStart(12, '0')}`,
});

const parse = (raw: Record<string, unknown>): CommentOp => {
  const p = parseCommentOp(raw);
  if (!p) throw new Error(`not an op: ${JSON.stringify(raw)}`);
  return p;
};

function seeded(): CommentRecord[] {
  const r = applyCommentOp(
    [],
    parse({
      op: 'add',
      file: '.design/ui/home.tsx',
      text: 'this label is off',
      selector: '[data-dc-screen="a"]',
      tag: 'span',
      dom_path: [],
      bounds: { x: 10, y: 10, w: 20, h: 20 },
      world: { x: 5, y: 6 },
      artboard: 'a',
    }),
    ctx('Ana')
  );
  if (!r.ok) throw new Error(r.error);
  return r.list;
}

const NEW_ANCHOR = {
  selector: '[data-dc-screen="a"] > div:nth-child(2) > span:nth-child(1)',
  index: 0,
  dom_path: ['div', 'span'],
  tag: 'span',
  classes: 'lbl',
  bounds: { x: 100, y: 120, w: 40, h: 16 },
  html_excerpt: '<span class="lbl">Save</span>',
  world: { x: 140, y: 250 },
  artboard: 'a',
};

describe('the reattach op', () => {
  test('parses: a thread id plus an element anchor with a selector', () => {
    expect(parseCommentOp({ op: 'reattach', id: 'c_1', ...NEW_ANCHOR })).toMatchObject({
      op: 'reattach',
      id: 'c_1',
      selector: NEW_ANCHOR.selector,
    });
    // an element anchor needs a selector; an id needs the id shape
    expect(parseCommentOp({ op: 'reattach', id: 'c_1' })).toBeNull();
    expect(parseCommentOp({ op: 'reattach', id: 'c_1', selector: '' })).toBeNull();
    expect(parseCommentOp({ op: 'reattach', id: 'no spaces!', selector: 'x' })).toBeNull();
  });

  test('moves the thread onto the new element and keeps everything else', () => {
    const list = seeded();
    const id = (list[0] as CommentRecord).id;
    const r = applyCommentOp(list, parse({ op: 'reattach', id, ...NEW_ANCHOR }), ctx('Bo'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.comment as CommentRecord;
    expect(c.selector).toBe(NEW_ANCHOR.selector);
    expect(c.index).toBe(0);
    expect(c.dom_path).toEqual(['div', 'span']);
    expect(c.tag).toBe('span');
    expect(c.bounds).toEqual(NEW_ANCHOR.bounds);
    expect(c.world).toEqual({ x: 140, y: 250 });
    expect(c.artboard).toBe('a');
    // not the words, not the author, not the status, not the id
    expect(c.text).toBe('this label is off');
    expect(c.author).toBe('Ana');
    expect(c.status).toBe('open');
    expect(c.id).toBe(id);
    expect(r.mentioned).toEqual([]);
  });

  test('the new anchor replaces the old one: an index the new element lacks does not survive', () => {
    const list = seeded();
    (list[0] as CommentRecord).index = 3;
    const id = (list[0] as CommentRecord).id;
    const { index: _drop, ...noIndex } = NEW_ANCHOR;
    const r = applyCommentOp(list, parse({ op: 'reattach', id, ...noIndex }), ctx('Bo'));
    if (!r.ok) throw new Error(r.error);
    expect('index' in (r.comment as CommentRecord)).toBe(false);
  });

  test('is validated like add: oversized fields are cut to the same bounds, junk is dropped', () => {
    const list = seeded();
    const id = (list[0] as CommentRecord).id;
    const r = applyCommentOp(
      list,
      parse({
        op: 'reattach',
        id,
        selector: 's'.repeat(5000),
        tag: 't'.repeat(200),
        dom_path: ['a', 5, 'b'],
        bounds: { x: 'no' },
        world: { x: Number.NaN, y: 1 },
        artboard: '../escape',
      }),
      ctx('Bo')
    );
    if (!r.ok) throw new Error(r.error);
    const c = r.comment as CommentRecord;
    expect(c.selector.length).toBe(2000);
    expect(c.tag.length).toBe(64);
    expect(c.dom_path).toEqual(['a', 'b']);
    expect(c.bounds).toBeNull();
    // a bad world / artboard anchor is DROPPED, never guessed at (comments/anchors.ts)
    expect('world' in c).toBe(false);
    expect('artboard' in c).toBe(false);
  });

  test('a thread that is not there is not-found; it never creates one', () => {
    const r = applyCommentOp(
      seeded(),
      parse({ op: 'reattach', id: 'c_nope', ...NEW_ANCHOR }),
      ctx('Bo')
    );
    expect(r).toMatchObject({ ok: false, status: 404, code: 'not-found' });
  });

  test('the author is the session, not the body: authorship and the thread text are untouched', () => {
    const list = seeded();
    const id = (list[0] as CommentRecord).id;
    const r = applyCommentOp(
      list,
      parse({
        op: 'reattach',
        id,
        ...NEW_ANCHOR,
        author: 'Mallory',
        text: 'overwritten',
        status: 'resolved',
      }),
      ctx('Bo')
    );
    if (!r.ok) throw new Error(r.error);
    const c = r.comment as CommentRecord;
    expect(c.author).toBe('Ana');
    expect(c.text).toBe('this label is off');
    expect(c.status).toBe('open');
  });
});
