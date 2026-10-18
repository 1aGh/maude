// comments-ops.test.ts — S9.7: the comment ops, the mention parser/resolver and the comments
// schema (`comments/{ops,mentions}.ts`, `schema/comments.v2.schema.json`).
//
// The door-level half (a viewer desktop's comment through the hub, `maude.mention` delivery) is
// apps/hub/test/comments-door.test.mjs; this file pins the rules both doors share.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { compileSchema } from '../../../cli/lib/json-schema-lite.mjs';
import {
  addedMentions,
  handlesOf,
  mentionsOf,
  parseMentions,
  resolveMentions,
} from '../comments/mentions.ts';
import {
  applyCommentOp,
  type CommentOp,
  type CommentRecord,
  type OpContext,
  parseCommentOp,
} from '../comments/ops.ts';

const SCHEMA = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'schema', 'comments.v2.schema.json'), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const ajvValid = ajv.compile(SCHEMA);
const liteValid = compileSchema(SCHEMA);
const valid = (list: unknown) => ({
  ajv: ajvValid(list) === true,
  lite: liteValid(list).length === 0,
});

let seq = 0;
const ctx = (name: string, extra: Partial<OpContext['actor']> = {}): OpContext => ({
  actor: { name, ...extra },
  now: '2026-10-18T10:00:00.000Z',
  newId: () => `c_${(++seq).toString(16).padStart(12, '0')}`,
  newReplyId: () => `r_${(++seq).toString(16).padStart(12, '0')}`,
});

const op = (raw: Record<string, unknown>): CommentOp => {
  const parsed = parseCommentOp(raw);
  if (!parsed) throw new Error(`not an op: ${JSON.stringify(raw)}`);
  return parsed;
};

