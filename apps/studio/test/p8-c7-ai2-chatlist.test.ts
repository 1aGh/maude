// P8 stage C round 7 (p8-c7-ai2) — 03 ai-chat-list: each canvas group carries a small picture of its canvas
// (the Canvases panel's cover), in the browse view and in the search results.
import { describe, expect, test } from 'bun:test';
import { buildChatList, buildSearchList, coversByRel } from '../client/v2/ai/chat-list-model.js';

const snapshot = {
  canvases: [
    { rel: 'ui/Combine-kampan.tsx', cover: { key: 'combine-key' }, artboards: [] },
    { rel: 'ui/Uniformy-2027.tsx', artboards: [] },
    { rel: 'ui/odd.tsx', cover: { key: 42 } },
  ],
};

describe('coversByRel — canvas path to the cover key the thumbnail service gave it', () => {
  test('only canvases with a string cover key are in', () => {
    const m = coversByRel(snapshot);
    expect(m.get('ui/Combine-kampan.tsx')).toBe('combine-key');
    expect(m.has('ui/Uniformy-2027.tsx')).toBe(false);
    expect(m.has('ui/odd.tsx')).toBe(false);
  });
  test('an index that is not there yields an empty map', () => {
    expect(coversByRel(null).size).toBe(0);
  });
});

describe('the groups carry their canvas cover', () => {
  const chat = (id: string, canvas: string) => ({
    id,
    title: `t ${id}`,
    updated: Date.now() - 1000,
    canvas,
  });
  const groups = [
    { canvas: 'ui/Combine-kampan.tsx', chats: [chat('a', 'ui/Combine-kampan.tsx')] },
    { canvas: 'ui/Uniformy-2027.tsx', chats: [chat('b', 'ui/Uniformy-2027.tsx')] },
  ];
  const covers = coversByRel(snapshot);

  test('browse: a group with a cover names its key, one without says null (the box keeps its place)', () => {
    const list = buildChatList({ groups, covers });
    expect(list.groups.map((g: { cover: string | null }) => g.cover)).toEqual([
      'combine-key',
      null,
    ]);
  });

  test('search results group by canvas with the same cover', () => {
    const hits = [
      {
        id: 'a',
        title: 'Translate',
        titleRanges: [],
        updated: Date.now(),
        canvas: 'ui/Combine-kampan.tsx',
      },
    ];
    const list = buildSearchList(hits, 'tran', Date.now(), covers);
    expect(list.groups[0].cover).toBe('combine-key');
  });

  test('no covers handed in: every group says null (nothing breaks for an older caller)', () => {
    expect(
      buildChatList({ groups }).groups.every((g: { cover: unknown }) => g.cover === null)
    ).toBe(true);
  });
});
