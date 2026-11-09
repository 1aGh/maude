// 2.1.1 T2 — `/_api/cloud/status` says where the project lives (canvas 17 · ac-model): a copy Maude keeps
// (the app bound it to a server — `MAUDE_APP_BOUND_HUB`, which a repo cannot set) or the person's own
// folder, home-abbreviated. The avatar menu's first line reads it.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudEndpoints, placeOf } from '../cloud/endpoints.ts';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('placeOf', () => {
  test('a folder under home reads with ~; elsewhere the path as is', () => {
    expect(placeOf('/Users/a/git/logo-ideas', { HOME: '/Users/a' })).toEqual({
      kept: false,
      folder: '~/git/logo-ideas',
    });
    expect(placeOf('/Users/ab/x', { HOME: '/Users/a' })).toEqual({
      kept: false,
      folder: '/Users/ab/x',
    });
    expect(placeOf('/srv/p', {})).toEqual({ kept: false, folder: '/srv/p' });
  });
  test('a copy the app bound to a server is kept by Maude (no path to manage)', () => {
    expect(
      placeOf('/data/projects/x', { HOME: '/Users/a', MAUDE_APP_BOUND_HUB: 'https://h.example' })
    ).toEqual({ kept: true });
    // an address that is not one is not a binding
    expect(placeOf('/p', { MAUDE_APP_BOUND_HUB: 'javascript:alert(1)' }).kept).toBe(false);
  });
});

describe('/_api/cloud/status carries the place', () => {
  test('status() answers place beside linkedHub', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 't2-place-'));
    made.push(repoRoot);
    const designRoot = join(repoRoot, '.design');
    mkdirSync(designRoot, { recursive: true });
    const json = createCloudEndpoints({ paths: { repoRoot, designRoot } }).status().json as {
      place?: { kept: boolean; folder?: string };
    };
    expect(json.place?.kept).toBe(false);
    expect(typeof json.place?.folder).toBe('string');
  });
});
