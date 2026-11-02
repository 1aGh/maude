// P8 C5 (04 md-comment, 10 co-comment-*): arming the Comment tool docks the Comments panel — the board draws
// the panel open beside the pins while the tool is in hand. The shell learns the tool from the canvas's
// `tool-cursor` token; this is the edge it acts on (arming, not every repeat of the token).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCommentToolWatch } from '../client/v2/comments/comment-tool.js';

describe('the Comment tool docks the panel', () => {
  test('arming it (any other tool -> comment) asks for the panel once; the repeats do not', () => {
    const w = createCommentToolWatch();
    expect(w.armed('hand')).toBe(false);
    expect(w.armed('comment')).toBe(true);
    expect(w.armed('comment')).toBe(false);
    expect(w.armed('comment')).toBe(false);
  });

  test('leaving the tool and coming back arms it again', () => {
    const w = createCommentToolWatch();
    expect(w.armed('comment')).toBe(true);
    expect(w.armed('sticky')).toBe(false);
    expect(w.armed('comment')).toBe(true);
  });

  test('a token that is not a tool never arms it', () => {
    const w = createCommentToolWatch();
    expect(w.armed(undefined)).toBe(false);
    expect(w.armed(null)).toBe(false);
    expect(w.armed('Comment')).toBe(false);
    expect(w.armed('browse')).toBe(false);
  });

  test('the bridge opens the panel on that edge, from the active canvas only (the tool-cursor branch)', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'hooks', 'use-canvas-bridge.jsx'),
      'utf8'
    );
    const branch = /if \(m\.dgn === 'tool-cursor'\) \{[\s\S]*?\n {6}\}\n/.exec(src)?.[0] ?? '';
    expect(branch).toContain("openRightPanel('comments')");
    expect(branch).toContain('commentToolWatch.armed(m.tool)');
  });
});
