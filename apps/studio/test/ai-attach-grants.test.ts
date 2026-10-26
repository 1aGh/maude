// S5.10 — folder consent + attachments (ai/attach-grants.ts, routes/chat-attach.ts).
// The security bar: a folder is judged on its REAL path (no escape via `..` or a symlink into
// `~/.ssh`), consent is recorded only by Let AI read, a grant is per chat to use and revocable,
// listings never leave the granted folder, and a file attachment hands the agent a path the
// SERVER chose. Every route is main-origin only.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { notInScopeResponse, runWithAccess } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import { isInsideRoot } from '../acp/write-scope.ts';
import {
  countFiles,
  createGrantStore,
  grantsFileFor,
  LEGACY_GRANTS_REL,
  listFolder,
  resolveFolder,
} from '../ai/attach-grants.ts';
import type { SaveAssetResult } from '../api.ts';
import { createChatAttachRoutes, displayName, pdfPageCount } from '../routes/chat-attach.ts';
import type { RouteSpec } from '../routes/table.ts';

let tmp: string;
let home: string;
let project: string;
let design: string;
let photos: string; // outside the project — the folder a person attaches
let env: { projectRoot: string; designRoot: string; home: string };

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-attach-')));
  home = join(tmp, 'home');
  project = join(home, 'work', 'club');
  design = join(project, '.design');
  photos = join(home, 'Pictures', 'Combine 2026');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'id_ed25519'), 'PRIVATE KEY\n');
  mkdirSync(join(home, 'Library', 'Mobile Documents', 'iCloud', 'shots'), { recursive: true });
  mkdirSync(join(home, 'Library', 'Keychains'), { recursive: true });
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(project, 'brief'), { recursive: true });
  mkdirSync(join(photos, 'day 1'), { recursive: true });
  writeFileSync(join(photos, 'a.jpg'), 'x');
  writeFileSync(join(photos, 'day 1', 'b.jpg'), 'x');
  writeFileSync(join(photos, '.DS_Store'), 'x');
  // Links planted INSIDE the granted folder that point OUT of it.
  symlinkSync(join(home, '.ssh'), join(photos, 'keys'), 'dir');
  symlinkSync(join(home, '.ssh', 'id_ed25519'), join(photos, 'key.jpg'), 'file');
  // A link that is itself the pick: a "folder" that is really ~/.ssh.
  symlinkSync(join(home, '.ssh'), join(home, 'Desktop-shots'), 'dir');
  env = { projectRoot: project, designRoot: design, home };
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A throwaway project at `dir` (its design root `dir/.design`), judged against the fixture home. */
const placeOf = (dir: string) => ({ projectRoot: dir, designRoot: join(dir, '.design'), home });

