// 2.1.1 T7 — found by the accounts desktop e2e (hub-signin-return.e2e.ts): "Sign in" from Settings › This project
// (or the avatar menu) on a folder ALREADY linked to a team server opens the one Link your server dialog on that
// address. After the server's page signed this Mac in, the dialog's `finish` opened the server's project as a
// copy Maude keeps — the person landed in "127.0.0.1:61200 · copy kept by Maude" instead of their own folder,
// which was now signed in. Signing in again for THIS folder's own server opens nothing: the sign-in is the whole job.
import { describe, expect, test } from 'bun:test';

import { projectLinkApi } from '../client/v2/link-server/link-server-api.js';

const HUB = 'http://127.0.0.1:61200';

function api(status: unknown) {
  const opened: unknown[] = [];
  const posts: [string, unknown][] = [];
  const a = projectLinkApi({
    fetchGet: async () => status,
    fetchPost: async (path: string, body: unknown) => {
      posts.push([path, body]);
      return { ok: true, status: 200, json: { ok: true, state: 'linked', url: HUB } };
    },
    openProject: async (input: unknown) => {
      opened.push(input);
      return { ok: true };
    },
  } as never);
  return { a, opened, posts };
}

describe('Link your server › finish after a sign-in', () => {
  test('the folder is already linked to that server: nothing opens, the sign-in is done', async () => {
    const { a, opened, posts } = api({
      place: { kept: false, folder: '/Users/me/Signin return' },
      linkedHub: { url: `${HUB}/`, credentialed: true },
    });
    expect(await a.finish(HUB, { mode: 'kept', path: '' })).toEqual({ ok: true });
    expect(opened).toEqual([]);
    expect(posts).toEqual([]);
  });

  test('a kept copy of that same server signs in again in place too', async () => {
    const { a, opened } = api({
      place: { kept: true },
      linkedHub: { url: HUB, credentialed: true },
    });
    expect(await a.finish(HUB, { mode: 'kept', path: '' })).toEqual({ ok: true });
    expect(opened).toEqual([]);
  });

  test('a folder linked to ANOTHER server, or none: the server’s project opens as before', async () => {
    const other = api({
      place: { kept: true },
      linkedHub: { url: 'http://127.0.0.1:9', credentialed: true },
    });
    expect(await other.a.finish(HUB, { mode: 'kept', path: '' })).toEqual({ ok: true });
    expect(other.opened).toEqual([{ kind: 'known-hub', url: HUB }]);
    const none = api(null);
    expect(await none.a.finish(HUB, { mode: 'kept', path: '' })).toEqual({ ok: true });
    expect(none.opened).toEqual([{ kind: 'known-hub', url: HUB }]);
  });
});

// The same e2e, one step on: with nothing opened, the dialog closed and the project's own account chip kept
// saying "Sign in to sync" (it reads its status once, and again only on `maude:cloud-changed`), although the
// sign-in was stored and This project said Connected. A link or sign-in that lands tells the page so.
describe('Link your server › a landed link or sign-in tells the page', () => {
  function counted(status: unknown, answer: unknown) {
    let changed = 0;
    const a = projectLinkApi({
      fetchGet: async () => status,
      fetchPost: async () => ({ ok: true, status: 200, json: answer }),
      openProject: async () => ({ ok: true }),
      changed: () => {
        changed++;
      },
    } as never);
    return { a, n: () => changed };
  }

  test('signed in again for this folder’s server', async () => {
    const c = counted({ linkedHub: { url: HUB, credentialed: true } }, null);
    expect(await c.a.finish(HUB, { mode: 'kept', path: '' })).toEqual({ ok: true });
    expect(c.n()).toBe(1);
  });

  test('this folder linked, now or after the counts; nothing told when nothing landed', async () => {
    const linked = counted(null, { ok: true, state: 'linked', url: HUB });
    await linked.a.finish(HUB, { mode: 'this', path: '' });
    await linked.a.confirmLink(HUB, 'c1');
    expect(linked.n()).toBe(2);
    const asks = counted(null, {
      ok: true,
      state: 'needs-confirm',
      confirm: 'c',
      counts: {},
      host: 'h',
    });
    await asks.a.finish(HUB, { mode: 'this', path: '' });
    expect(asks.n()).toBe(0);
  });
});
