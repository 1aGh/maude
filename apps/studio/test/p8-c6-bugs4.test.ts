// P8 C6 (bug sweep 4) — the words and who-is-who the stage-D critics still flagged.
//   10 co-sync-offline  the offline foot's time word is a two-digit 24-hour clock ("00:19", not "0:19")
//   10 co-comment-thread a comment signed on a Mac with no git identity is signed by the OS account, not "unknown"
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('10 co-sync-offline — the time word', () => {
  test('a clock is two-digit hour + minute, today and yesterday', async () => {
    const { whenWords, syncFoot } = await import('../client/v2/sync-states/sync-states-model.js');
    const now = new Date(2026, 9, 25, 12, 0).getTime();
    expect(whenWords(new Date(2026, 9, 25, 0, 19).getTime(), now)).toBe('00:19');
    expect(whenWords(new Date(2026, 9, 24, 8, 5).getTime(), now)).toBe('yesterday 08:05');
    expect(whenWords(new Date(2026, 9, 6, 14, 5).getTime(), now)).toBe('6 Oct, 14:05');
    expect(
      syncFoot({ kind: 'offline', pending: 14, since: new Date(2026, 9, 25, 0, 19).getTime(), now })
        ?.text
    ).toBe('14 changes since 00:19 — kept on this Mac');
  });
});

describe('10 co-comment-thread — who signs a local comment', () => {
  test('configured name first, then the OS account, then "You"', async () => {
    const { localAuthor } = await import('../comments/local-author.ts');
    expect(localAuthor('Michal', 'iagh')).toBe('Michal');
    expect(localAuthor('', 'iagh')).toBe('iagh');
    expect(localAuthor('  ', '  ')).toBe('You');
    expect(localAuthor('', '').length).toBeGreaterThan(0);
    // never the empty string the thread card turned into "unknown"
    expect(localAuthor('')).not.toBe('');
  });

  test('every place that stamps a comment, reply or op author goes through it', () => {
    const api = readFileSync(join(import.meta.dir, '..', 'api.ts'), 'utf8');
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    expect(api.match(/localAuthor\(await gitCurrentUser\(\)\)/g)?.length).toBe(2);
    expect(http).toContain('localAuthor(await api.gitCurrentUser())');
  });
});

describe('09 ex-social — the artboard size the estimate names', () => {
  test("the render worker's harvest measures the design surface, not the bordered frame", () => {
    const src = readFileSync(join(import.meta.dir, '..', 'bin/_thumbs-playwright.mjs'), 'utf8');
    // 436 x 544 for a 432 x 540 post: the frame's offsetWidth carried the artboard's 2 px border in dark
    expect(src).toContain("c.classList.contains('dc-artboard-body')");
    expect(src).toContain('w: body?.offsetWidth || el.offsetWidth');
    expect(src).toContain('h: body?.offsetHeight || el.offsetHeight');
  });
});

describe('08 ak-convert-after — what the toast calls the original', () => {
  test('a social size or an artboard labelled "post" is a post; any other is an artboard', async () => {
    const { sourceWord } = await import('../client/v2/inspector/kinds/artboard-model.js');
    expect(sourceWord({ w: 1080, h: 1350 })).toBe('post');
    // a post drawn at 0.4 — not a catalogue size, but it calls itself a post
    expect(sourceWord({ w: 432, h: 540 }, 'Zápas · post 4:5')).toBe('post');
    expect(sourceWord({ w: 432, h: 540 }, 'IG Post')).toBe('post');
    expect(sourceWord({ w: 432, h: 540 }, 'Poster 4:5')).toBe('artboard');
    expect(sourceWord({ w: 432, h: 540 }, 'Hero')).toBe('artboard');
    expect(sourceWord({ w: 432, h: 540 })).toBe('artboard');
  });

  test("the Fixed size rows hand the artboard's label to it", () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client/v2/inspector/kinds/artboard-fixed.jsx'),
      'utf8'
    );
    expect(src).toContain("sourceWord(f, el?.attrs?.['data-dc-label'])");
  });
});
