// S9.22 — the Comments panel's rules (client/v2/comments/comments-model.js), the mention-unread rules
// (mention-model.js) and the shell half of the overlay's messages (comment-bridge.js, comment-client.js).

import { describe, expect, test } from 'bun:test';
import { canvasRel, handleCommentBridgeMessage } from '../client/v2/comments/comment-bridge.js';
import { fetchMentionPeople, postCommentOp } from '../client/v2/comments/comment-client.js';
import {
  asFilter,
  commentMarks,
  commentTime,
  countsOf,
  DEFAULT_FILTER,
  FILTERS,
  groupThreads,
  isMine,
  onLabel,
} from '../client/v2/comments/comments-model.js';
import {
  markThreadRead,
  mentionCallout,
  mentionKey,
  mentionsPerson,
  newMentions,
  unreadMentions,
  unreadThreadCount,
} from '../client/v2/comments/mention-model.js';

const NOW = Date.parse('2026-10-18T14:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const H = 3600_000;

const A = '.design/ui/a.tsx';
const B = '.design/ui/b.tsx';
const byFile = {
  [A]: [
    {
      id: 'c1',
      file: A,
      text: 'Datum je moc male',
      status: 'open',
      created: iso(2 * H),
      author: 'Jonas',
      artboard: 'a4',
      thread: [{ id: 'r1', author: 'Tereza', body: 'Zvetsim', created: iso(1 * H) }],
      selector: 'x',
    },
    {
      id: 'c2',
      file: A,
      text: 'Logo vys',
      status: 'resolved',
      created: iso(30 * H),
      author: 'Lin Park',
      thread: [],
    },
    {
      id: 'c3',
      file: A,
      text: 'Moje poznamka',
      status: 'open',
      created: iso(5 * H),
      author: 'Michal',
      thread: [],
    },
  ],
  [B]: [
    {
      id: 'c4',
      file: B,
      text: 'Logo naskoci brzo',
      status: 'open',
      created: iso(26 * H),
      author: 'Petra',
      artboard: 'reel',
      t: 12,
      thread: [],
    },
    {
      id: 'c5',
      file: B,
      text: 'Moje 2',
      status: 'resolved',
      created: iso(60 * H),
      author: 'Michal',
      thread: [],
    },
  ],
};

describe('filters', () => {
  test('four filters in the contract order, Open the default', () => {
    expect(FILTERS).toEqual(['open', 'mine', 'resolved', 'all']);
    expect(DEFAULT_FILTER).toBe('open');
    expect(asFilter('mine')).toBe('mine');
    expect(asFilter('bogus')).toBe('open');
    expect(asFilter(undefined)).toBe('open');
  });

  test('counts: open, mine (any status, threads you started), resolved, all', () => {
    expect(countsOf(byFile, 'Michal')).toEqual({ open: 3, mine: 2, resolved: 2, all: 5 });
    expect(countsOf(byFile, null)).toEqual({ open: 3, mine: 0, resolved: 2, all: 5 });
  });

  test('isMine: the stamped id decides when both have one; otherwise the name', () => {
    expect(isMine({ author: 'Michal' }, 'Michal')).toBe(true);
    expect(isMine({ author: 'Michal', authorId: 'u1' }, { name: 'Michal', id: 'u2' })).toBe(false);
    expect(isMine({ author: 'Other', authorId: 'u1' }, { name: 'Michal', id: 'u1' })).toBe(true);
    expect(isMine({ author: 'Michal' }, null)).toBe(false);
  });

  test('grouped by canvas: the open canvas first, newest thread first, empty groups gone', () => {
    const open = groupThreads(byFile, 'open', { me: 'Michal', activePath: B, now: NOW });
    expect(open.map((g) => g.file)).toEqual([B, A]);
    expect(open[1].threads.map((t: { id: string }) => t.id)).toEqual(['c1', 'c3']); // c1 replied 1 h ago
    const resolved = groupThreads(byFile, 'resolved', { me: 'Michal', now: NOW });
    expect(resolved.flatMap((g) => g.threads.map((t: { id: string }) => t.id)).sort()).toEqual([
      'c2',
      'c5',
    ]);
    const mine = groupThreads(byFile, 'mine', { me: 'Michal', now: NOW });
    expect(mine.flatMap((g) => g.threads.map((t: { id: string }) => t.id)).sort()).toEqual([
      'c3',
      'c5',
    ]);
    expect(groupThreads({}, 'all', { now: NOW })).toEqual([]);
  });

  test('a row carries its reply count, resolved/mine flags and a relative time of the LAST activity', () => {
    const g = groupThreads(byFile, 'all', { me: 'Michal', activePath: A, now: NOW })[0];
    const c1 = g.threads.find((t: { id: string }) => t.id === 'c1');
    expect(c1).toMatchObject({ replies: 1, resolved: false, mine: false, time: '1 h ago' });
    expect(g.threads.find((t: { id: string }) => t.id === 'c2')).toMatchObject({ resolved: true });
  });
});

describe('words', () => {
  test('times: relative first, "yesterday", then 24-hour absolute (CONTRACT §4)', () => {
    expect(commentTime(iso(20_000), NOW)).toBe('just now');
    expect(commentTime(iso(2 * 60_000), NOW)).toBe('2 min ago');
    expect(commentTime(iso(2 * H), NOW)).toBe('2 h ago');
    expect(commentTime('2026-10-17T09:30:00', NOW)).toBe('yesterday');
    expect(commentTime('2026-10-06T14:05:00', NOW)).toBe('6 Oct, 14:05');
    expect(commentTime('nonsense', NOW)).toBe('');
  });

  test('the `on` line: the artboard name, then "at 0:12" for a video moment', () => {
    const label = (_f: string, id: string) => (id === 'reel' ? 'Reels · nabor' : id);
    expect(onLabel(byFile[B][0], { artboardLabel: label, canvasLabel: 'b' })).toBe(
      'Reels · nabor · at 0:12'
    );
    expect(onLabel(byFile[A][2], { canvasLabel: 'a' })).toBe('a');
    expect(onLabel(byFile[A][0], {})).toBe('a4');
  });
});

describe('timeline flags (S7-slices §2: commentsAt)', () => {
  test('earliest first, frame from fps, only threads with a moment on that artboard', () => {
    const list = [
      { id: 'x1', artboard: 'reel', t: 21, author: 'Jonas', status: 'open' },
      { id: 'x2', artboard: 'reel', t: 12, author: 'Tereza', status: 'resolved' },
      { id: 'x3', artboard: 'other', t: 3 },
      { id: 'x4', artboard: 'reel' },
    ];
    expect(commentMarks(list, { id: 'reel', fps: 30 })).toEqual([
      { threadId: 'x2', frame: 360, t: 12, author: 'Tereza', resolved: true },
      { threadId: 'x1', frame: 630, t: 21, author: 'Jonas', resolved: false },
    ]);
    expect(commentMarks(list, { id: 'reel', fps: 24 })[0].frame).toBe(288);
    expect(commentMarks(list, null)).toEqual([]);
  });
});

describe('mentions: who mentioned me, and have I looked', () => {
  const data = {
    [A]: [
      {
        id: 'c1',
        text: 'Mrkni prosim na datum @michal',
        author: 'Jonas',
        created: iso(3 * H),
        thread: [],
      },
      {
        id: 'c2',
        text: 'bez zminky',
        author: 'Jonas',
        created: iso(4 * H),
        thread: [{ id: 'r9', author: 'Tereza', body: 'diky @Michal.', created: iso(1 * H) }],
      },
      {
        id: 'c3',
        text: 'ja pisu @michal sam sobe',
        author: 'Michal Dovrtel',
        created: iso(2 * H),
        thread: [],
      },
      {
        id: 'c4',
        text: 'AI se zminuje @michal',
        author: 'AI',
        authorKind: 'ai',
        created: iso(2 * H),
        thread: [],
      },
      {
        id: 'c5',
        text: 'staré lidske slova',
        author: 'Jonas',
        from: { kind: 'sticky', id: 's1', author: 'Jonas', convertedBy: 'Jonas', at: iso(H) },
        created: iso(H),
        thread: [],
      },
      { id: 'c6', text: '@michalek jiny clovek', author: 'Jonas', created: iso(H), thread: [] },
    ],
  };

  test('a handle is the first name, compared literally and case-blind, sentence stops ignored', () => {
    expect(mentionsPerson('hi @Michal.', 'Michal Dovrtel')).toBe(true);
    expect(mentionsPerson('hi @michalek', 'Michal Dovrtel')).toBe(false);
    expect(mentionsPerson('mail a@michal.cz', 'Michal Dovrtel')).toBe(false);
    expect(mentionsPerson('hi', 'Michal')).toBe(false);
    expect(mentionsPerson('hi @michal', '')).toBe(false);
  });

  test('unread = messages by others that name me: not mine, not AI, not a converted sticky root', () => {
    const u = unreadMentions(data, 'Michal Dovrtel');
    expect(
      u.map((x: { threadId: string; messageId: string }) => `${x.threadId}:${x.messageId}`)
    ).toEqual(['c1:root', 'c2:r9']);
    expect(u[0]).toMatchObject({ file: A, from: 'Jonas' });
    expect(unreadThreadCount(u)).toBe(2);
  });

  test('reading a thread removes its mentions and keeps the other threads counted', () => {
    const u = unreadMentions(data, 'Michal Dovrtel');
    const patch = markThreadRead(u, 'c1');
    expect(Object.keys(patch)).toEqual([mentionKey('c1', 'root')]);
    const left = unreadMentions(data, 'Michal Dovrtel', patch);
    expect(left.map((x: { threadId: string }) => x.threadId)).toEqual(['c2']);
  });

  test('keys fit ui-prefs (≤128 chars, plain characters) even with long ids', () => {
    const k = mentionKey('c'.repeat(64), 'r'.repeat(64));
    expect(k.length).toBeLessThanOrEqual(128);
    expect(k).toMatch(/^[A-Za-z0-9._:/-]{1,128}$/);
  });

  test('only mentions that appeared after the baseline earn a toast', () => {
    const u = unreadMentions(data, 'Michal Dovrtel');
    const known = new Set([u[0].key]);
    expect(newMentions(u, known).map((x: { key: string }) => x.key)).toEqual([u[1].key]);
  });

  test('the toast is one action, plain words: "Jonas mentioned you on A4 · plakát" + Open', () => {
    const c = mentionCallout({ key: 'k', from: 'Jonas Beran' }, 'A4 · plakát');
    expect(c).toMatchObject({
      kind: 'mention',
      title: 'Jonas mentioned you on A4 · plakát',
      action: { id: 'open-thread', label: 'Open' },
    });
    expect(mentionCallout({ key: 'k', from: 'Jonas' }, '').title).toBe('Jonas mentioned you');
  });
});

describe('the shell half of the overlay messages', () => {
  const okFetch = (calls: { url: string; init?: RequestInit }[], answer: unknown, status = 200) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(answer), { status });
    }) as unknown as typeof fetch;

  test('canvasRel strips the design root', () => {
    expect(canvasRel('.design/ui/a.tsx', '.design')).toBe('ui/a.tsx');
    expect(canvasRel('ui/a.tsx', '.design')).toBe('ui/a.tsx');
  });

  test('a reply goes to the op door by id alone and comes back to the iframe', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const sent: unknown[] = [];
    const handled = await handleCommentBridgeMessage(
      { dgn: 'comment-op', reqId: 'q1', op: { op: 'reply', id: 'c1', body: 'ok' } },
      {
        activePath: A,
        reply: (m: unknown) => sent.push(m),
        fetchImpl: okFetch(calls, { id: 'c1', comment: { id: 'c1' } }),
      }
    );
    expect(handled).toBe(true);
    expect(calls[0].url).toBe('/_api/comments/op');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ op: 'reply', id: 'c1', body: 'ok' });
    expect(sent).toEqual([
      { dgn: 'comment-op-ack', reqId: 'q1' },
      { dgn: 'comment-op-result', reqId: 'q1', ok: true, comment: { id: 'c1' } },
    ]);
  });

  test('an add is pinned to the OPEN canvas whatever file the iframe names', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await handleCommentBridgeMessage(
      {
        dgn: 'comment-op',
        reqId: 1,
        op: { op: 'add', file: '.design/ui/OTHER.tsx', text: 'hi', artboard: 'reel', t: 12 },
      },
      { activePath: A, reply: () => {}, fetchImpl: okFetch(calls, { comment: { id: 'n' } }) }
    );
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      op: 'add',
      file: A,
      artboard: 'reel',
      t: 12,
    });
  });

  test('a refusal reaches the iframe as a sentence; unknown ops never leave the shell', async () => {
    const sent: { ok?: boolean; error?: string }[] = [];
    const calls: { url: string }[] = [];
    await handleCommentBridgeMessage(
      { dgn: 'comment-op', reqId: 2, op: { op: 'delete-own', id: 'c1' } },
      {
        activePath: A,
        reply: (m: never) => sent.push(m),
        fetchImpl: okFetch(
          calls as never,
          {
            error: 'Only the person who wrote a comment can change or delete it.',
            code: 'not-yours',
          },
          403
        ),
      }
    );
    expect(sent[0]).toEqual({ dgn: 'comment-op-ack', reqId: 2 });
    expect(sent[1]).toMatchObject({
      ok: false,
      status: 403,
      error: 'Only the person who wrote a comment can change or delete it.',
    });
    const sent2: { ok?: boolean }[] = [];
    const calls2: { url: string }[] = [];
    await handleCommentBridgeMessage(
      { dgn: 'comment-op', reqId: 3, op: { op: 'drop-table' } },
      { activePath: A, reply: (m: never) => sent2.push(m), fetchImpl: okFetch(calls2 as never, {}) }
    );
    expect(calls2).toEqual([]);
    expect(sent2[1].ok).toBe(false);
  });

  test('people: the hub list is narrowed to names + role words, null when there is no source', async () => {
    const calls: { url: string }[] = [];
    const sent: { people: unknown }[] = [];
    await handleCommentBridgeMessage(
      { dgn: 'comment-people-request', reqId: 5 },
      {
        activePath: A,
        me: 'Michal',
        reply: (m: never) => sent.push(m),
        fetchImpl: okFetch(calls as never, {
          people: [
            { id: 'u1', name: 'Tereza', role: 'member', email: 't@x.cz' },
            { id: 'u2', name: 'Michal', role: 'owner' },
          ],
        }),
      }
    );
    expect(calls[0].url).toBe('/_api/share/people?canvas=ui%2Fa.tsx');
    expect(sent[0].people).toEqual([{ id: 'u1', name: 'Tereza', role: 'Can edit' }]);
    expect(await fetchMentionPeople('ui/a.tsx', null, okFetch([], {}, 404))).toBeNull();
  });

  test('postCommentOp never throws: a network failure is data', async () => {
    const r = await postCommentOp({ op: 'resolve', id: 'c1' }, (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 0, code: 'offline' });
  });

  test('messages that are not ours are left alone', async () => {
    expect(
      await handleCommentBridgeMessage(
        { dgn: 'comment-click', id: 'c1' },
        { activePath: A, reply: () => {} }
      )
    ).toBe(false);
  });
});
