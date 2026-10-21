// comments-imported-from-mixed.test.ts — S8.17b: `importedFrom` (the Figma writer's label on a comment pin
// and on each reply) is ADDITIVE in the comments format (V2-1.12 R1/R3, no version bump):
//   v2 → v1 → v2  a Maude 1.9.1 reader + rewrite carries the key, on the root and in `thread[]`, byte for byte;
//   v1 → v2       a Maude 1 record has no such key, and a Maude 2 read invents none;
//   hostile       a record from a peer is re-clamped on read: the name is untrusted third-party text.
// And the field is a LABEL, not a person: no mention, no edit, not a door-writable claim.
//
// `V1_*` is a FROZEN copy of the v1.9.1 `backfillComment` + resolve write (as comments-anchors-mixed.test.ts).

import { describe, expect, test } from 'bun:test';

import {
  cleanImportedName,
  importedLabel,
  sanitizeImportedFrom,
  withSanitizedImportedFrom,
} from '../comments/imported-from.ts';
import { mentionsOf } from '../comments/mentions.ts';
import { applyCommentOp, type CommentRecord, parseCommentOp } from '../comments/ops.ts';
import { RLO, ZWSP } from './_hostile-names.ts';

// ---- frozen v1.9.1 ---------------------------------------------------------------------------
function V1_backfillComment(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    ...c,
    author: typeof c.author === 'string' ? c.author : '',
    thread: Array.isArray(c.thread) ? c.thread : [],
    mentions: Array.isArray(c.mentions) ? c.mentions : [],
  };
}
function V1_resolveAndSave(fileText: string, id: string): string {
  const list = (JSON.parse(fileText) as unknown[]).map(V1_backfillComment) as Array<
    Record<string, unknown>
  >;
  for (const c of list)
    if (c.id === id) Object.assign(c, { status: 'resolved', resolved_at: 'then' });
  return JSON.stringify(list, null, 2);
}
// ----------------------------------------------------------------------------------------------

const imported = (): CommentRecord => ({
  id: 'c_fig1',
  file: '.design/ui/Uniformy.tsx',
  selector: '',
  dom_path: [],
  tag: '',
  classes: '',
  bounds: null,
  html_excerpt: '',
  text: 'Logo je moc male, @michal',
  status: 'open',
  created: '2026-10-02T08:00:00.000Z',
  resolved_at: null,
  author: 'Michal',
  thread: [
    {
      id: 'r_fig1',
      author: 'Michal',
      body: 'Zvetsim, @tereza',
      created: '2026-10-02T09:30:00.000Z',
      importedFrom: {
        source: 'figma',
        author: { name: 'Tereza K' },
        at: '2026-10-02T09:30:00.000Z',
      },
    } as never,
  ],
  mentions: [],
  world: { x: 110, y: 120 },
  artboard: 'node-2-1',
  importedFrom: {
    source: 'figma',
    author: { name: 'Jonas Novak', handle: 'jonas.n' },
    at: '2026-10-02T08:00:00.000Z',
  },
});

describe('a Maude 1.9.1 peer carries the field through a read and a rewrite', () => {
  test('root and reply labels survive a v1 resolve + save untouched (v2 → v1 → v2)', () => {
    const before = JSON.stringify([imported()], null, 2);
    const after = JSON.parse(V1_resolveAndSave(before, 'c_fig1'))[0];
    expect(after.status).toBe('resolved');
    expect(after.importedFrom).toEqual(imported().importedFrom);
    expect(after.thread[0].importedFrom).toEqual(
      (imported().thread[0] as never as { importedFrom: unknown }).importedFrom
    );
    // and a Maude 2 read of what the v1 peer wrote still reads the label
    const read = withSanitizedImportedFrom(after);
    expect(importedLabel(read.importedFrom)).toBe('Jonas Novak · from Figma');
  });

  test('a v1 record has no such key and a Maude 2 read invents none (v1 → v2)', () => {
    const v1 = {
      id: 'c1',
      text: 'hi',
      author: 'Ana',
      thread: [{ id: 'r1', author: 'Bo', body: 'x' }],
    };
    const read = withSanitizedImportedFrom(v1);
    expect(read).toEqual(v1);
    expect('importedFrom' in read).toBe(false);
  });
});

