// S5.15 — every accepted action reaches the shell as `project:action` (sync/action-feed.ts): a person's edit
// — yours or a teammate's — was never announced, so "Made by AI" could not clear on the next person's edit.
import { describe, expect, test } from 'bun:test';
import { createActionFeed } from '../sync/action-feed.ts';

const art = (p: string, s: string) => `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <div>
      <DCArtboard id="p" width={10} height={10}>
        <h1>${p}</h1>
      </DCArtboard>
      <DCArtboard id="s" width={10} height={10}>
        <h1>${s}</h1>
      </DCArtboard>
    </div>
  );
}
`;

function fakeRuntime() {
  const versions = new Map<number, string>([[1, art('P', 'S')]]);
  const rows: Record<string, unknown>[] = [
    {
      revision: 1,
      actionId: 'a1',
      actor: 'you',
      mine: true,
      kind: 'migration.import',
      canvases: ['ui/k.tsx'],
    },
  ];
  return {
    versions,
    rows,
    add(row: Record<string, unknown>, body?: string) {
      rows.unshift(row);
      if (body) versions.set(row.revision as number, body);
      else versions.set(row.revision as number, versions.get((row.revision as number) - 1) ?? '');
    },
    runtime: {
      acceptedHistory: async () => rows.slice(),
      acceptedVersion: async (repoRel: string, rev: number) => {
        expect(repoRel).toBe('.design/ui/k.tsx');
        return versions.get(rev) ?? null;
      },
    },
  };
}

describe('the action feed', () => {
  test('never replays the log; announces each new action once, with the artboards it changed', async () => {
    const f = fakeRuntime();
    const out: Record<string, unknown>[] = [];
    const feed = createActionFeed({
      control: () => f.runtime,
      designRel: '.design',
      emit: (e, p) => e === 'project:action' && out.push(p as Record<string, unknown>),
    });
    await feed.flush();
    expect(out).toEqual([]); // the boot read only sets where it starts
    f.add(
      {
        revision: 2,
        actionId: 'a2',
        actor: 'tereza',
        mine: false,
        kind: 'edit',
        canvases: ['ui/k.tsx'],
      },
      art('P', 'S by Tereza')
    );
    await feed.flush();
    await feed.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      actionId: 'a2',
      kind: 'edit',
      mine: false,
      actor: 'tereza',
      artboards: { 'ui/k.tsx': ['s'] },
    });
    feed.stop();
  });

  test('what the run hooks or the undo route already announced is not announced again', async () => {
    const f = fakeRuntime();
    const out: Record<string, unknown>[] = [];
    const subs: Array<(p: unknown) => void> = [];
    const feed = createActionFeed({
      control: () => f.runtime,
      designRel: '.design',
      emit: (_e, p) => out.push(p as Record<string, unknown>),
      on: (_e, fn) => {
        subs.push(fn);
        return () => {};
      },
    });
    await feed.flush();
    f.add(
      { revision: 2, actionId: 'r2', actor: 'you', mine: true, kind: 'ai', canvases: ['ui/k.tsx'] },
      art('P by AI', 'S')
    );
    for (const fn of subs) fn({ actionId: 'r2' }); // the stage hook's own announcement
    f.add({
      revision: 3,
      actionId: 'c3',
      actor: 'you',
      mine: true,
      kind: 'comment',
      canvases: ['ui/k.tsx'],
    });
    await feed.flush();
    expect(out.map((o) => [o.actionId, o.artboards])).toEqual([['c3', {}]]);
    feed.stop();
  });

  test('a poke reads the log after a beat — and once more when the proposal has been accepted', async () => {
    const f = fakeRuntime();
    const out: string[] = [];
    const feed = createActionFeed({
      control: () => f.runtime,
      designRel: '.design',
      emit: (_e, p) => out.push((p as { actionId: string }).actionId),
      debounceMs: 5,
      settleMs: 60,
    });
    await feed.flush();
    feed.poke();
    await new Promise((r) => setTimeout(r, 20));
    // the hub accepts the edit only now
    f.add(
      {
        revision: 2,
        actionId: 'a2',
        actor: 'you',
        mine: true,
        kind: 'edit',
        canvases: ['ui/k.tsx'],
      },
      art('P mine', 'S')
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(out).toEqual(['a2']);
    feed.stop();
  });
});