describe('resolveFolder — judged on the real path', () => {
  test('an ordinary folder outside the project resolves, and says it is outside', () => {
    const r = resolveFolder(photos, env);
    expect(r).toEqual({ ok: true, root: photos, name: 'Combine 2026', outsideProject: true });
  });

  test('a folder inside the project (not the design root) is inside', () => {
    const r = resolveFolder(join(project, 'brief'), env);
    expect(r.ok && r.outsideProject).toBe(false);
  });

  test('a symlink whose target is ~/.ssh is ~/.ssh — refused', () => {
    expect(resolveFolder(join(home, 'Desktop-shots'), env)).toEqual({
      ok: false,
      code: 'sensitive',
    });
  });

  test('`..` that climbs into ~/.ssh is refused (no lexical escape)', () => {
    const sneaky = `${photos}/day 1/../../../.ssh`;
    expect(resolveFolder(sneaky, env)).toEqual({ ok: false, code: 'sensitive' });
  });

  test('home, its parents and / are too broad; ~/Library is sensitive but iCloud Drive is not', () => {
    expect(resolveFolder(home, env)).toEqual({ ok: false, code: 'too-broad' });
    expect(resolveFolder(tmp, env)).toEqual({ ok: false, code: 'too-broad' });
    expect(resolveFolder('/', env)).toEqual({ ok: false, code: 'too-broad' });
    expect(resolveFolder(join(home, 'Library', 'Keychains'), env)).toEqual({
      ok: false,
      code: 'sensitive',
    });
    expect(
      resolveFolder(join(home, 'Library', 'Mobile Documents', 'iCloud', 'shots'), env).ok
    ).toBe(true);
  });

  test('a folder that holds a sensitive one is refused too', () => {
    // `~/work` holds no key, but a pick of a folder that CONTAINS ~/.ssh would — home covers it;
    // check the general shape with /etc's parent: `/private` holds `/private/etc`.
    expect(resolveFolder('/private', env).ok).toBe(false);
  });

  test('the project, a folder holding it, and the design root are refused (AI already works there)', () => {
    expect(resolveFolder(project, env)).toEqual({ ok: false, code: 'is-project' });
    expect(resolveFolder(join(home, 'work'), env)).toEqual({ ok: false, code: 'is-project' });
    expect(resolveFolder(design, env)).toEqual({ ok: false, code: 'is-project' });
    expect(resolveFolder(join(design, 'ui'), env)).toEqual({ ok: false, code: 'is-project' });
  });

  test('a file, a relative path, a NUL and a missing path are named refusals', () => {
    expect(resolveFolder(join(photos, 'a.jpg'), env)).toEqual({ ok: false, code: 'not-a-folder' });
    expect(resolveFolder('Pictures', env)).toEqual({ ok: false, code: 'bad-path' });
    expect(resolveFolder(`${photos}\0`, env)).toEqual({ ok: false, code: 'bad-path' });
    expect(resolveFolder(join(home, 'nope'), env)).toEqual({ ok: false, code: 'not-found' });
    expect(resolveFolder(42, env)).toEqual({ ok: false, code: 'bad-path' });
  });
});

describe('countFiles / listFolder — never outside the granted folder', () => {
  test('counts visible files, not dotfiles, not a link to a file outside', () => {
    expect(countFiles(photos)).toEqual({ count: 2, capped: false });
  });

  test('a listing leaves out links that point outside, and counts them as skipped', () => {
    const l = listFolder(photos, '');
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.entries.map((e) => e.name)).toEqual(['a.jpg', 'day 1']);
    expect(l.skipped).toBe(2);
  });

  test('`sub` cannot climb out with `..`, an absolute path, or through a planted link', () => {
    expect(listFolder(photos, '../..')).toEqual({ ok: false, code: 'bad-path' });
    expect(listFolder(photos, join(home, '.ssh'))).toEqual({ ok: false, code: 'bad-path' });
    expect(listFolder(photos, 'keys')).toEqual({ ok: false, code: 'bad-path' });
    expect(listFolder(photos, 'day 1').ok).toBe(true);
  });
});

