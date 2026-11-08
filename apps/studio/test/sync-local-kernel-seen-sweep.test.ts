// #168 T5.4 S1 (D) — the local kernel's `seen` map (each lane's value on disk when last read or
// written here) no longer grows for every canvas a session ever touched. An idle sweep drops an
// entry only when it is idle AND the lane's store head hash equals it AND the disk holds it —
// exactly when a missing entry decides the same way (the watcher then compares the disk with the
// head and takes the head's blob as the base). The oracle: two identical projects run the same
// steps, one swept and one not, and every action, label and lane they record is the same.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const tsx = (text: string) => `export default () => <p>${text}</p>;\n`;
const meta = (title: string) => `${JSON.stringify({ title }, null, 2)}\n`;
const quiet = { warn() {}, error() {} };
const IDLE = 10 * 60_000;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-seen-sweep-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  for (const n of ['a', 'b', 'c'])
    writeFileSync(path.join(designRoot, 'ui', `${n}.tsx`), tsx(`${n}0`));
  writeFileSync(path.join(designRoot, 'ui', 'a.meta.json'), meta('A'));
  const file = (rel: string) => path.join(designRoot, rel);
  return {
    designRoot,
    read: (rel: string) => readFileSync(file(rel), 'utf8'),
    write: (rel: string, body: string) => writeFileSync(file(rel), body),
  };
}

function open(designRoot: string, clock: { t: number }) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    log: quiet,
    aiSettleMs: 0,
    now: () => clock.t,
    seenIdleMs: IDLE,
    seenSweepMs: 0, // the test sweeps by hand
  });
  homes.push(h);
  return h;
}

type P = ReturnType<typeof project>;
const edit = async (p: P, h: LocalHome, rel: string, body: string) => {
  p.write(rel, body);
  h.observe(rel);
  await h.flush();
};

/** What a project recorded: every action (kind, label, canvases) and every lane on disk. */
async function recorded(p: P, h: LocalHome) {
  const rows = (await h.runtime.acceptedHistory({})).map((r) => [r.kind, r.label, r.canvases]);
  const disk = ['ui/a.tsx', 'ui/a.meta.json', 'ui/b.tsx', 'ui/c.tsx'].map((r) => p.read(r));
  const versions = await Promise.all(
    ['ui/a.tsx', 'ui/b.tsx', 'ui/c.tsx'].map(async (r) => {
      const [head] = await h.runtime.acceptedHistory({ path: `.design/${r}` });
      return h.runtime.acceptedVersion(`.design/${r}`, head.revision);
    })
  );
  return { rows, disk, versions };
}

