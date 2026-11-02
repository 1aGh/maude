// S10.3 (V2-1.6 §5.10–§5.11 a): an edit to a converted system's working files made outside the
// studio becomes ONE review once the folder has been quiet for W = 5 s, attributed to who made it
// — "Claude Code" when the design plugin's post-edit hook recorded the file, the git author when
// HEAD moved, a peer when the file plane delivered it, else unknown. Never while it settles.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAccess } from '../access/scope.ts';
import { createDsOutsideWatcher, OUTSIDE_QUIET_MS, type OutsideReview } from '../ds/outside.ts';
import { createDsRoutes } from '../routes/ds.ts';
import {
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  type Project,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const CSS = `${DS_PATH}/colors_and_type.css`;
const edited = () => TOKENS_CSS.replace(/--fg-0:[^;]+;/, '--fg-0: oklch(0.31 0.02 255);');

/** what cli/lib/design-hook.mjs recordTouch writes after Claude Code's Edit tool */
function hookTouch(p: Project, rel: string, at = Date.now()) {
  const dir = path.join(p.designRoot, '_runs', 'sess-1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'touched.json'),
    JSON.stringify({ [rel]: { at, by: 'main', via: 'tool', artboards: null } })
  );
}

describe('ds outside watcher', () => {
  test(`a Claude Code edit to the CSS shows as a review attributed "Claude Code" within ${OUTSIDE_QUIET_MS + 300} ms`, async () => {
    const p = await makeProject();
    const seen: Array<{ at: number; review: OutsideReview | null }> = [];
    const w = createDsOutsideWatcher({
      designRoot: p.designRoot,
      engine: p.engine,
      gitHead: () => null,
      onChange: (_ds, review) => seen.push({ at: Date.now(), review }),
    });
    try {
      const t0 = Date.now();
      p.write(CSS, edited());
      hookTouch(p, CSS);
      w.notify(CSS);
      expect(w.review(DS)).toBeNull(); // still settling
      while (!seen.length && Date.now() - t0 < OUTSIDE_QUIET_MS + 2_000)
        await new Promise((r) => setTimeout(r, 25));
      expect(seen.length).toBe(1);
      expect(seen[0].at - t0).toBeLessThanOrEqual(OUTSIDE_QUIET_MS + 300);
      const r = seen[0].review as OutsideReview;
      expect(r.kind).toBe('ds-outside');
      expect(r.files).toEqual([
        {
          path: 'colors_and_type.css',
          source: { kind: 'agent', name: 'Claude Code' },
          at: expect.any(String),
        },
      ]);
      expect(r.changes.map((c) => c.css)).toEqual(['--fg-0']);
      // the attribution is kept per Mac, keyed by the file's bytes
      const stored = JSON.parse(
        readFileSync(path.join(p.designRoot, '_state', 'ds-outside', `${DS}.json`), 'utf8')
      );
      expect(stored).toMatchObject({ format: 'maude.ds-outside', v: 1, system: DS, base: p.R0 });
      expect(stored.files[0].source).toEqual({ kind: 'agent', name: 'Claude Code' });
    } finally {
      w.stop();
    }
  }, 15_000);

  test('the state route shows the review only after the quiet window, with its attribution', async () => {
    const p = await makeProject();
    let t = 1_000_000;
    const w = createDsOutsideWatcher({
      designRoot: p.designRoot,
      engine: p.engine,
      now: () => t,
      gitHead: () => null,
    });
    const [state] = createDsRoutes({
      engine: () => p.engine,
      outside: () => w,
      access: () => resolveAccess({ v: 1, role: 'member' }),
      person: async () => ({ name: 'Michal' }),
    }).filter((s) => s.path === '/_api/ds/state');
    const get = async () =>
      (
        (await (
          await state.handle(new Request(`http://localhost/_api/ds/state?ds=${DS}`), {})
        ).json()) as {
          systems: Array<{ outside: unknown }>;
        }
      ).systems[0].outside;
    try {
      p.write(CSS, edited());
      w.notify(CSS);
      t += OUTSIDE_QUIET_MS - 1;
      expect(await get()).toBeNull();
      t += 1;
      expect(await get()).toEqual({
        files: [
          { path: 'colors_and_type.css', source: { kind: 'unknown' }, at: expect.any(String) },
        ],
        changes: [expect.objectContaining({ css: '--fg-0' })],
        otherChanges: [],
      });
    } finally {
      w.stop();
    }
  });

  test('attribution: a peer delivery, then git (HEAD moved), else unknown; Keep clears it', async () => {
    const p = await makeProject();
    let t = 5_000_000;
    let head = 'aaa';
    const w = createDsOutsideWatcher({
      designRoot: p.designRoot,
      engine: p.engine,
      now: () => t,
      gitHead: () => head,
      gitAuthor: () => 'Jonas',
    });
    try {
      expect(w.evaluate(DS)).toBeNull(); // first look: remember HEAD
      p.write(CSS, edited());
      w.notify(CSS, { kind: 'peer', name: 'Jonas’s Mac' });
      t += OUTSIDE_QUIET_MS;
      expect(w.review(DS)?.files[0].source).toEqual({ kind: 'peer', name: 'Jonas’s Mac' });

      // a different change after a pull: git
      const p2 = await makeProject();
      const w2 = createDsOutsideWatcher({
        designRoot: p2.designRoot,
        engine: p2.engine,
        now: () => t,
        gitHead: () => head,
        gitAuthor: () => 'Jonas',
      });
      w2.evaluate(DS);
      head = 'bbb';
      p2.write(CSS, edited());
      w2.notify(CSS);
      t += OUTSIDE_QUIET_MS;
      expect(w2.review(DS)?.files[0].source).toEqual({ kind: 'git', name: 'Jonas' });
      w2.stop();

      // Keep: base := the working files → nothing to review, the record goes
      await p.engine.keepOutside(DS, { by: { kind: 'person', name: 'Michal' } });
      w.notify(CSS);
      t += OUTSIDE_QUIET_MS;
      expect(w.review(DS)).toBeNull();
      expect(existsSync(path.join(p.designRoot, '_state', 'ds-outside', `${DS}.json`))).toBe(false);
    } finally {
      w.stop();
    }
  });
});