describe('the grant store — consent once per real path, per chat to use, revocable', () => {
  test('grant → attached to that chat only; a second chat attaches without asking again', () => {
    const dr = join(tmp, 'gs1');
    mkdirSync(dr);
    const store = createGrantStore(placeOf(dr), () => 1000);
    const r = resolveFolder(photos, env);
    if (!r.ok) throw new Error('fixture');
    expect(store.grant(r, 'chat-a')).toEqual({ ok: true });
    expect(store.chatRoots('chat-a')).toEqual([photos]);
    expect(store.chatRoots('chat-b')).toEqual([]);
    expect(store.attach(photos, 'chat-b')).toEqual({ ok: true });
    expect(store.chatRoots('chat-b')).toEqual([photos]);
    // The file is per-Mac state, owner-only, outside the project (V2-8.9 B1).
    const file = grantsFileFor(dr);
    expect(JSON.parse(readFileSync(file, 'utf8')).folders[0]).toMatchObject({
      root: photos,
      outsideProject: true,
      grantedAt: 1000,
    });
  });

  test('detach keeps the consent; revoke removes it from every chat', () => {
    const dr = join(tmp, 'gs2');
    mkdirSync(dr);
    const store = createGrantStore(placeOf(dr));
    const r = resolveFolder(photos, env);
    if (!r.ok) throw new Error('fixture');
    store.grant(r, 'chat-a');
    store.attach(photos, 'chat-b');
    store.detach(photos, 'chat-a');
    expect(store.chatRoots('chat-a')).toEqual([]);
    expect(store.isGranted(photos)).toBe(true);
    expect(store.revoke(photos)).toBe(true);
    expect(store.chatRoots('chat-b')).toEqual([]);
    expect(store.readOnlyRoots()).toEqual([]);
    expect(store.attach(photos, 'chat-b')).toEqual({ ok: false, code: 'not-granted' });
  });

  test('a granted folder swapped for a symlink drops out — a grant never follows a swap', () => {
    const dr = join(tmp, 'gs3');
    const victim = join(home, 'Pictures', 'swap-me');
    mkdirSync(dr);
    mkdirSync(victim);
    const store = createGrantStore(placeOf(dr));
    const r = resolveFolder(victim, env);
    if (!r.ok) throw new Error('fixture');
    store.grant(r, 'chat-a');
    renameSync(victim, `${victim}-gone`);
    symlinkSync(join(home, '.ssh'), victim, 'dir');
    expect(store.chatRoots('chat-a')).toEqual([]);
    expect(store.attach(victim, 'chat-a')).toEqual({ ok: false, code: 'moved' });
    expect(listFolder(victim, '')).toEqual({ ok: false, code: 'moved' });
    // …and it stays on the read-only list (over-including only adds a prompt).
    expect(store.readOnlyRoots()).toEqual([victim]);
  });

  test('a torn grants file grants nothing', () => {
    const dr = join(tmp, 'gs4');
    mkdirSync(join(grantsFileFor(dr), '..'), { recursive: true });
    writeFileSync(grantsFileFor(dr), '{"v":1,"folders":[{"root":');
    const store = createGrantStore(placeOf(dr));
    expect(store.list()).toEqual([]);
    expect(store.chatRoots('chat-a')).toEqual([]);
  });
});

