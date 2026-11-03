// 2.0.2 — `withJournalMedia`: a materializing cell's journal media joins the closure's listing.
// The hub is semi-trusted (DDR-054): only inert-media names are added, and the closure's own
// rules still decide what a canvas reads. Integration: test/cell-ds-asset-closure.test.ts.

import { describe, expect, test } from 'bun:test';
import { closureFor, type ProjectReader } from '../access/closure.ts';
import { withJournalMedia } from '../access/request.ts';
import type { Access } from '../access/scope.ts';

const CONFIG = JSON.stringify({
  canvasGroups: [
    { label: 'System', path: 'system' },
    { label: 'UI', path: 'ui' },
  ],
  designSystems: [
    { name: 'alligators', path: 'system/alligators' },
    { name: 'other', path: 'system/other' },
  ],
  defaultDesignSystem: 'alligators',
});

function memReader(files: Record<string, string>, head = 'h1'): ProjectReader {
  return {
    head: () => head,
    list: () => Object.keys(files),
    text: (rel) => files[rel] ?? null,
    listTruncated: () => false,
    present: (rel) => rel in files,
    unlisted: () => [],
  };
}

const DISK = {
  'config.json': CONFIG,
  'system/alligators/colors_and_type.css': ':root{}',
  'ui/events.tsx':
    "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n",
};

const access = { grants: [{ c: 'ui/events.tsx', r: 'member' }] } as unknown as Access;

describe('withJournalMedia', () => {
  test('lists the journal media after the disk, once each', () => {
    const r = withJournalMedia(memReader(DISK), () => [
      'system/alligators/assets/logos/mark-white.svg',
      'system/alligators/colors_and_type.css', // a disk file — not media, and never twice
    ]);
    r.head();
    const listed = [...r.list()];
    expect(listed.filter((f) => f === 'system/alligators/colors_and_type.css')).toHaveLength(1);
    expect(listed).toContain('system/alligators/assets/logos/mark-white.svg');
    expect(r.present?.('system/alligators/assets/logos/mark-white.svg')).toBe(true);
  });

  test('a hostile listing adds no module, stylesheet, config, runtime state or dot name', () => {
    const hostile = [
      'ui/evil.tsx',
      'system/alligators/_ds.tsx',
      'system/alligators/tokens.css',
      'config.json',
      '_state/x.png',
      'system/alligators/.hidden/x.png',
      '../escape.png',
    ];
    const r = withJournalMedia(memReader({}), () => hostile);
    r.head();
    const listed = new Set(r.list());
    for (const rel of hostile)
      expect({ rel, listed: listed.has(rel) }).toEqual({ rel, listed: false });
  });

  test('head moves when the listing changes, not when the same answer repeats', () => {
    let rels: string[] | null = null;
    const r = withJournalMedia(memReader(DISK), () => rels);
    const h0 = r.head();
    rels = ['system/alligators/assets/a.png'];
    const h1 = r.head();
    expect(h1).not.toBe(h0);
    rels = ['system/alligators/assets/a.png']; // a new array, the same names
    expect(r.head()).toBe(h1);
  });

  test("the closure holds the canvas's own system media, not another system's", () => {
    const media = [
      'system/alligators/assets/logos/mark-white.svg',
      'system/other/assets/logos/mark.svg',
      'assets/zzzz0001.png',
    ];
    const before = closureFor(access, memReader(DISK));
    expect(before.read.has(media[0] as string)).toBe(false); // the 2.0.1 bug, in-process
    const c = closureFor(
      access,
      withJournalMedia(memReader(DISK), () => media)
    );
    expect(c.read.has('system/alligators/assets/logos/mark-white.svg')).toBe(true);
    expect(c.read.has('system/other/assets/logos/mark.svg')).toBe(false);
    expect(c.read.has('assets/zzzz0001.png')).toBe(false);
  });
});
