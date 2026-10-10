// V2-2.19 — the done-when of the plan row "Stable element ids": a rewrite fixture keeps every id.
// Contract: apps/studio/client/v2/contracts/V2-1.4-element-ids.md §5.3/§5.4 (check + safe
// re-attach), §6 (the measured rewrite set), §7 T1/T5/T6.
//
//   1. An AI rewrite that follows the skill rule (keep every `data-cd-*` on what you keep) keeps
//      every id, and `checkIds` passes it with no error.
//   2. An AI that forgets ids is caught: every dropped id is in `lostIds`; the ones the safe matcher
//      can prove are `id-lost` errors at the new element's line; `fix` puts exactly those back, on
//      the right element, and never hands an old id to an inserted element.
//   3. The §6 corpus simulation (T6) on the v2 canvases: zero wrong attachments, typical ≥ 60 %.
//      `V2_IDS_CORPUS=all` runs the whole `.design` corpus and prints the §6 table.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkIds } from '../element-ids.ts';
import {
  applyRecipe,
  artboardsOf,
  dropIds,
  idsByGt,
  makeRng,
  RECIPES,
  type Rng,
  tagAll,
  tagGroundTruth,
} from './_ai-rewrite-sim.ts';

const FIXTURE = join(import.meta.dir, 'fixtures/element-ids/rewrite.tsx');
const STRUCTURAL = new Set(['DesignCanvas', 'DCSection', 'DCArtboard']);

/** Ground truth on every element + an authored id on every non-structural one that lacks one. */
function prepare(file: string, raw: string): string {
  const tagged = tagGroundTruth(file, raw);
  return tagAll(file, tagged, 'data-cd-id', (e) =>
    !e.cdId && e.gt && !STRUCTURAL.has(e.tag) ? `e-${e.gt}` : null
  );
}

const pickAb = (rng: Rng, abs: string[]) => abs[Math.floor(rng.next() * abs.length)] as string;
/** The rewrite inserts bare `<div className="ai-new|ai-wrap">`; a fix would stamp right after the tag. */
const INSERTED_WITH_ID = /<div data-cd-id="[^"]*" className="ai-(?:new|wrap)/g;

describe('V2-2.19 rewrite fixture keeps every id', () => {
  const raw = readFileSync(FIXTURE, 'utf8');
  const old = prepare(FIXTURE, raw);
  const oldIds = idsByGt(FIXTURE, old);
  const abs = artboardsOf(FIXTURE, old);

  test('the fixture is clean before any rewrite', () => {
    expect(abs).toEqual(['home', 'pricing', 'signup']);
    const r = checkIds(old, { against: old, path: 'rewrite.tsx' });
    expect(r.parseError).toBeUndefined();
    expect(r.findings).toEqual([]);
    expect(r.lostIds).toEqual([]);
  });

  for (const recipe of RECIPES) {
    test(`${recipe.name}: a rule-following rewrite keeps every id and passes the check`, () => {
      const rng = makeRng(0x51ab + recipe.name.length);
      for (let trial = 0; trial < 12; trial++) {
        const ab = pickAb(rng, abs);
        const next = applyRecipe(rng, FIXTURE, old, ab, recipe);
        const nextIds = idsByGt(FIXTURE, next);
        // every kept element still carries its id
        for (const [gt, id] of nextIds) expect(id).toBe(oldIds.get(gt) ?? null);
        const gone = [...oldIds].filter(([gt, id]) => id && !nextIds.has(gt)).map(([, id]) => id);
        const r = checkIds(next, { against: old, path: 'rewrite.tsx' });
        expect(r.parseError).toBeUndefined();
        expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
        expect([...r.lostIds].sort()).toEqual([...gone].sort() as string[]);
        expect(r.findings.map((f) => f.code).every((c) => c === 'id-removed')).toBe(true);
        expect(r.reattach).toEqual([]);
      }
    });
  }

  test('a dropped id is caught, and fix=safe puts back only what it can prove', () => {
    const tally = { dropped: 0, right: 0, wrong: 0, newGotOld: 0, typicalDropped: 0, typicalRight: 0 };
    const rng = makeRng(0x2190);
    for (const recipe of RECIPES) {
      for (let trial = 0; trial < 8; trial++) {
        const ab = pickAb(rng, abs);
        const next = applyRecipe(rng, FIXTURE, old, ab, recipe);
        for (const p of [0.1, 0.3, 1.0]) {
          const { source: partial, droppedGt } = dropIds(rng, FIXTURE, next, ab, p);
          const r = checkIds(partial, { against: old, fix: true, path: 'rewrite.tsx' });
          expect(r.parseError).toBeUndefined();
          const droppedIds = [...droppedGt].map((gt) => oldIds.get(gt));
          for (const id of droppedIds) expect(r.lostIds).toContain(id as string);
          // `id-lost` names exactly the ids the safe plan re-attaches, at the new element's line
          const lost = r.findings.filter((f) => f.code === 'id-lost');
          expect(lost.map((f) => f.id).sort()).toEqual(r.reattach.map((x) => x.id).sort());
          for (const f of lost) {
            expect(f.severity).toBe('error');
            expect(f.where).toBe(`rewrite.tsx:${f.line}:${f.col}`);
            expect(r.reattach.find((x) => x.id === f.id)?.line).toBe(f.line);
          }
          expect(typeof r.fixed).toBe('string');
          const fixedIds = idsByGt(FIXTURE, r.fixed as string);
          const partialIds = idsByGt(FIXTURE, partial);
          for (const [gt, id] of fixedIds) {
            if (partialIds.get(gt) === id) continue; // untouched by the fix
            if (droppedGt.has(gt)) {
              if (id === oldIds.get(gt)) tally.right++;
              else tally.wrong++;
            } else tally.wrong++;
          }
          // an element the rewrite inserted (no ground truth) never inherits an id
          tally.newGotOld += ((r.fixed as string).match(INSERTED_WITH_ID) ?? []).length;
          tally.dropped += droppedGt.size;
          if (recipe.name === 'typical') {
            tally.typicalDropped += droppedGt.size;
            tally.typicalRight += [...fixedIds].filter(
              ([gt, id]) => droppedGt.has(gt) && id === oldIds.get(gt)
            ).length;
          }
          // after the fix, nothing the matcher can prove is still lost
          const again = checkIds(r.fixed as string, { against: old, path: 'rewrite.tsx' });
          expect(again.findings.filter((f) => f.severity === 'error')).toEqual([]);
        }
      }
    }
    expect(tally.wrong).toBe(0);
    expect(tally.newGotOld).toBe(0);
    expect(tally.dropped).toBeGreaterThan(50);
    expect(tally.typicalRight / tally.typicalDropped).toBeGreaterThanOrEqual(0.6);
  });
});