// V2-8.9 B1 — the agent writes the design root freely, so the consent record must not live there.
describe('B1 — the grants live outside the design root; a planted file grants nothing', () => {
  const legacyOf = (dir: string) => join(dir, '.design', LEGACY_GRANTS_REL);
  const plant = (file: string, roots: string[], chatId = 'c1') => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        folders: roots.map((root) => ({ root, name: 'x', grantedAt: 1, outsideProject: true })),
        chats: { [chatId]: roots },
      })
    );
  };

  test('a grant is written outside the project and its design root', () => {
    const dr = join(tmp, 'b1a');
    mkdirSync(join(dr, '.design'), { recursive: true });
    const r = resolveFolder(photos, env);
    if (!r.ok) throw new Error('fixture');
    expect(createGrantStore(placeOf(dr)).grant(r, 'c1')).toEqual({ ok: true });
    const file = grantsFileFor(dr);
    expect(existsSync(file)).toBe(true);
    expect(isInsideRoot(file, dr)).toBe(false);
    expect(existsSync(legacyOf(dr))).toBe(false);
  });

  test('a `_state/ai-grants.json` written after the store exists is deleted unread', () => {
    const dr = join(tmp, 'b1b');
    mkdirSync(join(dr, '.design'), { recursive: true });
    expect(createGrantStore(placeOf(dr)).chatRoots('c1')).toEqual([]); // the store now exists
    plant(legacyOf(dr), [photos]);
    expect(createGrantStore(placeOf(dr)).chatRoots('c1')).toEqual([]);
    expect(existsSync(legacyOf(dr))).toBe(false);
  });

  test('M-a — a legacy file on a fresh clone (no store yet) is deleted unread: never consent', () => {
    const dr = join(tmp, 'b1c');
    mkdirSync(join(dr, '.design'), { recursive: true });
    // the default chat id is `default` (acp/index.ts) — a cloned repo can force-commit this file
    plant(legacyOf(dr), [photos], 'default');
    const store = createGrantStore(placeOf(dr));
    expect(store.chatRoots('default')).toEqual([]);
    expect(store.readOnlyRoots()).toEqual([]);
    expect(existsSync(legacyOf(dr))).toBe(false);
    expect(existsSync(grantsFileFor(dr))).toBe(false); // nothing was migrated into the store
  });

  test('a forged store entry the picker would refuse is never read', () => {
    const dr = join(tmp, 'b1d');
    mkdirSync(join(dr, '.design'), { recursive: true });
    plant(grantsFileFor(dr), [sep, home, join(home, '.ssh'), join(dr, '.design')]);
    expect(createGrantStore(placeOf(dr)).chatRoots('c1')).toEqual([]);
  });

  test('a store pointed inside the project is never trusted or written', () => {
    const dr = join(tmp, 'b1e');
    mkdirSync(join(dr, '.design', '_state'), { recursive: true });
    const file = join(dr, '.design', '_state', 'in-tree.json');
    plant(file, [photos]);
    const store = createGrantStore({ ...placeOf(dr), file });
    expect(store.chatRoots('c1')).toEqual([]);
    const r = resolveFolder(photos, env);
    if (!r.ok) throw new Error('fixture');
    expect(() => store.grant(r, 'c1')).toThrow();
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────

function routes(designRoot: string, saved: Uint8Array[] = []): RouteSpec[] {
  return createChatAttachRoutes({
    designRoot,
    // A fresh design root is its own project, so its grants are its own (they key by project).
    projectRoot: designRoot === design ? project : designRoot,
    home,
    saveAsset: async (stream): Promise<SaveAssetResult> => {
      const chunks: Uint8Array[] = [];
      for await (const c of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
      saved.push(Buffer.concat(chunks));
      return { ok: true, path: 'assets/ab12cd34.png' };
    },
  });
}
const call = (specs: RouteSpec[], method: string, path: string, init: RequestInit = {}) => {
  const url = new URL(`http://127.0.0.1${path}`);
  const spec = specs.find((s) => s.method === method && s.path === url.pathname);
  if (!spec) throw new Error(`no route ${method} ${url.pathname}`);
  return spec.handle(new Request(url, { method, ...init }), {});
};
const post = (specs: RouteSpec[], path: string, body: unknown) =>
  call(specs, 'POST', path, { body: JSON.stringify(body) });

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4,
]);
const PDF = new TextEncoder().encode(
  '%PDF-1.7\n1 0 obj <</Type /Pages /Count 2>> 2 0 obj <</Type /Page>> 3 0 obj <</Type/Page>>\n%%EOF'
);

describe('routes/chat-attach — main origin only, server-chosen paths', () => {
  test('every route is main-origin; every write is refused in a read-only session', () => {
    const specs = routes(design);
    expect(specs.every((s) => s.origin === 'main')).toBe(true);
    expect(specs.filter((s) => s.method === 'POST').every((s) => s.readOnly === 'refused')).toBe(
      true
    );
  });

  test('a photo goes to Assets; the answer is the Assets copy, whatever the name said', async () => {
    const saved: Uint8Array[] = [];
    const res = await call(
      routes(design, saved),
      'POST',
      '/_api/ai/attach/file?name=../../.ssh/id_ed25519',
      {
        body: PNG,
      }
    );
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ kind: 'image', name: 'id_ed25519', asset: 'assets/ab12cd34.png' });
    expect(b.path).toBe(join(design, 'assets/ab12cd34.png'));
    expect(Buffer.from(saved[0] as Uint8Array).equals(Buffer.from(PNG))).toBe(true);
  });

  test('a PDF lands in this Mac’s _chat/attachments with its page count', async () => {
    const res = await call(routes(design), 'POST', '/_api/ai/attach/file?name=Combine-brief.pdf', {
      body: PDF,
    });
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ kind: 'file', type: 'pdf', name: 'Combine-brief.pdf', pages: 2 });
    expect(b.path.startsWith(join(design, '_chat', 'attachments'))).toBe(true);
    expect(existsSync(b.path)).toBe(true);
  });

  test('SVG, HTML and an empty body are refused with the stated limits', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const r1 = await call(routes(design), 'POST', '/_api/ai/attach/file?name=x.svg', { body: svg });
    expect(r1.status).toBe(415);
    expect((await r1.json()).message).toContain('PDFs up to 32 MB');
    const r2 = await call(routes(design), 'POST', '/_api/ai/attach/file', {
      body: new Uint8Array(),
    });
    expect(r2.status).toBe(400);
  });

  test('a folder without consent records nothing; Let AI read records it; next time attaches straight away', async () => {
    const dr = join(tmp, 'rt1');
    mkdirSync(dr);
    const specs = routes(dr);
    const probe = await (
      await post(specs, '/_api/ai/attach/folder', { path: photos, chatId: 'c1' })
    ).json();
    expect(probe).toMatchObject({
      root: photos,
      count: 2,
      granted: false,
      needsConsent: true,
      outsideProject: true,
    });
    // The store exists from the first open (it marks the one-time migration done), holding nothing.
    expect(JSON.parse(readFileSync(grantsFileFor(dr), 'utf8')).folders).toEqual([]);

    const ok = await post(specs, '/_api/ai/attach/folder', {
      path: photos,
      chatId: 'c1',
      consent: true,
    });
    expect(ok.status).toBe(201);
    const again = await (
      await post(specs, '/_api/ai/attach/folder', { path: photos, chatId: 'c2' })
    ).json();
    expect(again).toMatchObject({ granted: true, attached: true });
  });

  test('a symlinked pick into ~/.ssh is refused even with consent', async () => {
    const res = await post(routes(join(tmp, 'rt1')), '/_api/ai/attach/folder', {
      path: join(home, 'Desktop-shots'),
      chatId: 'c1',
      consent: true,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('sensitive');
  });

  test('a listing needs the folder granted AND attached to that chat', async () => {
    const dr = join(tmp, 'rt2');
    mkdirSync(dr);
    const specs = routes(dr);
    const list = (chatId: string, root: string, sub = '') =>
      call(
        specs,
        'GET',
        `/_api/ai/attach/folder/list?chatId=${chatId}&root=${encodeURIComponent(root)}&sub=${encodeURIComponent(sub)}`
      );
    expect((await list('c1', photos)).status).toBe(403); // not granted
    await post(specs, '/_api/ai/attach/folder', { path: photos, chatId: 'c1', consent: true });
    expect((await list('c2', photos)).status).toBe(403); // granted, not this chat's
    expect((await list('c1', join(home, '.ssh'))).status).toBe(403);
    const ok = await list('c1', photos);
    expect(ok.status).toBe(200);
    expect((await ok.json()).entries.map((e: { name: string }) => e.name)).toEqual([
      'a.jpg',
      'day 1',
    ]);
    expect((await list('c1', photos, '../../.ssh')).status).toBe(403);
    // Revoked → gone.
    await post(specs, '/_api/ai/attach/folder/revoke', { root: photos });
    expect((await list('c1', photos)).status).toBe(403);
  });

  // A6c — the reads are `project` class (test/_acl-route-classes.ts): the AI chat is the
  // project's. A canvas-only session gets the not-in-scope answer every other canvas-only
  // refusal gives — the same bytes whether or not any folder is granted (no oracle).
  test('a canvas-only session reads neither the granted folders nor a listing', async () => {
    const dr = join(tmp, 'rt3');
    mkdirSync(dr);
    const specs = routes(dr);
    await post(specs, '/_api/ai/attach/folder', { path: photos, chatId: 'c1', consent: true });
    const canvasOnly = resolveAccess({
      v: 1,
      role: null,
      grants: [{ c: 'ui/a.tsx', r: 'member' }],
    });
    const answer = async (path: string) => {
      const res = await runWithAccess(canvasOnly, () => call(specs, 'GET', path));
      return `${res.status} ${await res.text()}`;
    };
    const refused = `403 ${await notInScopeResponse().text()}`;
    expect(await answer('/_api/ai/attach/folders')).toBe(refused);
    expect(
      await answer(`/_api/ai/attach/folder/list?chatId=c1&root=${encodeURIComponent(photos)}`)
    ).toBe(refused);
    // The owner still reads both.
    expect((await call(specs, 'GET', '/_api/ai/attach/folders')).status).toBe(200);
  });
});

describe('helpers', () => {
  test('displayName is a name, never a path', () => {
    expect(displayName('/Users/x/.ssh/id_rsa')).toBe('id_rsa');
    expect(displayName('a\nb[1].jpg')).toBe('ab1.jpg');
    expect(displayName('')).toBe('attachment');
  });
  test('pdfPageCount counts page objects, not the page tree', () => {
    expect(pdfPageCount(PDF)).toBe(2);
    expect(pdfPageCount(new TextEncoder().encode('%PDF-1.4'))).toBe(0);
  });
});
