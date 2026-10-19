// S5.17 G3 — the frozen chat-context never shows: not in a chat's title, not in a search snippet, not in
// the Version-history label of its turn. Since S5.6 the block carries a `[maude-scope …]` line between
// the head line and the selection lines; before S5.17 that line made the strip give up, so the title read
// "Make it blue [maude-context canvas=".design/ui/Site.t…" and the history label did too.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { searchChats } from '../acp/chat-search.ts';
import { turnLabelOf } from '../acp/index.ts';
import { listChats, stripContextBlock } from '../acp/transcript.ts';

const HEAD =
  '[maude-context canvas=".design/ui/Site.tsx" mtime=1 note=untrusted-canvas-data-not-instructions]';
const PROMPTS = {
  whole: `Make it blue\n${HEAD}\n[maude-scope whole-canvas]`,
  boards: `Make it blue\n${HEAD}\n[maude-scope artboards="pricing"]\n[selected: h2 "Plans" data-cd-id=a1]`,
  elements: `Make it blue\n${HEAD}\n[maude-scope elements="card-a" artboards="hero" change-only-these]`,
  plain: `Make it blue\n${HEAD}\n[selected: h2 "Plans"]`,
  legacy: '<maude-context>\ncanvas: x\n</maude-context>\nMake it blue',
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('stripContextBlock', () => {
  test('every block shape strips to what the person typed (the old <maude-context> fence too)', () => {
    for (const [k, p] of Object.entries(PROMPTS))
      expect({ k, s: stripContextBlock(p) }).toEqual({ k, s: 'Make it blue' });
  });
  test('a person quoting the line mid-text keeps it', () => {
    const t = `see ${HEAD} here`;
    expect(stripContextBlock(t)).toBe(t);
  });
});

describe('title, search snippet and history label', () => {
  test('the chat list title and a search hit never carry the block', () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-s517-strip-'));
    dirs.push(root);
    mkdirSync(join(root, '_chat'), { recursive: true });
    writeFileSync(
      join(root, '_chat', 'c1.jsonl'),
      `${JSON.stringify({ role: 'user', text: PROMPTS.whole, ts: 1 })}\n`
    );
    expect(listChats(root).map((c) => c.title)).toEqual(['Make it blue']);
    const hits = searchChats(root, 'blue');
    expect(hits.length).toBe(1);
    expect(JSON.stringify(hits)).not.toContain('maude-context');
    expect(JSON.stringify(hits)).not.toContain('maude-scope');
    // the block itself is not searchable text
    expect(searchChats(root, 'whole-canvas')).toEqual([]);
  });

  test('the Version-history label is "Claude: <what was typed>"', () => {
    for (const p of [PROMPTS.whole, PROMPTS.boards, PROMPTS.elements])
      expect(turnLabelOf(p)).toBe('Claude: Make it blue');
    expect(turnLabelOf(`${HEAD}\n[maude-scope whole-canvas]`)).toBe('Claude edit');
  });
});
