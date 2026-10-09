// V2-1.12 §5.12 — `maude migrate v2` on the Alligators-scale fixture:
// dry-run writes nothing (I1), forward, forward again = exit 10 (I4), reverse
// restores the tree byte for byte (I5), and v2 edits survive a plain reverse
// and are reported exactly by `--strip`. Plus the real-tree lane
// (MAUDE_MIGRATE_REAL_TREE, skipped when unset, never committed data).

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { DsTokensEmitter } from '../migrate/ds-registry.ts';
import { EXIT, planMigration } from '../migrate/engine.ts';
import {
  fixtureProject,
  fullTreeHash,
  listTree,
  opts,
  type Project,
  realTreeProject,
  run,
} from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const read = (rel: string) => readFileSync(path.join((p as Project).design, rel), 'utf8');
const write = (rel: string, s: string) => writeFileSync(path.join((p as Project).design, rel), s);

/** The bytes-only list of what differs (for a readable failure). */
function diffTrees(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of after)
    if (before.get(k) !== v) out.push(before.has(k) ? `~ ${k}` : `+ ${k}`);
  for (const k of before.keys()) if (!after.has(k)) out.push(`- ${k}`);
  return out;
}
function snapshotTree(design: string): Map<string, string> {
  return new Map(listTree(design).map((f) => [f, readFileSync(path.join(design, f), 'utf8')]));
}

async function roundtrip(project: Project) {
  const before = snapshotTree(project.design);
  const h0 = fullTreeHash(project.design);

  const dry = await planMigration(opts(project));
  expect(dry.refusals).toEqual([]);
  expect(dry.steps.filter((s) => s.status === 'refused')).toEqual([]);
  expect(dry.exitCode).toBe(EXIT.done);
  expect(fullTreeHash(project.design)).toBe(h0); // I1 — nothing written anywhere
  expect(existsSync(path.join(project.design, '_state', 'migrate-v2.lock'))).toBe(false);

  const fwd = await run(opts(project));
  expect(fwd.exitCode).toBe(EXIT.done);
  expect(fwd.snapshot).toMatch(/^_history\/_migrate\/v2-/);
  expect(
    JSON.parse(readFileSync(path.join(project.design, 'config.json'), 'utf8')).formatVersion
  ).toBe(2);
  const h1 = fullTreeHash(project.design);

  const again = await run(opts(project));
  expect(again.exitCode).toBe(EXIT.atTarget); // I4
  expect(again.steps.every((s) => s.status === 'noop' || s.status === 'skip')).toBe(true);
  expect(fullTreeHash(project.design)).toBe(h1);

  const rev = await run(opts(project, { direction: 'reverse' }));
  expect(rev.exitCode).toBe(EXIT.done);
  // I5 — byte for byte (excluding only the migrator's own snapshots).
  expect(diffTrees(before, snapshotTree(project.design))).toEqual([]);
  expect(fullTreeHash(project.design)).toBe(h0);
  return { dry, fwd, rev };
}

