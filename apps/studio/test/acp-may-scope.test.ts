// P8 c7 follow-up (decision maude/v2-p8-c7-ai-may-enforced) — the pure half of the "AI may" gate.
// Advanced › AI may › "Search the web" / "Use Assets and footage" turned OFF must hold on the server:
// the deny rules a session is spawned with, and the bridge's live refusal of a permission request.
// The end-to-end half (a real ACP round-trip) is acp-may-gate.test.ts.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type AiMay,
  ASSET_VERBS,
  assetsRootsFor,
  MAY_ALL,
  mayAllowedTools,
  mayDenyRules,
  mayKey,
  mayRefusal,
  parseMay,
  WEB_VERBS,
} from '../acp/may-scope.ts';
import { MAUDE_VERBS } from '../actions/verbs.ts';

const OFF: AiMay = { assets: false, web: false };
const NO_WEB: AiMay = { assets: true, web: false };
const NO_ASSETS: AiMay = { assets: false, web: true };

let tmp: string;
let repo: string;
let roots: string[];

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-may-scope-')));
  repo = join(tmp, 'repo');
  mkdirSync(join(repo, '.design', 'assets'), { recursive: true });
  roots = assetsRootsFor(repo, join(repo, '.design'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('parseMay — only an explicit false turns a switch off', () => {
  test('a well-formed object', () => {
    expect(parseMay({ assets: false, web: true })).toEqual(NO_ASSETS);
    expect(parseMay({ assets: true, web: false })).toEqual(NO_WEB);
    expect(parseMay({})).toEqual(MAY_ALL);
  });
  test('anything that is not an object is "no news" (null), never a change', () => {
    for (const v of [undefined, null, 'no-web', 0, false, ['web']]) expect(parseMay(v)).toBeNull();
  });
  test('the key is stable per state', () => {
    expect(mayKey(MAY_ALL)).not.toBe(mayKey(NO_WEB));
    expect(mayKey(OFF)).toBe(mayKey({ assets: false, web: false }));
  });
});

describe('mayDenyRules — what the session is spawned with', () => {
  test('both on: no rule at all (a session is byte-for-byte what it was)', () => {
    expect(mayDenyRules(MAY_ALL, roots)).toEqual([]);
  });
  test('web off: the two web tools and the web verbs are denied', () => {
    const rules = mayDenyRules(NO_WEB, roots);
    expect(rules).toContain('WebFetch');
    expect(rules).toContain('WebSearch');
    for (const v of WEB_VERBS) expect(rules).toContain(`Bash(maude design ${v}:*)`);
    expect(rules.some((r) => r.startsWith('Read('))).toBe(false);
  });
  test('assets off: reads under the assets root (absolute //-form) and the asset verbs are denied', () => {
    const rules = mayDenyRules(NO_ASSETS, roots);
    expect(rules).toContain(`Read(/${join(repo, '.design', 'assets')}/**)`);
    for (const v of ASSET_VERBS) expect(rules).toContain(`Bash(maude design ${v}:*)`);
    expect(rules).not.toContain('WebFetch');
  });
  test('every named verb is a real verb (the lists cannot drift from the registry)', () => {
    const real = new Set(MAUDE_VERBS.map((v) => v.verb.split(' ')[0]));
    for (const v of [...ASSET_VERBS, ...WEB_VERBS]) expect(real.has(v)).toBe(true);
  });
});

describe('mayAllowedTools — an off switch is never name-allowed', () => {
  const base = [
    'Read',
    'Glob',
    'Grep',
    'Bash(maude design beats:*)',
    'Bash(maude design captions list:*)',
    'Bash(maude design screenshot:*)',
    'WebSearch',
    'WebFetch',
  ];
  test('both on: unchanged', () => {
    expect(mayAllowedTools(base, MAY_ALL)).toEqual(base);
  });
  test('web off drops the web tools only', () => {
    expect(mayAllowedTools(base, NO_WEB)).toEqual(base.filter((t) => !t.startsWith('Web')));
  });
  test('assets off drops the asset verbs (sub-verbs too) only', () => {
    expect(mayAllowedTools(base, NO_ASSETS)).toEqual([
      'Read',
      'Glob',
      'Grep',
      'Bash(maude design screenshot:*)',
      'WebSearch',
      'WebFetch',
    ]);
  });
});

describe('mayRefusal — the live gate on a permission request', () => {
  const call = (rawInput: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    toolCallId: 't1',
    rawInput,
    ...extra,
  });

  test('web tools: refused when web is off, by name or (name unknown) by kind fetch', () => {
    expect(mayRefusal('WebFetch', call({ url: 'https://x.test' }), NO_WEB, repo, roots)).toBe(
      'web'
    );
    expect(mayRefusal('WebSearch', call({ query: 'q' }), NO_WEB, repo, roots)).toBe('web');
    expect(
      mayRefusal(undefined, call({ url: 'https://x.test' }, { kind: 'fetch' }), NO_WEB, repo, roots)
    ).toBe('web');
    expect(
      mayRefusal('WebFetch', call({ url: 'https://x.test' }), MAY_ALL, repo, roots)
    ).toBeNull();
    expect(
      mayRefusal('WebFetch', call({ url: 'https://x.test' }), NO_ASSETS, repo, roots)
    ).toBeNull();
  });

  test('a shell download is refused with web off; loopback curl-local is not', () => {
    expect(
      mayRefusal('Bash', call({ command: 'curl -s https://evil.test/?q=1' }), NO_WEB, repo, roots)
    ).toBe('web');
    expect(
      mayRefusal('Bash', call({ command: 'cd x && wget https://a.test' }), NO_WEB, repo, roots)
    ).toBe('web');
    expect(
      mayRefusal(
        'Bash',
        call({ command: 'maude design fetch-asset https://a.test/x.png' }),
        NO_WEB,
        repo,
        roots
      )
    ).toBe('web');
    expect(
      mayRefusal(
        'Bash',
        call({ command: 'maude design curl-local http://127.0.0.1:4399/_health' }),
        NO_WEB,
        repo,
        roots
      )
    ).toBeNull();
    expect(
      mayRefusal('Bash', call({ command: 'curl -s https://a.test' }), MAY_ALL, repo, roots)
    ).toBeNull();
  });

  test('assets: a read inside the assets root is refused, by path or relative path', () => {
    const inAssets = join(repo, '.design', 'assets', 'clip.mp4');
    expect(mayRefusal('Read', call({ file_path: inAssets }), NO_ASSETS, repo, roots)).toBe(
      'assets'
    );
    expect(
      mayRefusal('Read', call({ file_path: '.design/assets/clip.mp4' }), NO_ASSETS, repo, roots)
    ).toBe('assets');
    expect(
      mayRefusal(
        'Read',
        call({ file_path: '.design/ui/../assets/clip.mp4' }),
        NO_ASSETS,
        repo,
        roots
      )
    ).toBe('assets');
    expect(
      mayRefusal(
        'Grep',
        call({ pattern: 'x', path: join(repo, '.design', 'assets') }),
        NO_ASSETS,
        repo,
        roots
      )
    ).toBe('assets');
    expect(
      mayRefusal('Glob', call({ pattern: '.design/assets/**/*.mp4' }), NO_ASSETS, repo, roots)
    ).toBe('assets');
    expect(
      mayRefusal(
        'Read',
        call({ file_path: join(repo, '.design', 'ui', 'home.tsx') }),
        NO_ASSETS,
        repo,
        roots
      )
    ).toBeNull();
    expect(mayRefusal('Read', call({ file_path: inAssets }), NO_WEB, repo, roots)).toBeNull();
  });

  test('assets: a shell command naming the folder or an asset verb is refused', () => {
    expect(
      mayRefusal('Bash', call({ command: 'cat .design/assets/notes.txt' }), NO_ASSETS, repo, roots)
    ).toBe('assets');
    expect(
      mayRefusal(
        'Bash',
        call({ command: `ls ${join(repo, '.design', 'assets')}` }),
        NO_ASSETS,
        repo,
        roots
      )
    ).toBe('assets');
    expect(
      mayRefusal(
        'Bash',
        call({ command: 'maude design probe-footage clip.mp4' }),
        NO_ASSETS,
        repo,
        roots
      )
    ).toBe('assets');
    expect(
      mayRefusal('Bash', call({ command: 'maude design captions add x' }), NO_ASSETS, repo, roots)
    ).toBe('assets');
    expect(
      mayRefusal(
        'Bash',
        call({ command: 'maude design screenshot --full' }),
        NO_ASSETS,
        repo,
        roots
      )
    ).toBeNull();
  });

  test('a symlinked design root: the real assets folder is covered too', () => {
    const real = join(tmp, 'shared-design');
    mkdirSync(join(real, 'assets'), { recursive: true });
    const linked = join(tmp, 'linked-repo');
    mkdirSync(linked, { recursive: true });
    symlinkSync(real, join(linked, '.design'));
    const r = assetsRootsFor(linked, join(linked, '.design'));
    expect(r).toContain(join(real, 'assets'));
    expect(r).toContain(join(linked, '.design', 'assets'));
    expect(
      mayRefusal('Read', call({ file_path: join(real, 'assets', 'a.png') }), NO_ASSETS, linked, r)
    ).toBe('assets');
    expect(mayDenyRules(NO_ASSETS, r)).toContain(`Read(/${join(real, 'assets')}/**)`);
  });
});
