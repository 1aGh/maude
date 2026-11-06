// #207 — the import walk remembers each file's import groups by path AND full text (closure.ts
// `walkImportGroups`): a walk over unchanged files does not scan them again, and a changed file —
// even one changed with no new generation/head, the same length, or the same path — is scanned
// again, so a cached answer is always the answer a fresh scan gives.
import { beforeEach, describe, expect, test } from 'bun:test';

import { canvasImportsReport, importGroupsMemo, type ProjectReader } from '../access/closure.ts';

const CANVAS = (body: string) =>
  `import { DesignCanvas } from '@maude/canvas-lib';\n${body}\nexport default () => <DesignCanvas />;\n`;

function project(files: Record<string, string>, reads: string[]): ProjectReader {
  return {
    list: () => Object.keys(files),
    text: (rel) => {
      reads.push(rel);
      return files[rel] ?? null;
    },
    head: () => 'same-head-always',
    listTruncated: () => false,
    present: (rel) => rel in files,
    unlisted: () => [],
  };
}

beforeEach(() => importGroupsMemo.clear());

describe('import groups memo (#207)', () => {
  test('unchanged files are not scanned again; the answer is the same', () => {
    const files = {
      'ui/a.tsx': CANVAS(`import { H } from './helper.tsx';`),
      'ui/helper.tsx': `export const H = 1;`,
      'ui/b.tsx': CANVAS(''),
    };
    const reads: string[] = [];
    const first = canvasImportsReport(project(files, reads), ['ui/a.tsx', 'ui/b.tsx']);
    const scanned = importGroupsMemo.size();
    expect(scanned).toBeGreaterThan(0);
    const second = canvasImportsReport(project(files, reads), ['ui/a.tsx', 'ui/b.tsx']);
    expect([...second]).toEqual([...first]);
    expect(importGroupsMemo.size()).toBe(scanned); // no new entries: every file was a hit
  });

  test('a changed file is scanned again — same path, same head, same length', () => {
    const files: Record<string, string> = {
      'ui/a.tsx': CANVAS(`import { X } from './bbb.tsx';`),
      'ui/aaa.tsx': CANVAS(''),
      'ui/bbb.tsx': CANVAS(''),
    };
    const reads: string[] = [];
    // a imports the canvas bbb → refused
    expect(canvasImportsReport(project(files, reads), ['ui/a.tsx']).get('ui/a.tsx')).toEqual([
      'ui/bbb.tsx',
    ]);
    // the same length, another canvas: the memo must not answer from the old text
    files['ui/a.tsx'] = CANVAS(`import { X } from './aaa.tsx';`);
    expect(canvasImportsReport(project(files, reads), ['ui/a.tsx']).get('ui/a.tsx')).toEqual([
      'ui/aaa.tsx',
    ]);
    // and with no import at all, nothing is refused
    files['ui/a.tsx'] = CANVAS(`const nothing = './bbb.tsx';`);
    expect(
      canvasImportsReport(project(files, reads), ['ui/a.tsx']).get('ui/a.tsx')
    ).toBeUndefined();
  });
});
