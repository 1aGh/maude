// #122 (122-C, contract 122-cross-canvas-clipboard.md §5.6) — the shell-token routes the desktop shell carries a
// clip between two project servers with: `GET /_api/shell/clip-export`, `GET /_api/shell/clip-asset`,
// `POST /_api/shell/clip-import`. Gates as `/_api/shell/status` (no token → 404, a browser → 403, wrong token →
// 401); main origin only, never canvas-safe. The import re-checks every item, keeps a carried relative import
// only when the target has the same file (path + sha256), checks every picture against its `<sha8>` name and
// writes nothing before every check passed; a picture already there is not written again.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
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
import { dirname, join } from 'node:path';

import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { CANVAS_SAFE_API, guardTableRoute } from '../http.ts';
import { createShellRoutes, type ShellRouteDeps } from '../routes/shell.ts';
import { mountRoutes } from '../routes/table.ts';

const TOKEN = 'b'.repeat(64);
const HOST = '127.0.0.1:4999';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SHA8 = createHash('sha256').update(PNG).digest('hex').slice(0, 8);
const PIC = `assets/${SHA8}.png`;
const SIDECAR = `assets/${SHA8}.photo.json`;

const CARD = 'components/Card.tsx';
const CARD_SRC = `export function Card({ title }) {
  return <div>{title}</div>;
}
`;
const HOME = 'ui/Home.tsx';
const HOME_SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
import { Card } from '../components/Card';
const W = 1440;
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={W} height={900}>
        <div data-cd-id="page">
          <Card data-cd-id="card" title="Hi" />
          <img data-cd-id="pic" src="${PIC}" />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const OTHER_SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <div data-cd-id="box" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

let dirs: string[] = [];
function project(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), 'clip-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function dispatch(root: string): DispatchDeps {
  return {
    resolve: (f) => (f.endsWith('.tsx') && existsSync(join(root, f)) ? f : null),
    read: (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null),
    write: async (rel, _b, after) => writeFileSync(join(root, rel), after),
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
  };
}

function routes(over: Partial<ShellRouteDeps> = {}) {
  const deps = {
    token: () => TOKEN,
    outbox: {} as ShellRouteDeps['outbox'],
    exportJobs: { list: () => [] },
    generateJobs: { list: () => [] },
    ...over,
  } as ShellRouteDeps;
  const specs = createShellRoutes(deps).map(guardTableRoute);
  const at = (path: string) => {
    const s = specs.find((x) => x.path === path);
    if (!s) throw new Error(`no ${path}`);
    return s;
  };
  return {
    get: (path: string, query: string, headers: Record<string, string> = {}) =>
      at(path).handle(
        new Request(`http://${HOST}${path}${query}`, {
          headers: { host: HOST, 'x-maude-shell': TOKEN, ...headers },
        }),
        {}
      ),
    post: (body: Uint8Array, headers: Record<string, string> = {}) =>
      at('/_api/shell/clip-import').handle(
        new Request(`http://${HOST}/_api/shell/clip-import`, {
          method: 'POST',
          headers: {
            host: HOST,
            'x-maude-shell': TOKEN,
            'content-type': 'application/octet-stream',
            ...headers,
          },
          body,
        }),
        {}
      ),
  };
}

