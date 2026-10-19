// S5.18 G5 (03 `ai-chat-list`) — idle chat rows carry the artboard "where" line; G1 (03 `ai-two-artboards`) — the
// run-list popover narrows to fit a dock column instead of running out past its left edge.
// Red first: idle rows had no `where`; the popover was always 320 px.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkChatCanvas, listChats, noteChatArtboards, writeChatMeta } from '../acp/transcript.ts';
import { artboardWhere, boardsByRel, buildChatList } from '../client/v2/ai/chat-list-model.js';
import { fitRunListWidth } from '../client/v2/ai/runs-model.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const BOARDS = [
  { id: 'post', label: 'Post 1:1 · Combine' },
  { id: 'poster', label: 'A4 · plakát' },
  { id: 'story', label: 'Story 9:16' },
];

describe('G5 — the where line under an idle chat row', () => {
  test('names from the index, two then "+N", the id humanised when the index lacks it, nothing for the whole canvas', () => {
    expect(artboardWhere(['poster'], BOARDS)).toBe('A4 · plakát');
    expect(artboardWhere(['post', 'poster'], BOARDS)).toBe('Post 1:1 · Combine, A4 · plakát');
    expect(artboardWhere(['post', 'poster', 'story'], BOARDS)).toBe(
      'Post 1:1 · Combine, A4 · plakát +1'
    );
    expect(artboardWhere(['helma-z-boku'], [])).toBe('Helma z boku');
    expect(artboardWhere(undefined, BOARDS)).toBe('');
    expect(artboardWhere([], BOARDS)).toBe('');
  });

  test('boardsByRel reads the canvases index', () => {
    const m = boardsByRel({
      canvases: [
        { rel: 'ui/Kampan.tsx', artboards: [{ id: 'post', label: 'Post 1:1' }, { nope: 1 }] },
      ],
    });
    expect(m.get('ui/Kampan.tsx')).toEqual([{ id: 'post', label: 'Post 1:1' }]);
  });

  test('buildChatList: an idle row says where; a running row says "Canvas › Artboard"', () => {
    const list = buildChatList({
      groups: [
        {
          canvas: 'ui/Kampan.tsx',
          chats: [
            { id: 'c1', title: 'Translate the poster', updated: 1, artboards: ['poster'] },
            { id: 'c2', title: 'Whole canvas ask', updated: 2 },
            { id: 'c3', title: 'Running one', updated: 3, artboards: ['post'] },
          ],
        },
      ],
      busy: { c3: true },
      boards: new Map([['ui/Kampan.tsx', BOARDS]]),
    });
    const idle = list.groups[0].rows;
    expect(idle.find((r: { id: string }) => r.id === 'c1')?.where).toBe('A4 · plakát');
    expect(idle.find((r: { id: string }) => r.id === 'c2')?.where).toBe('');
    expect(list.running[0].where).toBe('Kampan › Post 1:1 · Combine');
  });
});

describe('G5 — the server remembers what a chat last asked about', () => {
  function chatRoot() {
    const root = mkdtempSync(join(tmpdir(), 'maude-s518-chat-'));
    dirs.push(root);
    mkdirSync(join(root, '_chat'), { recursive: true });
    writeFileSync(
      join(root, '_chat', 'c1.jsonl'),
      `${JSON.stringify({ role: 'user', text: 'hi' })}\n`
    );
    return root;
  }

  test('a scoped ask records its artboards on the linked canvas; the list carries them; a whole-canvas ask clears them', () => {
    const root = chatRoot();
    linkChatCanvas(root, 'c1', 'ui/Kampan.tsx');
    noteChatArtboards(root, 'c1', 'ui/Kampan.tsx', ['poster', 'post']);
    expect(listChats(root).find((c) => c.id === 'c1')?.artboards).toEqual(['poster', 'post']);
    noteChatArtboards(root, 'c1', 'ui/Kampan.tsx', '*');
    expect(listChats(root).find((c) => c.id === 'c1')?.artboards).toBeUndefined();
  });

  test('an ask on ANOTHER canvas than the chat is linked to does not leave a stale artboard line; a rename keeps the key', () => {
    const root = chatRoot();
    linkChatCanvas(root, 'c1', 'ui/Kampan.tsx');
    noteChatArtboards(root, 'c1', 'ui/Kampan.tsx', ['poster']);
    writeChatMeta(root, 'c1', { title: 'Renamed' });
    expect(listChats(root).find((c) => c.id === 'c1')?.artboards).toEqual(['poster']);
    noteChatArtboards(root, 'c1', 'ui/Other.tsx', ['x']);
    expect(listChats(root).find((c) => c.id === 'c1')?.artboards).toBeUndefined();
  });

  test('ids that are not plain ids are dropped (a hand-edited sidecar cannot smuggle text into the list)', () => {
    const root = chatRoot();
    linkChatCanvas(root, 'c1', 'ui/Kampan.tsx');
    noteChatArtboards(root, 'c1', 'ui/Kampan.tsx', ['ok', '../x', 'a b', '<b>']);
    expect(listChats(root).find((c) => c.id === 'c1')?.artboards).toEqual(['ok']);
  });
});

describe('G1 — the run list fits its column', () => {
  test('wide room keeps 320; a 288 px dock column narrows it; it never goes below the floor', () => {
    expect(fitRunListWidth({ anchorRight: 1300, boundsLeft: 400 })).toBe(320);
    // the ✦ N button's right edge sits ~230 px into a 288 px column that starts at 1152
    expect(fitRunListWidth({ anchorRight: 1152 + 230, boundsLeft: 1152 })).toBe(222);
    expect(fitRunListWidth({ anchorRight: 100, boundsLeft: 0 })).toBe(160);
    expect(fitRunListWidth({ anchorRight: Number.NaN })).toBe(320);
  });
});
