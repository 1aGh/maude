// S10.12 × S10.3 (V2-1.6 §5.15 cross-plane order): a conversion — and its Restore — reaches a peer as
// plain files on Plane B with no order across them. Whichever lands first (head.json, or the
// re-emitted tokens.json, R0 and the Design system canvas), the receiving peer ends converted (or
// back to its folder) with NO outside-change review, ever. Both directions: the peer that converts
// and the peer that receives swap roles in the second half.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDsConvert } from '../ds/convert.ts';
import { createDsEngine } from '../ds/engine.ts';
import { createDsOutsideWatcher, type OutsideReview } from '../ds/outside.ts';

const DS = 'acme';
const DIR = 'system/acme';
const PERSON = { kind: 'person', name: 'Tereza' } as const;
const QUIET = 120;
const gap = () => new Promise((r) => setTimeout(r, 25));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function files(root: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = readdirSync(path.join(root, rel));
  } catch {
    return out;
  }
  for (const e of names) {
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(path.join(root, r)).isDirectory()) Object.assign(out, files(root, r));
    else out[r] = readFileSync(path.join(root, r), 'utf8');
  }
  return out;
}

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-convert-peer-'));
  dirs.push(root);
  const d = path.join(root, '.design');
  const w = (rel: string, t: string) => {
    mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    writeFileSync(path.join(d, rel), t);
  };
  w(
    'config.json',
    `${JSON.stringify({ designSystems: [{ name: DS, path: DIR, rootClass: DS, themes: ['light', 'dark'], themeDefault: 'light' }], defaultDesignSystem: DS, canvasGroups: [{ path: 'ui' }, { path: 'system' }] }, null, 2)}\n`
  );
  w(
    `${DIR}/colors_and_type.css`,
    `:root,\n.${DS}[data-theme="light"] {\n  --accent: oklch(0.55 0.2 255);\n}\n\n.${DS}[data-theme="dark"] {\n  --accent: oklch(0.65 0.2 255);\n}\n`
  );
  w(`${DIR}/preview/_components.css`, '.btn {\n  border-radius: 4px;\n}\n');
  w(`${DIR}/preview/logo.tsx`, 'export default () => <b>logo</b>;\n');
  w('ui/Home.tsx', 'export default () => <h1>Home</h1>;\n');
  return d;
}

const engineOf = (designRoot: string) =>
  createDsEngine({ designRoot, kernel: null, log: { warn() {}, error() {} } });

/** A copy of `from` as another Mac holds it (runtime state stays behind). */
function peerOf(from: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-convert-peer-b-'));
  dirs.push(root);
  const to = path.join(root, '.design');
  // per-Mac runtime state (`_history/`, `_trash/`, `_state/` …) stays behind; `preview/_components.css` travels
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !path.relative(from, src).split(path.sep)[0]?.startsWith('_'),
  });
  return to;
}

/**
 * Deliver what changed in `src`'s system folder (writes and removals) to `dst`, head.json first or
 * last, through the watcher. Returns what the peer showed meanwhile and how it ended.
 */
async function deliver(
  dst: string,
  before: Record<string, string>,
  after: Record<string, string>,
  order: 'head-first' | 'head-last'
) {
  const engine = engineOf(dst);
  const reviews: Array<OutsideReview | null> = [];
  const w = createDsOutsideWatcher({
    designRoot: dst,
    engine,
    quietMs: QUIET,
    gitHead: () => null,
    onChange: (_ds, r) => reviews.push(r),
  });
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => before[k] !== after[k]
  );
  const head = keys.filter((k) => k === 'revisions/head.json');
  const rest = keys.filter((k) => k !== 'revisions/head.json');
  const queue = order === 'head-first' ? [...head, ...rest] : [...rest, ...head];
  const shown: unknown[] = [];
  let midOutside = 0;
  try {
    for (const k of queue) {
      const abs = path.join(dst, DIR, k);
      if (after[k] === undefined) rmSync(abs, { force: true });
      else {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, after[k]);
      }
      w.notify(`${DIR}/${k}`, { kind: 'peer', name: 'Mac A' });
      const st = engine.state(DS);
      if (st.outside || st.baseMissing) midOutside += 1;
      shown.push(w.review(DS));
      await gap();
    }
    await new Promise((r) => setTimeout(r, QUIET * 3));
    shown.push(w.review(DS));
  } finally {
    w.stop();
  }
  return { keys, midOutside, shown, reviews, final: engine.state(DS) };
}

describe('ds convert — reaching a peer', () => {
  for (const order of ['head-first', 'head-last'] as const) {
    test(`Mac A converts, Mac B receives ${order}: B ends converted with no review; then B restores and A receives`, async () => {
      const a = project();
      const b = peerOf(a);
      const sysA = path.join(a, DIR);
      const sysB = path.join(b, DIR);
      // A → B: the conversion
      const before = files(sysA);
      const r = await createDsConvert(engineOf(a)).convert({ by: PERSON });
      const R0 = r.result.systems[0].rev;
      const after = files(sysA);
      const toB = await deliver(b, before, after, order);
      expect(toB.keys).toContain('revisions/head.json');
      expect(toB.keys).toContain('tokens.json');
      expect(toB.keys).toContain('design-system.tsx');
      // head first: the half-delivered folder reads as an outside change (or a missing base) on its own;
      // head last: the system stays a folder until its head lands — the benign order
      if (order === 'head-first') expect(toB.midOutside).toBeGreaterThan(0);
      else expect(toB.midOutside).toBe(0);
      expect(toB.shown.every((x) => x === null)).toBe(true);
      expect(toB.reviews.filter((x) => x !== null)).toEqual([]);
      expect(toB.final).toMatchObject({ converted: true, head: R0, base: R0, outside: null });
      expect(files(sysB)).toEqual(after);

      // B → A (the other direction): Restore on B reaches A
      const bBefore = files(sysB);
      await createDsConvert(engineOf(b)).restore({ ds: DS, by: PERSON });
      const bAfter = files(sysB);
      expect(bAfter['revisions/head.json']).toBeUndefined();
      const toA = await deliver(a, bBefore, bAfter, order);
      expect(toA.keys).toContain('revisions/head.json');
      expect(toA.shown.every((x) => x === null)).toBe(true);
      expect(toA.reviews.filter((x) => x !== null)).toEqual([]);
      expect(toA.final).toMatchObject({ converted: false, outside: null });
      expect(files(sysA)).toEqual(bAfter);
      expect(existsSync(path.join(sysA, 'revisions', `${R0}.json`))).toBe(true);
      expect(files(sysA)['colors_and_type.css']).toBe(before['colors_and_type.css']);
    }, 20_000);
  }
});