/** Rust's frame: header length (BE u32) + header JSON + the assets' bytes in order. */
function frame(clip: unknown, assets: Array<{ rel: string; bytes: Uint8Array }>, project = 'Acme') {
  const header = new TextEncoder().encode(
    JSON.stringify({
      clip,
      project,
      assets: assets.map((a) => ({ rel: a.rel, size: a.bytes.length })),
    })
  );
  const total = 4 + header.length + assets.reduce((n, a) => n + a.bytes.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  let at = 4 + header.length;
  for (const a of assets) {
    out.set(a.bytes, at);
    at += a.bytes.length;
  }
  return out;
}

async function copyOnSource(root: string, op: 'artboard' | 'object' = 'artboard') {
  const r =
    op === 'artboard'
      ? await dispatchEditOp(
          { file: HOME, op: 'artboard.copy', targets: [], params: { artboards: ['desktop'] } },
          dispatch(root)
        )
      : await dispatchEditOp(
          { file: HOME, op: 'object.copy', targets: [{ artboard: 'desktop', element: 'card' }] },
          dispatch(root)
        );
  if (!r.ok) throw new Error(r.message);
  return (r.detail as { clip: { id: string } }).clip.id;
}

async function exported(root: string, id: string) {
  const r = await routes({ designRoot: root }).get('/_api/shell/clip-export', `?id=${id}`);
  expect(r.status).toBe(200);
  return (await r.json()) as Record<string, unknown> & {
    assets: Array<{ rel: string; size: number }>;
  };
}

beforeEach(() => _resetClips());
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('the gates (as /_api/shell/status)', () => {
  const paths: Array<[string, 'GET' | 'POST']> = [
    ['/_api/shell/clip-export', 'GET'],
    ['/_api/shell/clip-asset', 'GET'],
    ['/_api/shell/clip-import', 'POST'],
  ];
  const ask = (over: Partial<ShellRouteDeps>, path: string, headers: Record<string, string>) => {
    const r = routes(over);
    return path.endsWith('import')
      ? r.post(new Uint8Array(4), headers)
      : r.get(path, '?id=x', headers);
  };

  for (const [path] of paths) {
    test(`${path}: no shell token in this process → 404`, async () => {
      expect((await ask({ token: () => undefined, designRoot: '/x' }, path, {})).status).toBe(404);
    });
    test(`${path}: a browser → 403, even with the token`, async () => {
      expect((await ask({ designRoot: '/x' }, path, { 'sec-fetch-site': 'none' })).status).toBe(
        403
      );
    });
    test(`${path}: a wrong token → 401`, async () => {
      expect((await ask({ designRoot: '/x' }, path, { 'x-maude-shell': `${TOKEN}x` })).status).toBe(
        401
      );
    });
    test(`${path}: no design root wired → 404`, async () => {
      expect((await ask({}, path, {})).status).toBe(404);
    });
  }

  test('main origin only, in neither canvas list', () => {
    const specs = createShellRoutes({
      outbox: {} as ShellRouteDeps['outbox'],
      exportJobs: { list: () => [] },
      generateJobs: { list: () => [] },
    }).filter((s) => paths.some(([p]) => p === s.path));
    expect(specs.map((s) => [s.path, s.method, s.origin, s.readOnly])).toEqual([
      ['/_api/shell/clip-export', 'GET', 'main', 'allowed'],
      ['/_api/shell/clip-asset', 'GET', 'main', 'allowed'],
      ['/_api/shell/clip-import', 'POST', 'main', 'refused'],
    ]);
    expect(mountRoutes(specs).canvasPaths).toEqual([]);
    for (const [p] of paths) expect(CANVAS_SAFE_API.has(p)).toBe(false);
  });
});

describe('export → import → paste, across two projects', () => {
  test('the clip crosses with its picture; the paste carries the import and the declaration', async () => {
    const a = project({ [HOME]: HOME_SRC, [CARD]: CARD_SRC, [PIC]: PNG, [SIDECAR]: '{"v":1}' });
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC });
    const id = await copyOnSource(a);
    const body = await exported(a, id);
    expect(body.assets).toEqual([
      { rel: SIDECAR, size: 7 },
      { rel: PIC, size: PNG.length },
    ]);
    expect(body.modules).toEqual([
      { path: CARD, sha256: createHash('sha256').update(CARD_SRC).digest('hex') },
    ]);
    const src = routes({ designRoot: a });
    const bytes = new Uint8Array(
      await (await src.get('/_api/shell/clip-asset', `?id=${id}&rel=${PIC}`)).arrayBuffer()
    );
    expect(bytes).toEqual(PNG);

    const r = await routes({ designRoot: b }).post(
      frame(body, [
        { rel: SIDECAR, bytes: new TextEncoder().encode('{"v":1}') },
        { rel: PIC, bytes },
      ])
    );
    expect(r.status).toBe(200);
    const { handle } = (await r.json()) as { handle: { id: string; kind: string; from: string } };
    expect(handle.kind).toBe('artboards');
    expect(handle.id).not.toBe(id);
    expect(readFileSync(join(b, PIC))).toEqual(Buffer.from(PNG));
    expect(existsSync(join(b, SIDECAR))).toBe(true);

    // same canvas path in both projects: still "another canvas" — the import and W are carried
    const pasted = await dispatchEditOp(
      {
        file: HOME,
        op: 'canvas.paste',
        targets: [],
        params: { clip: handle.id, artboard: 'post' },
      },
      dispatch(b)
    );
    expect(pasted.ok).toBe(true);
    const out = readFileSync(join(b, HOME), 'utf8');
    expect(out).toContain("import { Card } from '../components/Card';");
    expect(out).toContain('const W = 1440;');
    expect(out).toContain(`src="${PIC}"`);
  });

  test('a picture already there is not written again', async () => {
    const a = project({ [HOME]: HOME_SRC, [CARD]: CARD_SRC, [PIC]: PNG });
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC, [PIC]: PNG });
    const before = statSync(join(b, PIC)).mtimeMs;
    const body = await exported(a, await copyOnSource(a));
    const r = await routes({ designRoot: b }).post(frame(body, [{ rel: PIC, bytes: PNG }]));
    expect(r.status).toBe(200);
    expect(statSync(join(b, PIC)).mtimeMs).toBe(before);
    expect(readdirSync(join(b, 'assets'))).toEqual([`${SHA8}.png`]);
  });

  test('a clip that came in is never exported again (text only from a server that read it itself)', async () => {
    const a = project({ [HOME]: HOME_SRC, [CARD]: CARD_SRC, [PIC]: PNG });
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC });
    const body = await exported(a, await copyOnSource(a));
    const r = await routes({ designRoot: b }).post(frame(body, [{ rel: PIC, bytes: PNG }]));
    const { handle } = (await r.json()) as { handle: { id: string } };
    const again = await routes({ designRoot: b }).get(
      '/_api/shell/clip-export',
      `?id=${handle.id}`
    );
    expect(again.status).toBe(404);
  });
});