describe('the seen map is swept when idle, and no merge result changes', () => {
  test('the same steps, swept or not, record the same actions and the same lanes', async () => {
    const run = async (sweep: boolean) => {
      const clock = { t: 1_000_000 };
      const p = project();
      const h = open(p.designRoot, clock);
      await h.ready();
      await edit(p, h, 'ui/a.tsx', tsx('a1'));
      await edit(p, h, 'ui/a.meta.json', meta('A one'));
      await edit(p, h, 'ui/b.tsx', tsx('b1'));
      // c changes on disk while nobody reads it: its entry must survive a sweep
      await edit(p, h, 'ui/c.tsx', tsx('c1'));
      p.write('ui/c.tsx', tsx('c2'));

      clock.t += IDLE + 1;
      const dropped = sweep ? await h.sweepSeen() : [];

      // after the sweep: an outside edit, a studio edit, an undo, a restore, an echo, and c's read
      await edit(p, h, 'ui/a.tsx', tsx('a2'));
      h.noteWritten('ui/b.tsx', tsx('b2'), 'Edit text');
      await edit(p, h, 'ui/b.tsx', tsx('b2'));
      const [last] = await h.runtime.acceptedHistory({ path: '.design/ui/b.tsx' });
      expect((await h.runtime.acceptedUndo(last.actionId)).status).toBe('accepted');
      await edit(p, h, 'ui/b.tsx', p.read('ui/b.tsx')); // the undo's own echo records nothing
      const base = (await h.runtime.acceptedHistory({ path: '.design/ui/a.tsx' })).at(-1);
      expect(
        (await h.runtime.acceptedRestore('.design/ui/a.tsx', base?.revision ?? 0)).status
      ).toBe('accepted');
      await edit(p, h, 'ui/a.meta.json', meta('A two'));
      h.observe('ui/c.tsx');
      await h.flush();
      return { dropped, out: await recorded(p, h), h, p, clock };
    };

    const swept = await run(true);
    const plain = await run(false);
    // the sweep dropped the idle, agreed entries; c's (the disk moved on unread) stayed…
    expect(swept.dropped).toEqual(['ui/a.tsx|html', 'ui/a.tsx|meta', 'ui/b.tsx|html']);
    expect(plain.dropped).toEqual([]);
    // …and nothing either project recorded differs
    expect(swept.out).toEqual(plain.out);
    expect(swept.out.disk[3]).toBe(tsx('c2'));
    expect(swept.out.versions[2]).toBe(tsx('c2'));
  });

  test('a run’s staged bytes (on disk, not in the store) keep their entry: the run still lands as one ai action', async () => {
    const two = (o: { foot?: string; title?: string } = {}) =>
      `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <div>
      <DCArtboard id="p" width={100} height={100}>
        <h1>${o.title ?? 'P title'}</h1>
        <p>keep one</p>
        <footer>${o.foot ?? 'P foot'}</footer>
      </DCArtboard>
    </div>
  );
}
`;
    const run = async (sweep: boolean) => {
      const clock = { t: 1_000_000 };
      const p = project();
      p.write('ui/k.tsx', two());
      const h = open(p.designRoot, clock);
      await h.ready();
      h.runtime.beginAiAction('acp:c1', 'Footer', { runId: 'r_s1', chatId: 'c1' });
      const ai = two({ foot: 'P foot AI' });
      p.write('ui/k.tsx', ai);
      h.runtime.claimAiWrite('acp:c1', '.design/ui/k.tsx', hashBytes(ai));
      h.observe('ui/k.tsx');
      await h.flush();
      clock.t += IDLE + 1;
      const dropped = sweep ? await h.sweepSeen() : [];
      // the person's edit on top of the staged bytes, then the run ends
      const mine = two({ foot: 'P foot AI', title: 'P title MINE' });
      p.write('ui/k.tsx', mine);
      h.noteWritten('ui/k.tsx', mine);
      h.observe('ui/k.tsx');
      await h.flush();
      expect((await h.runtime.endAiAction('acp:c1', 'done'))?.status).toBe('accepted');
      const rows = (await h.runtime.acceptedHistory({ path: '.design/ui/k.tsx' })).map((r) => [
        r.kind,
        r.label,
      ]);
      const [top] = await h.runtime.acceptedHistory({ path: '.design/ui/k.tsx' });
      const head = await h.runtime.acceptedVersion('.design/ui/k.tsx', top.revision);
      expect((await h.runtime.acceptedUndo(top.actionId)).status).toBe('accepted');
      return { dropped, rows, head, afterUndo: p.read('ui/k.tsx') };
    };
    const swept = await run(true);
    const plain = await run(false);
    expect(swept.dropped).not.toContain('ui/k.tsx|html');
    expect(swept.rows.map((r) => r[0])).toEqual(['ai', 'edit', 'migration.import']);
    expect({ ...swept, dropped: [] }).toEqual({ ...plain, dropped: [] });
  });

  test('an entry is kept while it is not idle, or while the disk disagrees with it', async () => {
    const clock = { t: 1_000_000 };
    const p = project();
    const h = open(p.designRoot, clock);
    await h.ready();
    await edit(p, h, 'ui/a.tsx', tsx('a1'));
    await edit(p, h, 'ui/b.tsx', tsx('b1'));
    clock.t += IDLE - 1;
    expect(await h.sweepSeen()).toEqual([]); // not idle yet
    p.write('ui/a.tsx', tsx('a2')); // the disk moved on without a read
    clock.t += 2;
    const swept = await h.sweepSeen();
    expect(swept).toContain('ui/b.tsx|html');
    expect(swept).not.toContain('ui/a.tsx|html');
    clock.t += IDLE + 1;
    expect(await h.sweepSeen()).toEqual([]); // a's entry stays as long as the disk disagrees
    // the kept entry still decides the read
    h.observe('ui/a.tsx');
    await h.flush();
    const [row] = await h.runtime.acceptedHistory({ path: '.design/ui/a.tsx' });
    expect(await h.runtime.acceptedVersion('.design/ui/a.tsx', row.revision)).toBe(tsx('a2'));
  });

  test('a read refreshes an entry: it is idle from its last use, not from its first write', async () => {
    const clock = { t: 1_000_000 };
    const p = project();
    const h = open(p.designRoot, clock);
    await h.ready();
    await edit(p, h, 'ui/a.tsx', tsx('a1'));
    await edit(p, h, 'ui/b.tsx', tsx('b1'));
    clock.t += IDLE - 10;
    await edit(p, h, 'ui/a.tsx', tsx('a1')); // a read of unchanged bytes uses a's entry
    clock.t += 20;
    const first = await h.sweepSeen();
    expect(first).toContain('ui/b.tsx|html');
    expect(first).not.toContain('ui/a.tsx|html');
    clock.t += IDLE;
    expect(await h.sweepSeen()).toContain('ui/a.tsx|html');
  });
});
