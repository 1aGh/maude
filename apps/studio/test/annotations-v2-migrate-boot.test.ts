// annotations-v2 (DDR-242 §6) — the boot migration of board files.
import { describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateAnnotationsV2 } from '../annotations/migrate-boot.ts';
import { migrateSvg } from '../annotations/migrate-v1.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';

const FIX = join(import.meta.dir, 'fixtures');

function project(): string {
  return mkdtempSync(join(tmpdir(), 'ann-v2-boot-'));
}

describe('migrateAnnotationsV2', () => {
  test('converts every legacy board, keeps originals, then is a no-op', () => {
    const root = project();
    const sources = [
      join(FIX, 'phase-21-annotations.svg'),
      join(FIX, 'annotations-v2', 'mixed-200.v1.svg'),
      join(FIX, 'annotations-v2', 'ui-smoke.v1.svg'),
    ];
    for (const [i, src] of sources.entries())
      copyFileSync(src, join(root, `ui-b${i}.annotations.svg`));
    const lines: string[] = [];
    const first = migrateAnnotationsV2({ designRoot: root, log: (l) => lines.push(l) });
    expect(first.map((m) => m.action)).toEqual(['migrated', 'migrated', 'migrated']);
    sources.forEach((src, i) => {
      const board = readFileSync(join(root, `ui-b${i}.annotations.json`), 'utf8');
      expect(board).toBe(serializeBoard(migrateSvg(readFileSync(src, 'utf8')).elements));
      expect(parseBoard(board).dropped).toEqual([]);
      // Originals survive twice: history snapshot + trash.
      expect(
        readFileSync(
          join(root, '_history', `ui-b${i}`, 'pre-annotations-v2', `ui-b${i}.annotations.svg`),
          'utf8'
        )
      ).toBe(readFileSync(src, 'utf8'));
      expect(existsSync(join(root, '_trash', 'annotations-v1', `ui-b${i}.annotations.svg`))).toBe(
        true
      );
      expect(existsSync(join(root, `ui-b${i}.annotations.svg`))).toBe(false);
    });
    expect(migrateAnnotationsV2({ designRoot: root, log: () => {} })).toEqual([]);
    expect(lines.some((l) => l.includes('migrated ui-b0.annotations.svg'))).toBe(true);
  });

  test('a legacy board reappearing next to a v2 board is quarantined, never merged', () => {
    const root = project();
    writeFileSync(join(root, 'ui-x.annotations.json'), serializeBoard([]));
    copyFileSync(join(FIX, 'phase-21-annotations.svg'), join(root, 'ui-x.annotations.svg'));
    const r = migrateAnnotationsV2({ designRoot: root, log: () => {} });
    expect(r[0]?.action).toBe('stale-quarantined');
    expect(readFileSync(join(root, 'ui-x.annotations.json'), 'utf8')).toBe(serializeBoard([]));
    expect(
      readdirSync(join(root, '_trash', 'annotations-v1')).some((n) => n.startsWith('stale-'))
    ).toBe(true);
  });

  test('garbage SVG migrates to an empty board and keeps the original', () => {
    const root = project();
    writeFileSync(join(root, 'ui-bad.annotations.svg'), '<svg><script>alert(1)</script');
    const r = migrateAnnotationsV2({ designRoot: root, log: () => {} });
    expect(r[0]?.action).toBe('migrated');
    expect(readFileSync(join(root, 'ui-bad.annotations.json'), 'utf8')).toBe(serializeBoard([]));
    expect(
      existsSync(join(root, '_history', 'ui-bad', 'pre-annotations-v2', 'ui-bad.annotations.svg'))
    ).toBe(true);
  });

  test('a held lock makes a concurrent boot skip instead of racing', () => {
    const root = project();
    copyFileSync(join(FIX, 'phase-21-annotations.svg'), join(root, 'ui-y.annotations.svg'));
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(join(root, '_state'), { recursive: true });
    writeFileSync(join(root, '_state', 'annotations-v2-migrate.lock'), '1');
    expect(migrateAnnotationsV2({ designRoot: root, log: () => {} })).toEqual([]);
    expect(existsSync(join(root, 'ui-y.annotations.svg'))).toBe(true);
  });

  test('a second migration of the same slug never overwrites the first original (review M7)', () => {
    const root = project();
    const svg = readFileSync(join(FIX, 'annotations-v2', 'ui-smoke.v1.svg'), 'utf8');
    writeFileSync(join(root, 'ui-m.annotations.svg'), svg);
    migrateAnnotationsV2({ designRoot: root, log: () => {} });
    // The board is lost (e.g. a branch without it) and the v1 file comes back, different.
    rmSync(join(root, 'ui-m.annotations.json'));
    writeFileSync(join(root, 'ui-m.annotations.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    migrateAnnotationsV2({ designRoot: root, log: () => {} });
    const snaps = readdirSync(join(root, '_history', 'ui-m', 'pre-annotations-v2'));
    const trash = readdirSync(join(root, '_trash', 'annotations-v1'));
    expect(snaps).toHaveLength(2);
    expect(trash).toHaveLength(2);
    expect(
      readFileSync(
        join(root, '_history', 'ui-m', 'pre-annotations-v2', 'ui-m.annotations.svg'),
        'utf8'
      )
    ).toBe(svg);
  });

  test('a symlinked legacy file is not read; a _trash escaping the root gets no write (defender #3)', () => {
    const root = project();
    const outside = project();
    writeFileSync(join(outside, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    symlinkSync(join(outside, 'secret.svg'), join(root, 'ui-l.annotations.svg'));
    const r1 = migrateAnnotationsV2({ designRoot: root, log: () => {} });
    expect(r1.map((m) => m.action)).toEqual(['failed']);
    expect(existsSync(join(root, 'ui-l.annotations.json'))).toBe(false);

    const root2 = project();
    symlinkSync(outside, join(root2, '_trash'));
    writeFileSync(join(root2, 'ui-t.annotations.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const r2 = migrateAnnotationsV2({ designRoot: root2, log: () => {} });
    expect(r2.map((m) => m.action)).toEqual(['failed']);
    expect(readdirSync(outside)).toEqual(['secret.svg']);
    expect(existsSync(join(root2, 'ui-t.annotations.svg'))).toBe(true); // left in place
  });

  test('missing design root never throws', () => {
    expect(
      migrateAnnotationsV2({ designRoot: join(tmpdir(), 'no-such-dir-ann-v2'), log: () => {} })
    ).toEqual([]);
  });
});