describe('the import refuses, and writes nothing', () => {
  const setup = async () => {
    const a = project({ [HOME]: HOME_SRC, [CARD]: CARD_SRC, [PIC]: PNG });
    const body = await exported(a, await copyOnSource(a));
    return { a, body };
  };

  test('a carried import whose file this project does not have → 409 in words', async () => {
    const { body } = await setup();
    const b = project({ [HOME]: OTHER_SRC });
    const r = await routes({ designRoot: b }).post(frame(body, [{ rel: PIC, bytes: PNG }]));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe(
      'That artboard uses Card from components/Card.tsx, which this project doesn’t have. Copy that file over first.'
    );
    expect(existsSync(join(b, 'assets'))).toBe(false);
  });

  test('the same path with other content is not the same file → 409', async () => {
    const { body } = await setup();
    const b = project({ [HOME]: OTHER_SRC, [CARD]: `${CARD_SRC}// changed\n` });
    const r = await routes({ designRoot: b }).post(frame(body, [{ rel: PIC, bytes: PNG }]));
    expect(r.status).toBe(409);
  });

  test('a picture whose bytes are not what its <sha8> name says → 422, nothing written', async () => {
    const { body } = await setup();
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC });
    const forged = new Uint8Array(PNG);
    forged[11] = 9;
    const r = await routes({ designRoot: b }).post(frame(body, [{ rel: PIC, bytes: forged }]));
    expect(r.status).toBe(422);
    expect(existsSync(join(b, 'assets'))).toBe(false);
  });

  test('an item that is not one artboard (re-checked like a paste) → 400', async () => {
    const { body } = await setup();
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC });
    for (const item of [
      '<div>one</div><div>two</div>',
      'fetch("/x")',
      '<DCArtboard id="x" label="x">{fetch("/x")}</DCArtboard>; alert(1)',
      '<div>not an artboard</div>',
    ]) {
      const r = await routes({ designRoot: b }).post(
        frame({ ...body, items: [item] }, [{ rel: PIC, bytes: PNG }])
      );
      expect(r.status).toBe(400);
    }
    expect(existsSync(join(b, 'assets'))).toBe(false);
  });

  test('a picture the clip does not list, or an odd name → 400; a decl that is not one declaration → 400', async () => {
    const { body } = await setup();
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC });
    const other = new Uint8Array([7, 7, 7]);
    const otherRel = `assets/${createHash('sha256').update(other).digest('hex').slice(0, 8)}.png`;
    const post = routes({ designRoot: b }).post;
    expect((await post(frame(body, [{ rel: otherRel, bytes: other }]))).status).toBe(400);
    const odd = { ...body, carry: { ...(body.carry as object), assets: ['assets/../../x.png'] } };
    expect((await post(frame(odd, []))).status).toBe(400);
    const carry = body.carry as { decls: Array<{ text: string }> };
    const badDecl = {
      ...body,
      carry: { ...carry, decls: [{ ...carry.decls[0], text: 'const W = 1440; fetch("/x");' }] },
    };
    expect((await post(frame(badDecl, [{ rel: PIC, bytes: PNG }]))).status).toBe(400);
    expect(existsSync(join(b, 'assets'))).toBe(false);
  });

  test('a frame whose sizes do not add up → 400', async () => {
    const { body } = await setup();
    const b = project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC });
    const f = frame(body, [{ rel: PIC, bytes: PNG }]);
    const r = await routes({ designRoot: b }).post(f.subarray(0, f.length - 1));
    expect(r.status).toBe(400);
  });
});

