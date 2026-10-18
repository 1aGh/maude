// S1.18 — the window's half of a stable canvas link (client/v2/canvases/open-link.js): the delivered link is
// re-validated (ids only), the resolve answer decides open / Trash / gone, the toast never shows link text,
// and Copy link mints the entry link only when this project has an op log.

import { describe, expect, test } from 'bun:test';

import { parseFileDeepLink, parseMaudeLink } from '../client/share-link.js';
import {
  canvasLink,
  goneWords,
  openedFromWords,
  parseCanvasLink,
  planOpenLink,
  requestOpenLink,
  stableLinkFor,
  takeOpenLinks,
} from '../client/v2/canvases/open-link.js';

describe('a delivered canvas link', () => {
  test('reads the ids the shell rebuilt (deep_link.rs: c, a, m)', () => {
    expect(
      parseCanvasLink('maude://open/alligators?c=n_abc12345&a=pozvanka-story&m=c_7Ab')
    ).toEqual({
      project: 'alligators',
      entry: 'n_abc12345',
      artboard: 'pozvanka-story',
      comment: 'c_7Ab',
    });
    // The shell's own encoding of a non-ASCII anchor round-trips.
    expect(parseCanvasLink('maude://open/a?c=n_abc12345&a=p%C5%99%C3%ADb%C4%9Bh')?.artboard).toBe(
      'příběh'
    );
    expect(parseCanvasLink('maude://open/a?c=n_abc12345&a=story+A')?.artboard).toBe('story A');
    expect(parseCanvasLink('maude://open/a?c=n_abc12345')).toEqual({
      project: 'a',
      entry: 'n_abc12345',
      artboard: null,
      comment: null,
    });
  });

  test('carries ids only — no path, code, URL or unknown key', () => {
    for (const url of [
      'maude://open/a?c=short',
      'maude://open/a?c=n_abc12345&open=ui/A.tsx',
      'maude://open/a?c=n_abc12345&code=mhc_aaaa',
      'maude://open/a?c=n_abc12345&next=https://evil.example',
      'maude://open/a?c=n_abc12345&c=n_abc67890',
      'maude://open/a?c=n_abc12345&a=a/b',
      'maude://open/a?c=n_abc12345&a=%0A',
      `maude://open/a?c=n_abc12345&a=${'x'.repeat(129)}`,
      'maude://open/a?c=n_abc12345&m=a-b',
      'maude://open/a?c=n_abc12345#anchor',
      'maude://open/A?c=n_abc12345',
      'maude://open/-a?c=n_abc12345',
      'maude://join/a?c=n_abc12345',
      '',
      null,
    ])
      expect(parseCanvasLink(url)).toBeNull();
  });

  test('parseMaudeLink tags it `canvas`; the file and connect readers never take it', () => {
    const url = 'maude://open/a?c=n_abc12345&a=story';
    expect(parseMaudeLink(url)).toMatchObject({
      kind: 'canvas',
      entry: 'n_abc12345',
      artboard: 'story',
    });
    expect(parseFileDeepLink(url)).toBeNull();
    expect(parseMaudeLink('maude://open/a?open=ui/A.tsx')?.kind).toBe('file');
  });
});

describe('minting (Copy link)', () => {
  test('the minted link is what the shell accepts: entry in the query, artboard as the anchor', () => {
    expect(canvasLink({ project: 'alligators', entry: 'n_abc12345' })).toBe(
      'maude://open/alligators?c=n_abc12345'
    );
    expect(
      canvasLink({ project: 'alligators', entry: 'n_abc12345', artboard: 'příběh', comment: 'c_1' })
    ).toBe('maude://open/alligators?c=n_abc12345&m=c_1#p%C5%99%C3%ADb%C4%9Bh');
    for (const bad of [
      { project: 'Bad', entry: 'n_abc12345' },
      { project: 'a', entry: '../x' },
      { project: 'a', entry: 'n_abc12345', artboard: 'a/b' },
      { project: 'a', entry: 'n_abc12345', comment: 'a b' },
    ])
      expect(canvasLink(bad)).toBeNull();
  });

  test('stable when the canvas has an entry; null (today’s link) on a legacy project', async () => {
    const answers: Record<string, unknown> = {
      '/_api/link/resolve?path=ui%2FA.tsx': {
        ok: true,
        status: 'live',
        entry: 'n_abc12345',
        path: 'ui/A.tsx',
      },
      '/_api/link/resolve?path=ui%2FOld.tsx': { ok: false, reason: 'legacy' },
    };
    const fetchImpl = (async (u: string) =>
      Response.json(answers[u] ?? { ok: true, status: 'unknown' })) as never;
    const appLink = 'maude://open/alligators?open=ui/A.tsx';
    expect(await stableLinkFor({ path: 'ui/A.tsx', appLink, fetchImpl })).toBe(
      'maude://open/alligators?c=n_abc12345'
    );
    expect(await stableLinkFor({ path: 'ui/Old.tsx', appLink, fetchImpl })).toBeNull();
    expect(await stableLinkFor({ path: 'ui/A.tsx', appLink: null, fetchImpl })).toBeNull();
  });
});

describe('what a resolve answer does', () => {
  const link = { entry: 'n_abc12345', artboard: 'story', comment: 'c_1' };
  test('live → open there; trashed → the Trash; unknown or unreachable → gone; no op log → legacy', () => {
    expect(planOpenLink({ ok: true, status: 'live', path: 'kampan/Pozvanka.tsx' }, link)).toEqual({
      kind: 'open',
      path: 'kampan/Pozvanka.tsx',
      artboard: 'story',
      comment: 'c_1',
    });
    expect(planOpenLink({ ok: true, status: 'trashed', entry: 'n_abc12345' }, link)).toEqual({
      kind: 'trash',
    });
    expect(planOpenLink({ ok: true, status: 'unknown' }, link)).toEqual({ kind: 'gone' });
    expect(planOpenLink({ ok: false, reason: 'unreachable' }, link)).toEqual({ kind: 'gone' });
    expect(planOpenLink({ ok: false, reason: 'legacy' }, link)).toEqual({ kind: 'legacy' });
  });

  test('the words (CONTRACT) — the name is the stored comment author, never link text', () => {
    expect(openedFromWords({ who: 'Tereza', canvas: 'Pozvánka', artboard: 'story' })).toBe(
      "Opened from Tereza's link — Pozvánka · story."
    );
    expect(openedFromWords({ who: null, canvas: 'Pozvánka', artboard: null })).toBe(
      'Opened from a link — Pozvánka.'
    );
    expect(goneWords('Alligators brand')).toBe("This canvas isn't in Alligators brand any more.");
  });

  test('a link that arrives before the shell mounts waits for it', () => {
    const seen: string[] = [];
    const target = { dispatchEvent: (e: Event) => seen.push(e.type) } as unknown as Window;
    requestOpenLink({ entry: 'n_one00000' }, target);
    requestOpenLink({ entry: 'n_two00000' }, target);
    expect(seen).toEqual(['maude:open-link', 'maude:open-link']);
    expect(takeOpenLinks().map((l: { entry: string }) => l.entry)).toEqual([
      'n_one00000',
      'n_two00000',
    ]);
    expect(takeOpenLinks()).toEqual([]);
  });
});
