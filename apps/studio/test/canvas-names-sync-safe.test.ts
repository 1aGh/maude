// S1.23c — lead decision `v2-lead-canvas-names-sync-safe`: a canvas or folder name stays inside the
// sync path charset (letters A–Z/a–z, digits, space, `_` and `-`, first character not a space) —
// exactly what `sync/canvas-path.ts` accepts and what every v1 receiver accepts. A name outside it is
// refused in CONTRACT words with a suggestion folded to the allowed set ("Combine — test barev" →
// “Combine - test barev”), never silently renamed and never left to land at a flat fallback path on
// other peers.
//
// Also pins what the names we DO accept do to the other planes: the git status parse, the sync
// canvas-path check (accepts the path as-is — no flat fallback), and the file plane's membership.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  foldToAllowedName,
  NAME_RULE,
  nameForTemplate,
  nameRefusal,
  renderBlankCanvas,
  renderBriefBoard,
  validateCanvasName,
  validateFolderName,
} from '../canvas-create.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import {
  ALLOWED_NAME_RE,
  checkRename,
  closeKey,
  RENAME_WORDS,
  suggestName,
} from '../client/v2/canvases/rename-model.js';
import { gitStatus } from '../git/service.ts';
import { COMPONENT, validateCanvasPath } from '../sync/canvas-path.ts';
import { classifyProjectFile } from '../sync/file-membership.ts';

const CANVAS_EXAMPLE = 'Combine — test barev';
const SUGGESTED = 'Combine - test barev';

describe('names stay inside the sync path charset', () => {
  test.each([
    'Summer camp 2026',
    SUGGESTED,
    'a_b-c',
    '-dash',
    // '_under' left with sec-a L3: a leading _ is the runtime-state mark (test/sec-a-names.test.ts)
    '2026 social 3',
    'A22B',
    'x'.repeat(60),
  ])('canvas and folder accept: %s', (n) => {
    expect(validateCanvasName(n).ok).toBe(true);
    expect(validateCanvasName(n).name).toBe(n);
    expect(validateFolderName(n).ok).toBe(true);
    // the same string is a legal sync path component, so a v1 peer lands it where it belongs
    expect(COMPONENT.test(n)).toBe(true);
  });

  test('the accepted set IS the sync set: the client regex and the server regex have one source', () => {
    expect(ALLOWED_NAME_RE.source).toBe(COMPONENT.source);
    for (const n of [
      'ok name',
      'a—b',
      'Přihlášení',
      'a.b',
      ' lead',
      'a/b',
      '日本',
      'A{2+2}B',
      '-dash',
    ]) {
      expect(ALLOWED_NAME_RE.test(n)).toBe(COMPONENT.test(n));
    }
  });

  test.each([
    [CANVAS_EXAMPLE, SUGGESTED],
    ['Přihlášení — první krok', 'Prihlaseni - prvni krok'],
    ['Q1 – plan', 'Q1 - plan'],
    ['Summer camp (v2) & friends', 'Summer camp v2 friends'],
    ["Tereza's 50% off, really!", 'Terezas 50 off really'],
    ['A{2+2}B', 'A22B'],
    ['Mix {a} of $things', 'Mix a of things'],
    ['a/b', 'ab'],
    ['Plan: draft', 'Plan draft'],
    ['.hidden', 'hidden'],
    ['a\tb', 'ab'],
  ])('refused in CONTRACT words with a suggestion: %s', (n, suggestion) => {
    for (const v of [validateCanvasName(n), validateFolderName(n)]) {
      expect(v.ok).toBe(false);
      expect(v.suggestion).toBe(suggestion);
      expect(v.error).toBe(`${NAME_RULE} Try “${suggestion}”.`);
    }
    // the client folds the same way
    expect(suggestName(n)).toBe(suggestion);
    expect(foldToAllowedName(n)).toBe(suggestion);
  });

  test('the words are the contract words and carry no engineering line', () => {
    expect(NAME_RULE).toBe('Names can use letters, numbers, spaces, - and _.');
    expect(nameRefusal('Combine - test barev')).toBe(
      'Names can use letters, numbers, spaces, - and _. Try “Combine - test barev”.'
    );
    expect(nameRefusal('')).toBe(
      'Names can use letters, numbers, spaces, - and _. Try another name.'
    );
  });

  test.each([
    ['..'],
    ['日本語のキャンバス'],
    ['***'],
    ['...'],
  ])('nothing left after the fold offers no suggestion: %s', (n) => {
    const v = validateCanvasName(n);
    expect(v.ok).toBe(false);
    expect(v.suggestion).toBeUndefined();
    expect(v.error).toBe(`${NAME_RULE} Try another name.`);
  });

  test('a suggestion never runs past the longest name and never starts or ends with a space', () => {
    const v = validateCanvasName(`${'x'.repeat(59)} —tail`);
    expect(v.ok).toBe(false);
    expect([...(v.suggestion ?? '')].length).toBeLessThanOrEqual(60);
    expect(v.suggestion).toBe(v.suggestion?.trim());
  });

  test('NFD input is folded the same as NFC', () => {
    expect(validateCanvasName('Cafe\u0301 menu').ok).toBe(false);
    expect(validateCanvasName('Cafe\u0301 menu').suggestion).toBe('Cafe menu');
  });

  test('the empty name and the long name each have their own words', () => {
    expect(validateCanvasName('   ').error).toBe('Give it a name.');
    expect(validateCanvasName('x'.repeat(61)).error).toBe('Names are 60 characters or fewer.');
    expect(validateCanvasName('x'.repeat(60)).ok).toBe(true);
  });

  test('the server words and the client words are the same words; the client offers the suggestion', () => {
    expect(RENAME_WORDS.rule).toBe(NAME_RULE);
    expect(RENAME_WORDS.refusal('X y')).toBe(nameRefusal('X y'));
    expect(RENAME_WORDS.refusal('')).toBe(nameRefusal(''));
    expect(checkRename({ draft: CANVAS_EXAMPLE, current: 'x' })).toEqual({
      kind: 'error',
      error: nameRefusal(SUGGESTED),
      suggestion: SUGGESTED,
    });
    expect(checkRename({ draft: SUGGESTED, current: 'x' })).toEqual({
      kind: 'rename',
      name: SUGGESTED,
    });
  });

  test('the client offers no suggestion that is empty or that collides with a sibling', () => {
    expect(checkRename({ draft: '日本語', current: 'x' })).toEqual({
      kind: 'error',
      error: nameRefusal(''),
    });
    // “Combine - test barev” is already a sibling: not offered
    const taken = new Set(['combine - test barev']);
    expect(checkRename({ draft: CANVAS_EXAMPLE, current: 'x', siblings: taken })).toEqual({
      kind: 'error',
      error: nameRefusal(''),
    });
    // a sibling that shares its sync key with the suggestion (case only): not offered either
    const close = new Set(['x']) as Set<string> & { closeKeys: Map<string, string> };
    close.closeKeys = new Map([[closeKey(SUGGESTED), 'COMBINE - Test Barev']]);
    expect(checkRename({ draft: CANVAS_EXAMPLE, current: 'y', siblings: close })).toEqual({
      kind: 'error',
      error: nameRefusal(''),
    });
  });
});