describe('clip-asset', () => {
  test('only an asset the clip lists', async () => {
    const a = project({
      [HOME]: HOME_SRC,
      [CARD]: CARD_SRC,
      [PIC]: PNG,
      'assets/aaaaaaaa.png': PNG,
    });
    const id = await copyOnSource(a);
    const get = routes({ designRoot: a }).get;
    expect((await get('/_api/shell/clip-asset', `?id=${id}&rel=assets/aaaaaaaa.png`)).status).toBe(
      404
    );
    expect((await get('/_api/shell/clip-asset', `?id=${id}&rel=${CARD}`)).status).toBe(404);
    expect((await get('/_api/shell/clip-asset', `?id=c_0000000000000000&rel=${PIC}`)).status).toBe(
      404
    );
    expect((await get('/_api/shell/clip-asset', `?id=${id}&rel=${PIC}`)).status).toBe(200);
  });
});

describe('only media crosses as an asset', () => {
  const setup = async () => {
    const a = project({ [HOME]: HOME_SRC, [CARD]: CARD_SRC, [PIC]: PNG });
    const body = await exported(a, await copyOnSource(a));
    return { body, b: project({ [HOME]: OTHER_SRC, [CARD]: CARD_SRC }) };
  };
  const named = (bytes: Uint8Array, ext: string) =>
    `assets/${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.${ext}`;
  const withAsset = (body: Record<string, unknown>, rel: string) => ({
    ...body,
    carry: { ...(body.carry as { assets: string[] }), assets: [PIC, rel].sort() },
  });

  test('code named by its own hash (assets/<sha8>.tsx) → 400, nothing written', async () => {
    const { body, b } = await setup();
    for (const ext of ['tsx', 'ts', 'js', 'mjs', 'json', 'css', 'html']) {
      const code = new TextEncoder().encode(
        `export default function X() { return null } // ${ext}`
      );
      const rel = named(code, ext);
      const r = await routes({ designRoot: b }).post(
        frame(withAsset(body, rel), [
          { rel: PIC, bytes: PNG },
          { rel, bytes: code },
        ])
      );
      expect(r.status).toBe(400);
      expect(existsSync(join(b, rel))).toBe(false);
    }
    expect(existsSync(join(b, 'assets'))).toBe(false);
  });

  test('a clip naming a non-media asset this project lacks → refused in the copy-over words', async () => {
    const { body, b } = await setup();
    const r = await routes({ designRoot: b }).post(
      frame(withAsset(body, 'assets/0a1b2c3d.tsx'), [{ rel: PIC, bytes: PNG }])
    );
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe(
      'That artboard uses assets/0a1b2c3d.tsx, which this project doesn’t have. Copy that file over first.'
    );
    expect(existsSync(join(b, 'assets'))).toBe(false);
  });

  test('an SVG crosses only as the import-asset sanitizer leaves it', async () => {
    const { body, b } = await setup();
    const dirty = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><script>alert(1)</script><rect width="4" height="4"/></svg>'
    );
    const rel = named(dirty, 'svg');
    const bad = await routes({ designRoot: b }).post(
      frame(withAsset(body, rel), [
        { rel: PIC, bytes: PNG },
        { rel, bytes: dirty },
      ])
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { message: string }).message).toContain(
      'Copy that file over first.'
    );
    expect(existsSync(join(b, 'assets'))).toBe(false);

    const { sanitizeSvgAllowlist } = await import('../bin/_import-asset.mjs');
    const clean = new TextEncoder().encode(sanitizeSvgAllowlist(new TextDecoder().decode(dirty)));
    const okRel = named(clean, 'svg');
    const ok = await routes({ designRoot: b }).post(
      frame(withAsset(body, okRel), [
        { rel: PIC, bytes: PNG },
        { rel: okRel, bytes: clean },
      ])
    );
    expect(ok.status).toBe(200);
    expect(readFileSync(join(b, okRel))).toEqual(Buffer.from(clean));
  });
});
