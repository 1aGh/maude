// S10.3 (V2-1.6 §5.10, §5.15 cross-plane order, I #4): Plane B carries no order across files, so a
// peer receiving a publish sees `revisions/head.json` before or after the working files. Mid-way
// the working files differ from whatever `base` is on disk — but the folder is not quiet yet, and
// once everything has landed the working files equal the new base. Both orders: no review, ever.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createDsEngine } from '../ds/engine.ts';
import { createDsOutsideWatcher, type OutsideReview } from '../ds/outside.ts';
import { ACCENT, cleanup, DS, DS_PATH, makeProject, PERSON } from './_ds-engine-fixture.ts';

afterAll(cleanup);

function files(root: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(path.join(root, rel))) {
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(path.join(root, r)).isDirectory()) Object.assign(out, files(root, r));
    else out[r] = readFileSync(path.join(root, r), 'utf8');
  }
  return out;
}

const QUIET = 120;
const gap = () => new Promise((r) => setTimeout(r, 25));

async function deliverPublish(order: 'head-first' | 'head-last') {
  const a = await makeProject({ machine: 'm_a' });
  // peer B: the same project before the publish (its own Mac, no kernel needed to read)
  const bRoot = path.join(a.root, 'peer-b');
  mkdirSync(bRoot, { recursive: true });
  cpSync(a.designRoot, path.join(bRoot, '.design'), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}_`),
  });
  const bDesign = path.join(bRoot, '.design');
  const before = files(path.join(bDesign, DS_PATH));

  await a.engine.mergePending(DS, {
    tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
    by: PERSON,
  });
  await a.engine.publish(DS, { expectHead: a.R0, by: PERSON });
  const after = files(a.dsAbs);
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  expect(changed).toContain('revisions/head.json');
  expect(changed).toContain('colors_and_type.css');

  const engineB = createDsEngine({
    designRoot: bDesign,
    kernel: null,
    log: { warn() {}, error() {} },
  });
  const reviews: Array<OutsideReview | null> = [];
  const w = createDsOutsideWatcher({
    designRoot: bDesign,
    engine: engineB,
    quietMs: QUIET,
    gitHead: () => null,
    onChange: (_ds, r) => reviews.push(r),
  });
  const shown: unknown[] = [];
  const headFirst = order === 'head-first';
  // the hard orders: pointer + revision before the working files, or the working files first
  const revs = changed.filter((k) => k.startsWith('revisions/') && k !== 'revisions/head.json');
  const work = changed.filter((k) => !k.startsWith('revisions/'));
  const queue = headFirst
    ? ['revisions/head.json', ...revs, ...work]
    : [...work, ...revs, 'revisions/head.json'];
  let midOutside = 0;
  try {
    for (const k of queue) {
      const abs = path.join(bDesign, DS_PATH, k);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, after[k] as string);
      w.notify(`${DS_PATH}/${k}`, { kind: 'peer', name: 'Mac A' });
      // the engine alone sees the half-delivered folder as an outside change …
      if (engineB.state(DS).outside) midOutside += 1;
      // … the watcher shows nothing while it settles
      shown.push(w.review(DS));
      await gap();
    }
    await new Promise((r) => setTimeout(r, QUIET * 3));
    shown.push(w.review(DS));
  } finally {
    w.stop();
  }
  return { midOutside, shown, reviews, final: engineB.state(DS) };
}

describe('ds — no spurious review on the receiving peer', () => {
  for (const order of ['head-first', 'head-last'] as const) {
    test(`Plane B delivered ${order}: no review, the peer ends at the publisher's head`, async () => {
      const r = await deliverPublish(order);
      expect(r.midOutside).toBeGreaterThan(0); // the reorder is real
      expect(r.shown.every((x) => x === null)).toBe(true);
      expect(r.reviews.filter((x) => x !== null)).toEqual([]);
      expect(r.final.outside).toBeNull();
      expect(r.final.head).toBe(r.final.base);
    }, 20_000);
  }
});
