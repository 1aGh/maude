// S9.17 — what a project page tells the desktop shell about its unread mentions.

import { describe, expect, test } from 'bun:test';
import {
  mentionNoticeArgs,
  nextMentionNotice,
} from '../client/v2/comments/native-mention-notice.js';

const toast = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  file: 'ui/Poster.tsx',
  threadId: 't1',
  messageId: 'root',
  from: 'Jonas Novák',
  at: '2026-10-18T10:00:00Z',
  ...extra,
});

describe('S9.17 mention_notice arguments', () => {
  test('the count, and only the newest fresh mention, in routing fields', () => {
    const args = mentionNoticeArgs(
      { unreadCount: 2, toasts: [toast('k1'), toast('k2', { threadId: 't2' })] },
      () => 'A4 · plakát'
    );
    expect(args).toEqual({
      count: 2,
      latest: {
        key: 'k2',
        from: 'Jonas Novák',
        where: 'A4 · plakát',
        canvas: 'ui/Poster.tsx',
        thread: 't2',
      },
    });
    // Nothing of the comment's words travels.
    expect(JSON.stringify(args)).not.toContain('text');
  });

  test('no toasts → a count only; garbage counts are 0', () => {
    expect(mentionNoticeArgs({ unreadCount: 3, toasts: [] })).toEqual({ count: 3, latest: null });
    expect(mentionNoticeArgs({ unreadCount: -1 })).toEqual({ count: 0, latest: null });
    expect(mentionNoticeArgs(null)).toEqual({ count: 0, latest: null });
    expect(mentionNoticeArgs({ unreadCount: 1, toasts: [toast('k', { file: 7 })] }).latest).toBe(
      null
    );
  });

  test('a mention is sent once; a count change alone carries no mention', () => {
    const a = mentionNoticeArgs({ unreadCount: 1, toasts: [toast('k1')] });
    const first = nextMentionNotice({ count: -1, key: null }, a);
    expect(first.send).toBe(true);
    expect(first.payload.latest?.key).toBe('k1');
    const same = nextMentionNotice(first.next, a);
    expect(same.send).toBe(false);
    const read = nextMentionNotice(
      first.next,
      mentionNoticeArgs({ unreadCount: 0, toasts: [toast('k1')] })
    );
    expect(read.send).toBe(true);
    expect(read.payload).toEqual({ count: 0, latest: null });
  });
});
