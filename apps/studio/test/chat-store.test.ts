// S5.7 — the chat store: grouping by canvas, full-text search (accent-folded, with
// highlighted snippets), Move to trash / restore / clear out, and the session id the
// "Open in terminal" door resumes. Disk only: `<designRoot>/_chat/`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchChats } from '../acp/chat-search.ts';
import {
  chatState,
  clearTrashedChats,
  groupChatsByCanvas,
  listChats,
  readChatSessionId,
  restoreChat,
  trashChat,
  writeChatMeta,
} from '../acp/transcript.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-store-'));
  mkdirSync(join(root, '_chat'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const dir = () => join(root, '_chat');

/** A transcript: one user line, then the agent's answer as streaming chunks. */
function seed(id: string, user: string, answer = '', meta?: Record<string, unknown>) {
  const lines: object[] = [{ ts: 1, role: 'user', text: user }];
  for (const chunk of answer.match(/.{1,40}/gs) ?? [])
    lines.push({
      ts: 2,
      role: 'agent',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } },
    });
  writeFileSync(join(dir(), `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
  if (meta) writeFileSync(join(dir(), `${id}.meta.json`), JSON.stringify(meta));
}

describe('grouping by canvas', () => {
  test("the list carries each chat's canvas link; groups order by the newest chat, no-canvas last", () => {
    seed('a', 'one', '', { canvas: 'ui/reel.tsx' });
    seed('b', 'two', '', { canvas: 'ui/pricing.tsx' });
    seed('c', 'three', '', { canvas: 'ui/reel.tsx' });
    seed('d', 'four');
    const t = Date.now() / 1000;
    const { utimesSync } = require('node:fs') as typeof import('node:fs');
    utimesSync(join(dir(), 'a.jsonl'), t - 400, t - 400);
    utimesSync(join(dir(), 'b.jsonl'), t - 100, t - 100);
    utimesSync(join(dir(), 'c.jsonl'), t - 300, t - 300);
    utimesSync(join(dir(), 'd.jsonl'), t - 50, t - 50);

    const chats = listChats(root);
    expect(chats.find((c) => c.id === 'a')?.canvas).toBe('ui/reel.tsx');
    expect(chats.find((c) => c.id === 'd')?.canvas).toBeUndefined();

    const groups = groupChatsByCanvas(chats);
    expect(groups.map((g) => g.canvas)).toEqual(['ui/pricing.tsx', 'ui/reel.tsx', null]);
    expect(groups[1]?.chats.map((c) => c.id)).toEqual(['c', 'a']);
    expect(groups[2]?.chats.map((c) => c.id)).toEqual(['d']);
  });

  test('a canvas link that is not a plain relative path is ignored', () => {
    seed('a', 'one', '', { canvas: '../../etc/passwd' });
    seed('b', 'two', '', { canvas: 42 });
    expect(listChats(root).map((c) => c.canvas)).toEqual([undefined, undefined]);
  });
});

describe('Move to trash', () => {
  test('trashChat stamps trashedAt in the sidecar and keeps every other key', () => {
    seed('a', 'hello', '', { title: 'Reel covers', canvas: 'ui/reel.tsx', future: { x: 1 } });
    const meta = trashChat(root, 'a', 1234);
    expect(meta?.trashedAt).toBe(1234);
    expect(JSON.parse(readFileSync(join(dir(), 'a.meta.json'), 'utf8'))).toEqual({
      title: 'Reel covers',
      canvas: 'ui/reel.tsx',
      future: { x: 1 },
      trashedAt: 1234,
    });
  });

  test('a trashed chat leaves the list and lists under trashed:true, newest trashing first', () => {
    seed('a', 'one');
    seed('b', 'two');
    seed('c', 'three');
    trashChat(root, 'a', 100);
    trashChat(root, 'b', 300);
    expect(listChats(root).map((c) => c.id)).toEqual(['c']);
    const trashed = listChats(root, { trashed: true });
    expect(trashed.map((c) => c.id)).toEqual(['b', 'a']);
    expect(trashed[0]?.trashedAt).toBe(300);
  });

  test('an archived chat can still be trashed and still lists in the trash', () => {
    seed('a', 'one');
    writeChatMeta(root, 'a', { archived: true });
    trashChat(root, 'a', 5);
    expect(listChats(root, { trashed: true }).map((c) => c.id)).toEqual(['a']);
  });

  test('trashing a chat with no transcript does nothing', () => {
    expect(trashChat(root, 'ghost', 1)).toBeNull();
    expect(existsSync(join(dir(), 'ghost.meta.json'))).toBe(false);
  });

  test('restore clears trashedAt and brings the chat back', () => {
    seed('a', 'one', '', { canvas: 'ui/a.tsx' });
    trashChat(root, 'a', 9);
    expect(restoreChat(root, 'a')).toBe(true);
    expect(listChats(root).map((c) => c.id)).toEqual(['a']);
    expect(JSON.parse(readFileSync(join(dir(), 'a.meta.json'), 'utf8'))).toEqual({
      canvas: 'ui/a.tsx',
    });
    expect(restoreChat(root, 'a')).toBe(false); // not in the trash any more
  });

  test('clear out deletes only trashed chats, with every sidecar', () => {
    seed('a', 'one');
    seed('b', 'two');
    writeFileSync(join(dir(), 'a.session.json'), JSON.stringify({ sessionId: 's-a' }));
    trashChat(root, 'a', 1);
    expect(clearTrashedChats(root)).toEqual(['a']);
    expect(existsSync(join(dir(), 'a.jsonl'))).toBe(false);
    expect(existsSync(join(dir(), 'a.meta.json'))).toBe(false);
    expect(existsSync(join(dir(), 'a.session.json'))).toBe(false);
    expect(existsSync(join(dir(), 'b.jsonl'))).toBe(true);
  });

  test('clear out with ids refuses a chat that is not in the trash', () => {
    seed('a', 'one');
    seed('b', 'two');
    trashChat(root, 'b', 1);
    expect(clearTrashedChats(root, ['a', 'b'])).toEqual(['b']);
    expect(existsSync(join(dir(), 'a.jsonl'))).toBe(true);
  });

  test('chatState tells live, trashed and missing apart', () => {
    seed('a', 'one');
    seed('b', 'two');
    trashChat(root, 'b', 1);
    expect(chatState(root, 'a')).toBe('live');
    expect(chatState(root, 'b')).toBe('trashed');
    expect(chatState(root, 'c')).toBe('missing');
  });
});

describe('full-text search', () => {
  test('finds a word in the body and highlights it in the snippet', () => {
    seed(
      'a',
      'Make three reel covers',
      'I looked at the palette and the spacing. The headline wants more contrast against the photo, so I raised it.'
    );
    seed('b', 'Fix the pricing table', 'Done.');
    const hits = searchChats(root, 'contrast');
    expect(hits.map((h) => h.id)).toEqual(['a']);
    const s = hits[0]?.snippet;
    expect(s).not.toBeNull();
    const [from, to] = s!.ranges[0]!;
    expect(s!.text.slice(from, to).toLowerCase()).toBe('contrast');
    expect(hits[0]?.matches).toBe(1);
  });

  test('is accent-folded both ways', () => {
    seed('a', 'Uprav hlavičku', 'Hotovo, přidal jsem kontrast.');
    expect(searchChats(root, 'hlavicku').map((h) => h.id)).toEqual(['a']);
    expect(searchChats(root, 'KONTRAST').map((h) => h.id)).toEqual(['a']);
    expect(searchChats(root, 'přidal').map((h) => h.id)).toEqual(['a']);
    const hit = searchChats(root, 'pridal')[0];
    const [f, t] = hit!.snippet!.ranges[0]!;
    // the range lands on the ORIGINAL (accented) text
    expect(hit!.snippet!.text.slice(f, t)).toBe('přidal');
  });

  test('matches the title and reports where', () => {
    seed('a', 'Three reel covers', '', { title: 'Cover work' });
    const hit = searchChats(root, 'cover')[0];
    expect(hit?.id).toBe('a');
    expect(hit?.titleRanges).toEqual([[0, 5]]);
  });

  test('every word must appear; a title hit ranks above a body-only hit', () => {
    seed('body', 'Fix the table', 'The pricing page needs a new header.', {});
    seed('title', 'Pricing header', 'Done.', {});
    seed('other', 'Something else', 'pricing only.');
    const hits = searchChats(root, 'pricing header');
    expect(hits.map((h) => h.id)).toEqual(['title', 'body']);
  });

  test('skips the trash; keeps archived chats, flagged', () => {
    seed('a', 'needle one');
    seed('b', 'needle two');
    seed('c', 'needle three');
    trashChat(root, 'b', 1);
    writeChatMeta(root, 'c', { archived: true });
    const hits = searchChats(root, 'needle');
    expect(hits.map((h) => h.id).sort()).toEqual(['a', 'c']);
    expect(hits.find((h) => h.id === 'c')?.archived).toBe(true);
  });

  test('never matches the context block a send attaches', () => {
    seed('a', 'hello\n[maude-context canvas=ui/secret.tsx]');
    expect(searchChats(root, 'secret')).toEqual([]);
  });

  test('an empty or one-blank query finds nothing', () => {
    seed('a', 'hello');
    expect(searchChats(root, '')).toEqual([]);
    expect(searchChats(root, '   ')).toEqual([]);
  });

  test('41 chats answer in under 100 ms', () => {
    const para =
      'The headline wants more contrast against the photograph, so the scrim goes up a step. ';
    for (let i = 0; i < 41; i++) seed(`c${i}`, `Chat number ${i} about covers`, para.repeat(60));
    seed('hit', 'The unique zebra question', 'and a closing remark');
    searchChats(root, 'zebra'); // warm the module / fs cache
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const hits = searchChats(root, 'zebra');
      best = Math.min(best, performance.now() - t0);
      expect(hits.map((h) => h.id)).toEqual(['hit']);
    }
    expect(best).toBeLessThan(100);
  });
});

describe('the session id Open in terminal resumes', () => {
  test('reads it from the session sidecar', () => {
    writeFileSync(join(dir(), 'a.session.json'), JSON.stringify({ sessionId: 'abc-123_X' }));
    expect(readChatSessionId(root, 'a')).toBe('abc-123_X');
  });

  test('null when there is none, or when it could not be a session id', () => {
    expect(readChatSessionId(root, 'a')).toBeNull();
    writeFileSync(join(dir(), 'a.session.json'), JSON.stringify({ sessionId: 'x; rm -rf ~' }));
    expect(readChatSessionId(root, 'a')).toBeNull();
    writeFileSync(join(dir(), 'a.session.json'), '{oops');
    expect(readChatSessionId(root, 'a')).toBeNull();
  });
});
