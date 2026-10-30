// DDR-132 — per-user GitHub identity SWR disk cache.
//
// Round-trips the cache against a temp XDG_CACHE_HOME, proves a different
// token-hash is a clean miss, and asserts the raw token NEVER appears in the
// on-disk file (only its sha256 prefix). Pure module — no network.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __testing,
  cacheDir,
  clearCached,
  readCached,
  tokenHash,
  writeCached,
} from '../github/identity-cache.ts';

const realXdg = process.env.XDG_CACHE_HOME;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'maude-idcache-'));
  process.env.XDG_CACHE_HOME = tmp;
});
afterEach(() => {
  if (realXdg === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = realXdg;
  rmSync(tmp, { recursive: true, force: true });
});

const IDENTITY = { login: 'octocat', name: 'Octo Cat', avatar_url: 'https://x/y.png' };

describe('identity-cache', () => {
  test('cacheDir lands under $XDG_CACHE_HOME/maude', () => {
    expect(cacheDir()).toBe(join(tmp, 'maude'));
  });

  test('round-trips a written identity for the matching key', () => {
    const key = tokenHash('tok_secret_abc');
    expect(readCached(key)).toBeNull(); // first run: clean miss
    writeCached(key, IDENTITY);
    expect(readCached(key)).toEqual(IDENTITY);
  });

  test('a different token-hash is a clean miss (account/token swap)', () => {
    writeCached(tokenHash('tok_account_A'), IDENTITY);
    expect(readCached(tokenHash('tok_account_B'))).toBeNull();
  });

  test('the raw token never appears in the on-disk file', () => {
    const token = 'ghp_SUPERSECRETtokenVALUE1234567890';
    writeCached(tokenHash(token), IDENTITY);
    const raw = readFileSync(__testing.cacheFile(tokenHash(token)), 'utf8');
    expect(raw).not.toContain(token);
    // the stored key IS present and is the hash prefix, not the token
    expect(raw).toContain(tokenHash(token));
    expect(tokenHash(token).length).toBe(16);
  });

  test('tolerates a null name', () => {
    const key = tokenHash('t');
    writeCached(key, { login: 'ghost', name: null, avatar_url: 'a' });
    expect(readCached(key)?.name).toBeNull();
  });

  test('corrupt JSON is a clean miss, not a throw', () => {
    writeCached(tokenHash('t'), IDENTITY);
    // clobber the file with garbage
    const fs = require('node:fs');
    fs.writeFileSync(__testing.cacheFile(tokenHash('t')), '{ not json');
    expect(readCached(tokenHash('t'))).toBeNull();
  });

  test('clearCached forces a subsequent miss', () => {
    const key = tokenHash('t');
    writeCached(key, IDENTITY);
    expect(readCached(key)).toEqual(IDENTITY);
    clearCached(key);
    expect(readCached(key)).toBeNull();
  });

  // V2-3.4 (old T9 gotcha) — two profiles (two tokens) on one machine. A single slot made
  // them evict each other, so every tab switch revalidated against GitHub.
  test('two tokens keep their own entries: writing B does not evict A', () => {
    const a = tokenHash('tok_profile_A');
    const b = tokenHash('tok_profile_B');
    writeCached(a, IDENTITY);
    writeCached(b, { login: 'second', name: null, avatar_url: 'b' });
    expect(readCached(a)).toEqual(IDENTITY);
    expect(readCached(b)?.login).toBe('second');
  });

  test('clearing one key leaves the other', () => {
    const a = tokenHash('tok_profile_A');
    const b = tokenHash('tok_profile_B');
    writeCached(a, IDENTITY);
    writeCached(b, IDENTITY);
    clearCached(a);
    expect(readCached(a)).toBeNull();
    expect(readCached(b)).toEqual(IDENTITY);
  });

  test('one file per key, named by the hash — no token anywhere in the cache dir', () => {
    const tokens = ['ghp_tokenONE_0000000000', 'ghp_tokenTWO_1111111111'];
    for (const t of tokens) writeCached(tokenHash(t), IDENTITY);
    const names = readdirSync(cacheDir()).filter((n) => n.startsWith('github-identity'));
    expect(names.sort()).toEqual(tokens.map((t) => `github-identity-${tokenHash(t)}.json`).sort());
    for (const n of names) {
      const raw = readFileSync(join(cacheDir(), n), 'utf8');
      for (const t of tokens) expect(raw).not.toContain(t);
    }
  });

  test('the cache is capped: at most MAX_ENTRIES files, the least recently written go first', () => {
    const { MAX_ENTRIES } = __testing;
    const keys = Array.from({ length: MAX_ENTRIES + 3 }, (_, i) => tokenHash(`tok_${i}`));
    keys.forEach((k, i) => {
      writeCached(k, IDENTITY);
      // deterministic ages: the i-th write is i seconds newer than the first
      const t = new Date(1_700_000_000_000 + i * 1000);
      utimesSync(__testing.cacheFile(k), t, t);
    });
    writeCached(keys[keys.length - 1] as string, IDENTITY); // prune runs on write
    const left = readdirSync(cacheDir()).filter((n) => n.startsWith('github-identity-'));
    expect(left.length).toBe(MAX_ENTRIES);
    expect(readCached(keys[0] as string)).toBeNull();
    expect(readCached(keys[keys.length - 1] as string)).toEqual(IDENTITY);
  });

  test('a key that is not a 16-hex hash never names a file (no path out of the cache dir)', () => {
    writeCached('../../escape', IDENTITY);
    expect(readCached('../../escape')).toBeNull();
    expect(existsSync(join(tmp, 'escape.json'))).toBe(false);
    expect(readdirSync(cacheDir()).filter((n) => n.startsWith('github-identity'))).toEqual([]);
  });
});