describe('a record from a peer is re-clamped on read', () => {
  test('a hostile name is cleaned; a wrong source or a non-object is dropped, never guessed at', () => {
    const rec = {
      ...imported(),
      importedFrom: {
        source: 'figma',
        author: { name: `${RLO}evil${ZWSP}\n\tAdmin` },
        at: 'not a date',
      },
    };
    const read = withSanitizedImportedFrom(rec);
    expect(read.importedFrom).toEqual({ source: 'figma', author: { name: 'evil Admin' } });
    expect(
      withSanitizedImportedFrom({
        ...rec,
        importedFrom: { source: 'sketch', author: { name: 'x' } },
      })
    ).not.toHaveProperty('importedFrom');
    expect(withSanitizedImportedFrom({ ...rec, importedFrom: 'Jonas' })).not.toHaveProperty(
      'importedFrom'
    );
    const reply = withSanitizedImportedFrom({ ...rec, thread: [{ id: 'r', importedFrom: [1] }] });
    expect(reply.thread[0]).toEqual({ id: 'r' });
  });

  test('the name is bounded to 80 code points and the handle to a handle-shaped token', () => {
    expect(Array.from(cleanImportedName('é'.repeat(500))).length).toBe(80);
    const s = sanitizeImportedFrom({
      source: 'figma',
      author: { name: 'A', handle: '<script>alert(1)</script>' },
    });
    expect(s?.author).toEqual({ name: 'A' });
  });
});

describe('a label is not a person', () => {
  test('imported words mention nobody — the root and the imported reply', () => {
    expect(mentionsOf(imported() as never)).toEqual([]);
  });

  test('a project member replying to an imported thread mentions as usual', () => {
    const r = applyCommentOp(
      [imported()],
      { op: 'reply', id: 'c_fig1', body: 'ok @jonas' },
      {
        actor: { name: 'Lin' },
        now: '2026-10-21T10:00:00.000Z',
        newId: () => 'c_x',
        newReplyId: () => 'r_x',
      }
    );
    expect(r.ok && r.mentioned).toEqual(['@jonas']);
  });

  test('the importer cannot rewrite the Figma writer’s words, but can resolve and delete the pin', () => {
    const ctx = {
      actor: { name: 'Michal' },
      now: '2026-10-21T10:00:00.000Z',
      newId: () => 'c_x',
      newReplyId: () => 'r_x',
    };
    const edit = applyCommentOp(
      [imported()],
      { op: 'edit-own', id: 'c_fig1', text: 'changed' },
      ctx
    );
    expect(edit).toMatchObject({ ok: false, status: 403, code: 'not-yours' });
    expect(applyCommentOp([imported()], { op: 'resolve', id: 'c_fig1' }, ctx).ok).toBe(true);
    expect(applyCommentOp([imported()], { op: 'delete-own', id: 'c_fig1' }, ctx).ok).toBe(true);
  });

  test('the comment door never reads an importedFrom from an op body — nobody can sign as a Figma writer', () => {
    const op = parseCommentOp({
      op: 'add',
      file: '.design/ui/a.tsx',
      text: 'hello',
      importedFrom: { source: 'figma', author: { name: 'Jonas' } },
    });
    expect(op).not.toBeNull();
    const r = applyCommentOp([], op as never, {
      actor: { name: 'Mallory' },
      now: '2026-10-21T10:00:00.000Z',
      newId: () => 'c_new',
      newReplyId: () => 'r_new',
    });
    expect(r.ok && r.comment).toBeTruthy();
    expect(r.ok && r.comment && 'importedFrom' in r.comment).toBe(false);
  });
});