describe('maude migrate v2 — the fixture', () => {
  test('dry-run → forward → idempotent → exact reverse', async () => {
    p = fixtureProject();
    const { dry, fwd } = await roundtrip(p);
    const step = (id: string) => fwd.steps.find((s) => s.id === id);
    expect(step('project.marker')?.files).toEqual([
      expect.objectContaining({ path: 'config.json', action: 'modify' }),
    ]);
    expect(step('annotations.check')?.status).toBe('noop');
    expect(step('meta.check')?.status).toBe('noop');
    expect(step('comps.tracks')?.status).toBe('noop');
    expect(step('chats.canvas')?.files).toHaveLength(9); // 9 chats name a canvas
    // 7 SRTs with media → 7 transcripts; 3 bare whisper dumps → trash; 1 orphan noted
    expect(step('transcripts.import')?.files.filter((f) => f.action === 'create')).toHaveLength(7);
    expect(step('transcripts.import')?.files.filter((f) => f.action === 'remove')).toHaveLength(3);
    expect(step('transcripts.import')?.notes.join(' ')).toContain('deadbeef.srt');
    expect(step('ds.tokens')?.status).toBe('skip'); // V2-2.15 has not landed
    // one line of config.json changed, nothing else in it
    expect(dry.totals).toMatchObject({ modify: 1 + 5, create: 4 + 7, remove: 3, refused: 0 });
  });

  test('budgets: dry-run ≤ 3 s, apply ≤ 10 s, report ≤ 256 KB', async () => {
    p = fixtureProject();
    const dry = await planMigration(opts(p));
    expect(dry.durationMs).toBeLessThanOrEqual(3000);
    expect(JSON.stringify(dry).length).toBeLessThanOrEqual(256 * 1024);
    const t = performance.now();
    await run(opts(p));
    expect(performance.now() - t).toBeLessThanOrEqual(10_000);
  });

  test('v2 edits after forward: a plain reverse keeps them (lossless), --strip reports them exactly', async () => {
    for (const strip of [false, true]) {
      p = fixtureProject();
      await run(opts(p));
      // Scripted v2 edits: resolve a sticky, set present.order, add artboardMeta.
      const boardRel = readdirSync(p.design).find(
        (f) =>
          f.endsWith('.annotations.json') &&
          parseBoard(read(f)).elements.some((e) => e.type === 'sticky')
      ) as string;
      const board = parseBoard(read(boardRel)).elements;
      const sticky = board.find((e) => e.type === 'sticky') as Record<string, unknown>;
      sticky.resolved = true;
      write(boardRel, serializeBoard(board));
      const metaRel = 'ui/c00.meta.json';
      const meta = JSON.parse(read(metaRel));
      meta.present = { order: ['b1', 'b0'] };
      meta.artboardMeta = { b0: { notes: 'Opening slide' } };
      write(metaRel, `${JSON.stringify(meta, null, 2)}\n`);

      const rev = await run(opts(p, { direction: 'reverse', strip }));
      expect(rev.exitCode).toBe(EXIT.done);
      // every board still parses whole in a 1.x reader
      for (const f of readdirSync(p.design).filter((n) => n.endsWith('.annotations.json')))
        expect(parseBoard(read(f)).dropped).toEqual([]);
      const lost = rev.steps.flatMap((s) => s.lost);
      if (!strip) {
        expect(lost).toEqual([]);
        expect(parseBoard(read(boardRel)).elements.find((e) => e.id === sticky.id)).toMatchObject({
          resolved: true,
        });
        expect(JSON.parse(read(metaRel))).toMatchObject({ present: { order: ['b1', 'b0'] } });
      } else {
        expect(lost.sort((a, b) => a.field.localeCompare(b.field))).toEqual([
          { path: metaRel, field: 'artboardMeta', count: 1 },
          { path: metaRel, field: 'present', count: 1 },
          { path: boardRel, field: 'resolved', count: 1 },
        ]);
        expect(JSON.parse(read(metaRel)).present).toBeUndefined();
      }
      expect(JSON.parse(read('config.json')).formatVersion).toBeUndefined();
      p.dispose();
      p = null;
    }
  });

  test('ds.tokens through the registry seam: emitted when absent, idempotent, reversed exactly', async () => {
    p = fixtureProject();
    const emitter: DsTokensEmitter = {
      registryVersion: 1,
      emitTokens: ({ system, read: r }) => {
        const css = r(system.tokensCssRel);
        if (!css) return { refused: 'no tokens stylesheet' };
        return {
          bytes: new TextEncoder().encode(
            `${JSON.stringify({ $extensions: { 'sh.maude': { schemaVersion: 1, system: system.name } }, cssBytes: css.length }, null, 2)}\n`
          ),
        };
      },
    };
    const h0 = fullTreeHash(p.design);
    const fwd = await run(opts(p, { dsEmitter: emitter }));
    const ds = fwd.steps.find((s) => s.id === 'ds.tokens');
    expect(ds?.files.map((f) => f.path)).toEqual([
      'system/alligators/tokens.json',
      'system/private-ds/tokens.json',
    ]);
    expect(ds?.notes).toEqual(['skeleton: no tokens stylesheet']);
    expect((await run(opts(p, { dsEmitter: emitter }))).exitCode).toBe(EXIT.atTarget);
    await run(opts(p, { direction: 'reverse', dsEmitter: emitter }));
    expect(fullTreeHash(p.design)).toBe(h0);
  });

  test('the legacy variant: the DDR-242 board conversion runs first (and is not reversed)', async () => {
    p = fixtureProject({ legacy: true });
    const svg = readdirSync(p.design).find((f) => f.endsWith('.annotations.svg')) as string;
    const dry = await planMigration(opts(p));
    expect(dry.steps.find((s) => s.id === 'annotations.check')?.files).toEqual([
      expect.objectContaining({ path: svg.replace('.svg', '.json'), action: 'create' }),
    ]);
    const fwd = await run(opts(p));
    expect(fwd.exitCode).toBe(EXIT.done);
    expect(existsSync(path.join(p.design, svg))).toBe(false);
    expect(parseBoard(read(svg.replace('.svg', '.json'))).dropped).toEqual([]);
    expect((await run(opts(p))).exitCode).toBe(EXIT.atTarget);
  });
});

const REAL = process.env.MAUDE_MIGRATE_REAL_TREE;
describe.skipIf(!REAL)('maude migrate v2 — the real tree (unlinked copy)', () => {
  test('dry-run → forward → idempotent → exact reverse on a copy of the real project', async () => {
    p = realTreeProject(REAL as string);
    const { fwd } = await roundtrip(p);
    console.log(
      `[real tree] ${fwd.steps.map((s) => `${s.id}=${s.status}/${s.filesTotal ?? s.files.length}`).join(' ')} · ${fwd.durationMs} ms`
    );
  }, 900_000); // copying the ~10 GB tree (heads only for big files) takes minutes
});
