// P8 C5: the Canvases panel asks the thumbnail service for every canvas's cover, once per page load.
import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askForCovers, resetCoversAsked } from '../client/v2/canvases/covers.js';

beforeEach(() => resetCoversAsked());

describe('askForCovers', () => {
  test('one background want, once', () => {
    const calls: Array<{ url: string; body: string }> = [];
    const f = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return new Response('{}');
    }) as unknown as typeof fetch;
    expect(askForCovers(f)).toBe(true);
    expect(askForCovers(f)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/_api/thumbs/want');
    expect(JSON.parse(calls[0].body)).toEqual({ keys: [], background: true });
  });

  test('a refused or throwing request is silent', () => {
    const boom = (() => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(() => askForCovers(boom)).not.toThrow();
    resetCoversAsked();
    const reject = (async () => {
      throw new Error('403');
    }) as unknown as typeof fetch;
    expect(() => askForCovers(reject)).not.toThrow();
  });
});

describe('the panel asks on mount', () => {
  test('CanvasesPanel calls askForCovers from an effect', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'v2', 'canvases', 'canvases-panel.jsx'),
      'utf8'
    );
    expect(src).toContain("from './covers.js'");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*askForCovers\(/);
  });
});
