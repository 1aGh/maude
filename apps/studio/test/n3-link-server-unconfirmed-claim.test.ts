// 2.1.1 N3 — a server the folder only CLAIMS (committed in its settings, never linked or confirmed on this Mac:
// `/_api/cloud/status` answers `linkedHub.confirmed === false`) is not this folder's link. Link your server must
// treat the folder as unlinked: typing the claimed server runs the normal link-this-folder flow (with its
// first-link confirm), and typing the person's own server links this folder rather than opening a kept copy.
import { describe, expect, test } from 'bun:test';

import { folderOfStatus, projectLinkApi } from '../client/v2/link-server/link-server-api.js';

const CLAIMED = 'https://claimed.example.com';
const MINE = 'https://mine.example.com';
const FOLDER = '/Users/me/logo-ideas';

const parked = {
  place: { kept: false, folder: FOLDER },
  linkedHub: { url: CLAIMED, credentialed: false, confirmed: false },
};

function api(status: unknown) {
  const opened: unknown[] = [];
  const posts: [string, unknown][] = [];
  const a = projectLinkApi({
    fetchGet: async () => status,
    fetchPost: async (path: string, body: unknown) => {
      posts.push([path, body]);
      return {
        ok: true,
        status: 200,
        json: { ok: true, state: 'needs-confirm', confirm: 'c1', counts: {}, host: 'h' },
      };
    },
    openProject: async (input: unknown) => {
      opened.push(input);
      return { ok: true };
    },
    changed: () => {},
  } as never);
  return { a, opened, posts };
}

describe('Link your server › an unconfirmed claim is not a link', () => {
  test('the folder still counts as this project’s own, unlinked folder', async () => {
    expect(folderOfStatus(parked)).toBe(FOLDER);
    expect(await api(parked).a.where()).toEqual({ folder: FOLDER });
  });

  test('a confirmed link still hides the folder (unchanged)', () => {
    expect(folderOfStatus({ ...parked, linkedHub: { url: CLAIMED, confirmed: true } })).toBeNull();
    // statuses from before `confirmed` existed: a url alone is a link
    expect(folderOfStatus({ ...parked, linkedHub: { url: CLAIMED } })).toBeNull();
  });

  test('a sign-in on the claimed server is not "already linked, done"', async () => {
    const { a, opened, posts } = api(parked);
    await a.finish(CLAIMED, { mode: 'kept', path: '' });
    // it took the ordinary path (never the silent "the sign-in was the whole job" answer)
    expect(opened).toEqual([{ kind: 'known-hub', url: CLAIMED }]);
    expect(posts).toEqual([]);
  });

  test('typing the claimed server, or my own, links THIS folder (with the first-link confirm)', async () => {
    for (const url of [CLAIMED, MINE]) {
      const { a, opened, posts } = api(parked);
      const folder = await a.where();
      const r = await a.finish(url, { mode: 'this', path: folder.folder });
      expect(r).toMatchObject({ ok: false, needsConfirm: { code: 'c1' } });
      expect(opened).toEqual([]);
      expect(posts).toEqual([['/_api/hub/link-folder', { url }]]);
    }
  });
});