// ── T6: the §6 corpus simulation ──────────────────────────────────────────────────────────
const DESIGN = join(import.meta.dir, '../../../.design');
function corpus(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name.startsWith('.') || name === 'node_modules') continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.tsx')) out.push(abs);
    }
  };
  walk(DESIGN);
  return out.sort();
}

describe('V2-2.19 §6 re-attach on the canvas corpus (T6)', () => {
  const all = process.env.V2_IDS_CORPUS === 'all';
  const files = corpus().filter((f) => all || f.includes('/ui/v2/'));

  test(
    `${all ? 'whole corpus' : 'v2 canvases'}: zero wrong attachments, typical ≥ 60 %`,
    () => {
      type T = { dropped: number; right: number; wrong: number; fresh: number; newGotOld: number };
      const res: Record<string, T> = {};
      const rng = makeRng();
      let ms = 0;
      let checks = 0;
      for (const f of files) {
        const raw = readFileSync(f, 'utf8');
        const abs = artboardsOf(f, raw);
        if (!abs.length) continue;
        let g = 0;
        const tagged = tagAll(f, raw, 'data-cd-gt', () => `g${g++}`);
        // the spike stamps every element (ground truth → id), the AI keeps them on kept elements
        const stamped = tagAll(f, tagged, 'data-cd-id', (e) => (e.gt && !e.cdId ? `e-${e.gt}` : null));
        const oldIds = idsByGt(f, stamped);
        for (const recipe of RECIPES) {
          const ab = pickAb(rng, abs);
          const next = applyRecipe(rng, f, stamped, ab, recipe);
          for (const p of [0.1, 0.3, 1.0]) {
            const key = `${recipe.name} p=${p}`;
            res[key] ??= { dropped: 0, right: 0, wrong: 0, fresh: 0, newGotOld: 0 };
            const R = res[key] as T;
            const { source: partial, droppedGt } = dropIds(rng, f, next, ab, p);
            const t0 = performance.now();
            const r = checkIds(partial, { against: stamped, fix: true, path: relative(DESIGN, f) });
            ms = Math.max(ms, performance.now() - t0);
            checks++;
            expect(r.parseError).toBeUndefined();
            const fixedIds = idsByGt(f, r.fixed as string);
            const partialIds = idsByGt(f, partial);
            for (const gt of droppedGt) {
              R.dropped++;
              const got = fixedIds.get(gt) ?? null;
              if (!got) R.fresh++;
              else if (got === oldIds.get(gt)) R.right++;
              else R.wrong++;
            }
            for (const [gt, id] of fixedIds)
              if (!droppedGt.has(gt) && partialIds.get(gt) !== id) R.wrong++;
            R.newGotOld += ((r.fixed as string).match(INSERTED_WITH_ID) ?? []).length;
          }
        }
      }
      const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');
      const lines = Object.entries(res).map(
        ([k, v]) =>
          `  ${k.padEnd(14)} dropped=${v.dropped} right ${pct(v.right, v.dropped)} · WRONG ${pct(v.wrong, v.dropped)} · fresh ${pct(v.fresh, v.dropped)} · new-el-got-old-id ${v.newGotOld}`
      );
      console.log(
        `V2-2.19 §6 re-attach — ${files.length} files, ${checks} checks, slowest two-sided check+fix ${ms.toFixed(0)} ms\n${lines.join('\n')}`
      );
      for (const v of Object.values(res)) {
        expect(v.wrong).toBe(0);
        expect(v.newGotOld).toBe(0);
      }
      const typ = Object.entries(res)
        .filter(([k]) => k.startsWith('typical') && !k.endsWith('p=1'))
        .reduce((a, [, v]) => ({ d: a.d + v.dropped, r: a.r + v.right }), { d: 0, r: 0 });
      expect(typ.r / typ.d).toBeGreaterThanOrEqual(0.6);
    },
    600_000
  );
});