function added(list: CommentRecord[], by: OpContext, raw: Record<string, unknown> = {}) {
  const r = applyCommentOp(
    list,
    op({ op: 'add', file: '.design/ui/home.tsx', text: 'hello', ...raw }),
    by
  );
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('ops — the author is the session, never the body', () => {
  test('a forged author / authorId / authorKind in an add is ignored', () => {
    const r = added([], ctx('Vera', { id: 'h:vera' }), {
      author: 'Olga',
      authorId: 'h:olga',
      authorKind: 'ai',
      text: 'Logo is late @max',
    });
    expect(r.comment).toMatchObject({ author: 'Vera', authorId: 'h:vera', mentions: ['@max'] });
    expect(r.comment && 'authorKind' in r.comment).toBe(false);
    expect(r.mentioned).toEqual(['@max']);
    expect(valid(r.list)).toEqual({ ajv: true, lite: true });
  });

  test('a forged author in a reply is ignored too', () => {
    const base = added([], ctx('Olga', { id: 'h:olga' })).list;
    const id = base[0]?.id as string;
    const r = applyCommentOp(
      base,
      op({ op: 'reply', id, body: 'on it', author: 'Olga', authorId: 'h:olga' }),
      ctx('Vera', { id: 'h:vera' })
    );
    expect(r.ok && r.comment?.thread.at(-1)).toMatchObject({
      author: 'Vera',
      authorId: 'h:vera',
      body: 'on it',
    });
  });
});

describe('ops — someone else’s thread: reply, resolve, reopen; nothing else', () => {
  const olga = ctx('Olga', { id: 'h:olga' });
  const vera = ctx('Vera', { id: 'h:vera' });
  const base = () => added([], olga, { text: 'first' }).list;

  test.each(['reply', 'resolve', 'reopen'])('%s on another’s comment → applied', (name) => {
    const list = base();
    const r = applyCommentOp(list, op({ op: name, id: list[0]?.id, body: 'ok' }), vera);
    expect(r.ok).toBe(true);
  });

  test.each(['edit-own', 'delete-own'])('%s on another’s comment → 403 not-yours', (name) => {
    const list = base();
    const r = applyCommentOp(list, op({ op: name, id: list[0]?.id, text: 'mine now' }), vera);
    expect(r).toMatchObject({ ok: false, status: 403, code: 'not-yours' });
  });

  test('the stamped id decides: the same NAME with another id is not the author', () => {
    const list = base();
    const r = applyCommentOp(
      list,
      op({ op: 'delete-own', id: list[0]?.id }),
      ctx('Olga', { id: 'h:other-olga' })
    );
    expect(r).toMatchObject({ ok: false, code: 'not-yours' });
  });

  test('a desktop record (no id) is the author’s by name', () => {
    const list = added([], ctx('Olga')).list;
    expect(
      applyCommentOp(list, op({ op: 'delete-own', id: list[0]?.id }), ctx('Olga'))
    ).toMatchObject({
      ok: true,
      list: [],
    });
    expect(
      applyCommentOp(list, op({ op: 'delete-own', id: list[0]?.id }), ctx('Vera'))
    ).toMatchObject({
      ok: false,
      code: 'not-yours',
    });
  });

  test('resolve then reopen; an unknown id is 404', () => {
    const list = base();
    const id = list[0]?.id as string;
    const resolved = applyCommentOp(list, op({ op: 'resolve', id }), vera);
    expect(resolved.ok && resolved.comment).toMatchObject({
      status: 'resolved',
      resolved_at: olga.now,
    });
    const reopened = resolved.ok
      ? applyCommentOp(resolved.list, op({ op: 'reopen', id }), vera)
      : null;
    expect(reopened?.ok && reopened.comment).toMatchObject({ status: 'open', resolved_at: null });
    expect(applyCommentOp(list, op({ op: 'resolve', id: 'c_nope' }), vera)).toMatchObject({
      status: 404,
    });
  });

  test('id-total: every duplicated copy is resolved (#112)', () => {
    const one = base();
    const twice = [...one, { ...(one[0] as CommentRecord) }];
    const r = applyCommentOp(twice, op({ op: 'resolve', id: one[0]?.id }), vera);
    expect(r.ok && r.list.map((c) => c.status)).toEqual(['resolved', 'resolved']);
  });
});

describe('ops — what an op newly mentions', () => {
  test('a reply reports only the tokens it added; resolve reports none', () => {
    const list = added([], ctx('Olga'), { text: 'hi @max' }).list;
    const id = list[0]?.id as string;
    const r = applyCommentOp(list, op({ op: 'reply', id, body: '@max @ada see' }), ctx('Vera'));
    expect(r.ok && r.mentioned).toEqual(['@ada']);
    expect(r.ok && r.comment?.mentions).toEqual(['@max', '@ada']);
    const res = applyCommentOp(list, op({ op: 'resolve', id }), ctx('Vera'));
    expect(res.ok && res.mentioned).toEqual([]);
  });

  test('AI-written text never mentions (C3)', () => {
    const r = added([], ctx('Claude', { kind: 'ai' }), { text: 'Contrast fails here @max' });
    expect(r.comment).toMatchObject({ author: 'Claude', authorKind: 'ai', mentions: [] });
    expect(r.mentioned).toEqual([]);
    const id = r.comment?.id as string;
    const reply = applyCommentOp(
      r.list,
      op({ op: 'reply', id, body: 'ping @ada' }),
      ctx('Claude', { kind: 'ai' })
    );
    expect(reply.ok && reply.mentioned).toEqual([]);
    expect(reply.ok && reply.comment?.mentions).toEqual([]);
    expect(valid(reply.ok ? reply.list : null)).toEqual({ ajv: true, lite: true });
  });
});

describe('parseCommentOp', () => {
  test.each([
    [{}],
    [{ op: 'nuke', id: 'c_1' }],
    [{ op: 'add', file: '', text: 'x' }],
    [{ op: 'add', file: 'a.tsx', text: '   ' }],
    [{ op: 'reply', id: 'c_1' }],
    [{ op: 'resolve', id: '../c' }],
    [{ op: 'edit-own', id: 'c_1', text: '' }],
  ])('refuses %j', (raw) => {
    expect(parseCommentOp(raw)).toBeNull();
  });

  test('bounds text at 4000 and garbage bounds at null', () => {
    const r = added([], ctx('Olga'), { text: 'x'.repeat(5000), bounds: { x: 'a' } });
    expect(r.comment?.text.length).toBe(4000);
    expect(r.comment?.bounds).toBeNull();
  });

  test('a `from` in the op body is never read (S4-S9 §3.1: it would sign as anyone)', () => {
    const forged = { kind: 'sticky', id: 's_1', author: 'Olga', convertedBy: 'Olga', at: 'x' };
    const r = added([], ctx('Vera'), { from: forged, text: 'hi @max' });
    expect(r.comment && 'from' in r.comment).toBe(false);
    expect(r.mentioned).toEqual(['@max']);
  });
});

describe('a converted comment (`from`, S4-S9-votes-comments §3.1)', () => {
  const sticky = {
    kind: 'sticky',
    id: 's_ab12',
    author: 'Jonas',
    convertedBy: 'Somebody Else',
    at: '2026-10-18T09:00:00.000Z',
    spot: { x: 10, y: 20, artboard: 'hero' },
    extra: 'dropped',
  };
  const conv = (): OpContext => ({ ...ctx('Tereza', { id: 'h:tereza' }), from: sticky });

  test('author = the converter, no exception; the sticky’s author only in from.author', () => {
    const r = added([], conv(), { text: 'Datum je malé @max', author: 'Jonas' });
    expect(r.comment).toMatchObject({
      author: 'Tereza',
      authorId: 'h:tereza',
      from: {
        kind: 'sticky',
        id: 's_ab12',
        author: 'Jonas',
        convertedBy: 'Tereza',
        at: sticky.at,
        spot: { x: 10, y: 20, artboard: 'hero' },
      },
    });
    expect(r.comment?.from && 'extra' in (r.comment.from as object)).toBe(false);
    expect(valid(r.list)).toEqual({ ajv: true, lite: true });
  });

  test('a `from` root mentions nobody; its replies mention as usual', () => {
    const r = added([], conv(), { text: 'Datum je malé @max' });
    expect(r.mentioned).toEqual([]);
    expect(r.comment?.mentions).toEqual([]);
    const reply = applyCommentOp(
      r.list,
      op({ op: 'reply', id: r.comment?.id, body: '@max ok' }),
      ctx('Vera')
    );
    expect(reply.ok && reply.mentioned).toEqual(['@max']);
  });

  test('a malformed trusted `from` is dropped, never guessed', () => {
    for (const bad of [
      { kind: 'Sticky!', id: 's_1', author: 'J' },
      { kind: 'sticky', id: '../x', author: 'J' },
    ]) {
      const r = added([], { ...ctx('Tereza'), from: bad });
      expect(r.comment && 'from' in r.comment).toBe(false);
    }
  });
});

describe('mentions — parsed on the server; unknown and no-access answer the same', () => {
  const people = [
    { id: 'max@x.test', name: 'Max Novak' },
    { id: 'ada@x.test', name: 'Ada Lovelace' },
    { id: 'jonas-mac', name: 'Jonas' },
  ];

  test('parse: deduped, literal; a thread’s union skips AI parts', () => {
    expect(parseMentions('@ada @lin @ada.')).toEqual(['@ada', '@lin', '@ada.']);
    expect(
      mentionsOf({ text: '@ada', thread: [{ body: '@max' }, { body: '@lin', authorKind: 'ai' }] })
    ).toEqual(['@ada', '@max']);
    expect(addedMentions(['@ada'], ['@Ada.', '@max'])).toEqual(['@max']);
  });

  test('a token reaches a person with access by first name or address', () => {
    expect(handlesOf(people[0] as (typeof people)[number])).toEqual(['max']);
    expect(resolveMentions(['@max', '@Ada.', '@jonas'], people).map((p) => p.id)).toEqual([
      'max@x.test',
      'ada@x.test',
      'jonas-mac',
    ]);
  });

  test('unknown, no-access and self resolve to the same nothing', () => {
    const withAccess = people.filter((p) => p.id !== 'ada@x.test');
    const unknown = resolveMentions(['@zed'], withAccess);
    const noAccess = resolveMentions(['@ada'], withAccess);
    expect(noAccess).toEqual(unknown);
    expect(unknown).toEqual([]);
    expect(resolveMentions(['@max'], people, { exclude: 'max@x.test' })).toEqual([]);
  });
});

describe('the comments schema', () => {
  test('planted faults fail under both validators', () => {
    const good = added([], ctx('Olga')).list;
    for (const bad of [
      [{ ...good[0], status: 'deleted' }],
      [{ ...good[0], mm: { x: 1 } }],
      [{ ...good[0], authorKind: 'robot' }],
      [{ ...good[0], text: '' }],
      [{ id: 'c_1', file: 'a.tsx', status: 'open' }],
    ]) {
      expect(valid(bad)).toEqual({ ajv: false, lite: false });
    }
    // open for later top-level keys (V2-1.12 R1)
    expect(valid([{ ...good[0], zz: 1 }])).toEqual({ ajv: true, lite: true });
  });
});
