// #206 §5 (DDR-250) — a worktree tab is never linked. The app tells its server `MAUDE_WORKTREE_OF=<main>`;
// GET /_api/sync/link names the main project (the Share sheet says "Syncs from <main>", no button) and
// POST /_api/sync/link/confirm refuses even the owner, even with something waiting — so a person cannot
// make the worktree a second linked copy by hand either.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyClaim, resolveAccess } from '../access/scope.ts';
import { createCloudMoveRoutes } from '../routes/cloud-move.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import { WORKTREE_ENV, worktreeOf } from '../shell/worktree.ts';

const owner = () => resolveAccess(legacyClaim('owner'));
const routes = (wt: string | null, confirmed: string[]) =>
  createSyncRoutes({
    control: () => null,
    trace: {} as never,
    access: owner,
    worktreeOf: () => wt,
    link: {
      pending: () => ({ host: 'team.example.com' }),
      confirm: async () => {
        confirmed.push('yes');
        return { ok: true };
      },
    } as never,
  });
const post = () =>
  new Request('http://x/', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });

describe('a worktree tab never links', () => {
  test('the env names the main project, cleaned; absent or empty is no worktree', () => {
    expect(worktreeOf({ [WORKTREE_ENV]: '  Atlas  ' })).toBe('Atlas');
    expect(worktreeOf({ [WORKTREE_ENV]: 'At‮las\u0007' })).toBe('Atlas');
    expect(worktreeOf({ [WORKTREE_ENV]: '' })).toBeNull();
    expect(worktreeOf({})).toBeNull();
  });

  test('GET names the main project and no pending link; Connect is refused for the owner', async () => {
    const confirmed: string[] = [];
    const r = routes('Atlas', confirmed);
    const get = r.find((x) => x.path === '/_api/sync/link');
    const body = await (await get?.handle(new Request('http://x/'), {}))?.json();
    expect(body).toEqual({ pending: null, worktreeOf: 'Atlas' });
    const confirm = r.find((x) => x.path === '/_api/sync/link/confirm');
    const res = (await confirm?.handle(post(), {})) as Response;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'worktree' });
    expect(confirmed).toEqual([]);
  });

  // #206 T6.3g — Move to cloud would make the worktree a second linked copy: refused server-side,
  // before the body, the job file or any call to Maude Cloud.
  test('Move to cloud is refused for a worktree before anything is spent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-wt-move-'));
    const calls: string[] = [];
    const move = (wt: string | null) =>
      createCloudMoveRoutes({
        designRoot: dir,
        projectName: () => 'Atlas',
        localFormat: () => 2,
        cloud: { openManaged: async () => ({}) as never, attachStored: async () => ({}) as never },
        cloudConfigPath: () => join(dir, 'no-cloud.json'),
        hubsConfigPath: join(dir, 'no-hubs.json'),
        fetchImpl: (async (u: string) => {
          calls.push(String(u));
          return new Response('{}', { status: 500 });
        }) as never,
        worktreeOf: () => wt,
      }).find((x) => x.method === 'POST' && x.path === '/_api/cloud/move');
    try {
      const res = (await move('Atlas')?.handle(post(), {})) as Response;
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: 'worktree',
        error: 'This folder syncs from Atlas. Move Atlas to the cloud instead.',
      });
      expect(calls).toEqual([]);
      expect(existsSync(join(dir, '_state', 'cloud-move.json'))).toBe(false);
      // An ordinary folder goes on as today (here: no Maude Cloud sign-in on this profile).
      const plain = (await move(null)?.handle(post(), {})) as Response;
      expect(plain.status).toBe(401);
      expect(await plain.json()).toMatchObject({ reason: 'signed-out' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an ordinary project keeps today’s answers', async () => {
    const confirmed: string[] = [];
    const r = routes(null, confirmed);
    const get = r.find((x) => x.path === '/_api/sync/link');
    expect(await (await get?.handle(new Request('http://x/'), {}))?.json()).toEqual({
      pending: { host: 'team.example.com' },
    });
    const confirm = r.find((x) => x.path === '/_api/sync/link/confirm');
    const ok = (await confirm?.handle(post(), {})) as Response;
    expect(ok.status).toBe(200);
    expect(confirmed).toEqual(['yes']);
  });
});
