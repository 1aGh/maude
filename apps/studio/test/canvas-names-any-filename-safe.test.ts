// S1.23 G2 — lead decision `v2-lead-canvas-names-any-filename-safe`: a canvas or folder name is ANY
// filename-safe text. Only path separators, the reserved characters, control characters, a leading dot
// and the empty name are refused — in CONTRACT words, not an engineering line.
//
// Also pins what an unusual name does to the other planes: it must not break the git status parse, the
// sync canvas-path check (a refused path degrades to a flat fallback, never throws — so a v1 peer
// that receives it loses nothing), or the file plane's membership (not a member = stays local).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NAME_REFUSAL,
  nameForTemplate,
  renderBlankCanvas,
  renderBriefBoard,
  validateCanvasName,
  validateFolderName,
} from '../canvas-create.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { checkRename, RENAME_WORDS } from '../client/v2/canvases/rename-model.js';
import { gitStatus } from '../git/service.ts';
import { fallbackCanvasPath, validateCanvasPath } from '../sync/canvas-path.ts';
import { classifyProjectFile } from '../sync/file-membership.ts';

const CANVAS_EXAMPLE = 'Combine — test barev';

describe('names accept any filename-safe text', () => {
  test.each([
    CANVAS_EXAMPLE,
    'Přihlášení — první krok',
    'Summer camp (v2) & friends',
    "Tereza's 50% off, really!",
    '2026 · social #3 [draft]',
    'Wait... what',
    '日本語のキャンバス',
    'Mix {a} of $things',
  ])('canvas and folder: %s', (n) => {
    expect(validateCanvasName(n).ok).toBe(true);
    expect(validateCanvasName(n).name).toBe(n.normalize('NFC'));
    expect(validateFolderName(n).ok).toBe(true);
  });

  test.each([
    ['a/b', 'separator'],
    ['a\\b', 'separator'],
    ['Plan: draft', 'colon'],
    ['what*', 'star'],
    ['why?', 'question'],
    ['say "hi"', 'quote'],
    ['<b>', 'angle'],
    ['a|b', 'pipe'],
    ['a\tb', 'tab'],
    ['a\nb', 'newline'],
    ['a\u0000b', 'NUL'],
    ['a\u202eb', 'bidi override'],
    ['.hidden', 'leading dot'],
    ['..', 'dot dot'],
  ])('refused in CONTRACT words: %s (%s)', (n) => {
    for (const v of [validateCanvasName(n), validateFolderName(n)]) {
      expect(v.ok).toBe(false);
      expect(v.error).toBe(NAME_REFUSAL);
    }
  });

  test('the empty name and the long name each have their own words', () => {
    expect(validateCanvasName('   ').error).toBe('Give it a name.');
    expect(validateCanvasName('x'.repeat(61)).error).toBe('Names are 60 characters or fewer.');
    expect(validateCanvasName('x'.repeat(60)).ok).toBe(true);
  });

  test('the server words and the client words are the same words', () => {
    expect(RENAME_WORDS.reserved).toBe(NAME_REFUSAL);
    expect(checkRename({ draft: 'a:b', current: 'x' })).toEqual({
      kind: 'error',
      error: NAME_REFUSAL,
    });
    expect(checkRename({ draft: CANVAS_EXAMPLE, current: 'x' })).toEqual({
      kind: 'rename',
      name: CANVAS_EXAMPLE,
    });
  });
});

describe('the name reaches JSX text and the header comment safely', () => {
  test('{ } & are escaped in JSX text and left raw in the header comment', () => {
    expect(nameForTemplate('A {b} & c')).toBe('A &#123;b&#125; &amp; c');
    const name = 'Mix {a} & —';
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
    // nothing in the JSX body (below the header comment) is a live expression out of the name
    expect(brief.slice(brief.indexOf('*/'))).not.toContain('{a}');
    expect(brief).toContain('Mix &#123;a&#125; &amp; —');
  });
});

describe('an unusual name does not break the other planes (a v1 peer must not break)', () => {
  const rel = `ui/${CANVAS_EXAMPLE}.tsx`;

  test('git status keeps the whole name (NUL-delimited parse)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's123-git-'));
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
      {
        cwd: dir,
      }
    );
    spawnSync('mkdir', ['-p', join(dir, 'ui')]);
    writeFileSync(join(dir, rel), 'export default function X() { return null; }\n');
    const st = await gitStatus(dir, {});
    expect(st.files.map((f) => f.path)).toContain(rel);
  });

  test('sync: a path outside the wire charset is refused (not thrown) and falls back to a flat name', () => {
    const slug = canvasSlugFromRel(rel, '.design');
    const verdict = validateCanvasPath({ path: rel, slug, canvasGroups: [{ path: 'ui' }] });
    expect(verdict.ok).toBe(false);
    const flat = fallbackCanvasPath(slug, [{ path: 'ui' }]);
    expect(flat.endsWith('.tsx')).toBe(true);
    expect(
      validateCanvasPath({
        path: flat,
        slug: canvasSlugFromRel(flat, '.design'),
        canvasGroups: [{ path: 'ui' }],
      }).ok
    ).toBe(true);
  });

  test('file plane: a canvas body is canvas-owned or never, never an inert/companion file', () => {
    const cls = classifyProjectFile(rel, { canvasGroups: [{ path: 'ui' }] });
    expect(['canvas-owned', 'never']).toContain(cls);
  });
});
