// S4.1 — `maude migrate v2` and the board's format-2 data (V2-1.12 §5.10,
// `annotations.check`). Forward accepts a board carrying format-2 fields and
// types (they parse with `dropped: []`). A plain reverse keeps them (a 1.x
// reader preserves them, P2). `--reverse --strip` removes every format-2 field
// and every format-2 type and reports each in `lost`; the stripped board is a
// format-1 board — nothing in it a 1.x registry does not name.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ballotId } from '../annotations/elements/ballot.model.ts';
import { stampId } from '../annotations/elements/stamp.model.ts';
import { FORMAT2_TYPES, specOf, withFormat1Reader } from '../annotations/registry.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';
import { EXIT, planMigration } from '../migrate/engine.ts';
import { fixtureProject, opts, type Project, run } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});
const read = (rel: string) => readFileSync(path.join((p as Project).design, rel), 'utf8');
const write = (rel: string, s: string) => writeFileSync(path.join((p as Project).design, rel), s);

const AT = '2026-10-01T10:00:00Z';
const BOARD = 'strip.annotations.json';
const FORMAT2 = [
  {
    id: 's1',
    type: 'sticky',
    index: 'a0',
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    text: 'keep the text',
    parentArtboard: 'hero',
    resolved: { by: 'Jonas', at: AT },
    timeRange: { artboard: 'reel', start: 1, end: 2 },
  },
  {
    id: 's2',
    type: 'sticky',
    index: 'a1',
    x: 300,
    y: 0,
    w: 200,
    h: 120,
    source: { kind: 'figjam', author: 'Ana' },
    parentArtboard: 'hero',
  },
  { id: 'sec', type: 'section', index: 'a2', x: 0, y: 400, w: 600, h: 300, folded: true },
  {
    id: 'ar',
    type: 'arrow',
    index: 'a3',
    start: { x: 200, y: 60 },
    end: { x: 900, y: 60 },
    startHost: { ref: 'el:hero/cta', label: 'CTA' },
    endHost: { ref: 'ab:mobile', label: 'Mobile' },
  },
  {
    id: 'img',
    type: 'image',
    index: 'a4',
    x: 0,
    y: 0,
    w: 80,
    h: 80,
    href: 'assets/star.png',
    sticker: { pack: 'figjam-doodle', id: 'star' },
  },
  {
    id: stampId({ spot: 's1', author: 'u_ana', kind: 'heart' }),
    type: 'stamp',
    index: 'a5',
    x: 180,
    y: 0,
    w: 32,
    h: 32,
    kind: 'heart',
    target: 's1',
  },
  { id: 'vote1', type: 'vote', index: 'a6', targets: ['ab:dir-a', 'ab:dir-b'] },
  {
    id: ballotId('vote1', 'u_ana'),
    type: 'ballot',
    index: 'a7',
    vote: 'vote1',
    voter: 'u_ana',
    picks: { 'ab:dir-a': 2 },
  },
];
const boardText = () => serializeBoard(validateElements(FORMAT2).elements);

describe('annotations.check with format-2 boards', () => {
  test('forward: a format-2 board passes the check (nothing dropped, nothing refused)', async () => {
    p = fixtureProject();
    write(BOARD, boardText());
    const plan = await planMigration(opts(p));
    const step = plan.steps.find((s) => s.id === 'annotations.check');
    expect(step?.refusals).toEqual([]);
    expect(parseBoard(read(BOARD)).dropped).toEqual([]);
  });

  test('plain reverse keeps every format-2 field and type (lossless)', async () => {
    p = fixtureProject();
    await run(opts(p));
    write(BOARD, boardText());
    const rev = await run(opts(p, { direction: 'reverse' }));
    expect(rev.exitCode).toBe(EXIT.done);
    expect(rev.steps.flatMap((s) => s.lost)).toEqual([]);
    expect(read(BOARD)).toBe(boardText());
  });

  test('--strip removes every format-2 field and type, and reports each in `lost`', async () => {
    p = fixtureProject();
    await run(opts(p));
    write(BOARD, boardText());
    const rev = await run(opts(p, { direction: 'reverse', strip: true }));
    expect(rev.exitCode).toBe(EXIT.done);
    const lost = rev.steps
      .flatMap((s) => s.lost)
      .filter((l) => l.path === BOARD)
      .map((l) => `${l.field}:${l.count}`)
      .sort();
    expect(lost).toEqual([
      'endHost:1',
      'folded:1',
      'parentArtboard:2',
      'resolved:1',
      'source:1',
      'startHost:1',
      'sticker:1',
      'timeRange:1',
      'type:ballot:1',
      'type:stamp:1',
      'type:vote:1',
    ]);
    // The stripped board is a format-1 board: what a 1.x registry names, nothing else.
    const after = withFormat1Reader(() => parseBoard(read(BOARD)));
    expect(after.dropped).toEqual([]);
    for (const el of after.elements) {
      expect(FORMAT2_TYPES.has(el.type)).toBe(false);
      const spec = specOf(el.type) ?? {};
      for (const k of Object.keys(el)) expect(Object.hasOwn(spec, k)).toBe(true);
    }
    // What format 1 understands survives: the text, and the arrow drawn frozen at its cached ends.
    const els = new Map(after.elements.map((e) => [e.id, e]));
    expect(els.get('s1')?.text).toBe('keep the text');
    expect(els.get('ar')).toMatchObject({ start: { x: 200, y: 60 }, end: { x: 900, y: 60 } });
    // Byte-stable under both readers.
    expect(serializeBoard(parseBoard(read(BOARD)).elements)).toBe(read(BOARD));
  });

  test('--strip dry run reports the same and writes nothing; a second strip has nothing to lose', async () => {
    p = fixtureProject();
    await run(opts(p));
    write(BOARD, boardText());
    const dry = await planMigration(opts(p, { direction: 'reverse', strip: true }));
    expect(dry.steps.flatMap((s) => s.lost).filter((l) => l.path === BOARD).length).toBe(11);
    expect(read(BOARD)).toBe(boardText());
    await run(opts(p, { direction: 'reverse', strip: true }));
    // Back at format 1 — re-migrate, then strip again: nothing left to lose.
    await run(opts(p));
    const again = await run(opts(p, { direction: 'reverse', strip: true }));
    expect(again.steps.flatMap((s) => s.lost).filter((l) => l.path === BOARD)).toEqual([]);
  });
});