describe('the name reaches JSX text and the header comment safely', () => {
  test('the template still escapes { } & (harmless belt-and-braces); an allowed name lands raw', () => {
    expect(nameForTemplate('A {b} & c')).toBe('A &#123;b&#125; &amp; c');
    const name = 'Mix a b';
    const v = validateCanvasName(name);
    expect(v.ok).toBe(true);
    const common = {
      name,
      componentName: v.componentName as string,
      dsName: 'x',
      platform: 'desktop',
      historyDir: 'h',
    };
    const brief = renderBriefBoard({ ...common, seedHint: 'hint' });
    const blank = renderBlankCanvas(common);
    for (const src of [brief, blank]) {
      expect(src).toContain(`@canvas      ${name}`);
    }
    expect(brief).toContain('Mix a b');
  });
});

describe('an accepted name lands where it belongs on the other planes (a v1 peer must not break)', () => {
  const rel = `ui/${SUGGESTED}.tsx`;

  test('git status keeps the whole name (NUL-delimited parse)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's123c-git-'));
    const { spawnSync } = await import('node:child_process');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync(
      'git',
      [
        '-c',
        'user.email=a@b.c',
        '-c',
        'user.name=t',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'root',
      ],
      { cwd: dir }
    );
    spawnSync('mkdir', ['-p', join(dir, 'ui')]);
    writeFileSync(join(dir, rel), 'export default function X() { return null; }\n');
    const st = await gitStatus(dir, {});
    expect(st.files.map((f) => f.path)).toContain(rel);
  });

  test.each([
    SUGGESTED,
    'Summer camp 2026',
    'a_b-c',
    '-dash',
  ])('sync: the path of “%s” passes the receiver check as written — no flat fallback', (n) => {
    const path = `ui/${n}.tsx`;
    const slug = canvasSlugFromRel(path, '.design');
    expect(validateCanvasPath({ path, slug, canvasGroups: [{ path: 'ui' }] })).toEqual({
      ok: true,
      rel: path,
    });
  });

  test('sync: the name this task refuses WOULD have been refused by the receiver (why it is refused)', () => {
    const path = `ui/${CANVAS_EXAMPLE}.tsx`;
    const slug = canvasSlugFromRel(path, '.design');
    expect(validateCanvasPath({ path, slug, canvasGroups: [{ path: 'ui' }] }).ok).toBe(false);
  });

  test('file plane: a canvas body is canvas-owned or never, never an inert/companion file', () => {
    const cls = classifyProjectFile(rel, { canvasGroups: [{ path: 'ui' }] });
    expect(['canvas-owned', 'never']).toContain(cls);
  });
});
