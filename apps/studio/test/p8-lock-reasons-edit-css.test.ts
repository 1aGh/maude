// p8-lock-reasons (1, server) — only the lock op may touch a locked object (S2-edit-ops §3 rule 6). The
// inspector's style controls write through `POST /_api/edit-css`, which never asked: a locked object's padding,
// fill or position still changed. It now refuses a shared-locked target (`data-cd-locked` in the source) with the
// edit-op's own 409 `locked` answer, through the dispatcher's lock lookup; unlocked writes are unchanged. The
// per-user padlock (view.json) is not in the source and is never refused here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

const SRC = `export default function Knob() {
  return (
    <section>
      <div data-cd-id="hero" data-cd-locked style={{ padding: 8 }}>Locked</div>
      <div data-cd-id="card" style={{ padding: 8 }}>Free</div>
    </section>
  );
}`;

async function rig(src = SRC) {
  const { root, designRoot } = makeSandbox();
  const abs = join(designRoot, 'ui', 'Knob.tsx');
  await Bun.write(abs, src);
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  const api = createApi(ctx, { onCommentsChanged: () => {} });
  return { api, abs };
}

describe('p8-lock-reasons — /_api/edit-css refuses a locked object', () => {
  test('a set on a locked object is a 409 locked, in the edit-op words, and writes nothing', async () => {
    const r = await rig();
    const res = await r.api.editCss({
      canvas: 'ui/Knob',
      id: 'hero',
      property: 'padding',
      value: '24px',
    });
    expect(res).toEqual({
      ok: false,
      status: 409,
      code: 'locked',
      error: 'hero is locked · ⇧⌘L unlocks',
    });
    expect(await Bun.file(r.abs).text()).toBe(SRC);
  });

  test('a reset and a two-property move on a locked object are refused the same way', async () => {
    const r = await rig();
    const reset = await r.api.editCss({
      canvas: 'ui/Knob',
      id: 'hero',
      property: 'padding',
      reset: true,
    });
    expect(!reset.ok && reset.status).toBe(409);
    const move = await r.api.editCss({
      canvas: 'ui/Knob',
      id: 'hero',
      property: 'left',
      value: '10px',
      also: [{ property: 'top', value: '20px' }],
    });
    expect(!move.ok && move.status).toBe(409);
    expect(await Bun.file(r.abs).text()).toBe(SRC);
  });

  test('an unlocked object is written as before', async () => {
    const r = await rig();
    const res = await r.api.editCss({
      canvas: 'ui/Knob',
      id: 'card',
      property: 'padding',
      value: '24px',
    });
    expect(res.ok).toBe(true);
    expect(await Bun.file(r.abs).text()).toContain(
      '<div data-cd-id="card" style={{ padding: "24px" }}>Free</div>'
    );
  });

  test('the route answers with the edit-op 409 shape (code + message), keeping `error` for old callers', () => {
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const start = http.indexOf("'/_api/edit-css': async");
    const body = http.slice(start, http.indexOf("\n    '/_", start + 20));
    expect(body).toContain('...(result.code ? { code: result.code, message: result.error } : {})');
  });
});

// p8-lock-reasons (lead follow-up) — every other direct write route that names an object in a canvas source asks
// the same lookup: edit-text, edit-attr, reorder, delete-element, insert-element (into the object),
// convert-to-absolute and detach-component. Each refuses a locked object with the same 409 and leaves the file
// as it was; the same call on an unlocked object writes.
const MANY = `function Card() {
  return <article data-cd-id="art">card</article>;
}
export default function Knob() {
  return (
    <section data-cd-id="root">
      <div data-cd-id="hero" data-cd-locked style={{ padding: 8 }}>Locked</div>
      <div data-cd-id="card" style={{ padding: 8 }}>Free</div>
      <div data-cd-id="box" data-cd-locked style={{ display: 'flex' }}>
        <span data-cd-id="kid">k</span>
      </div>
      <div data-cd-id="box2" style={{ display: 'flex' }}>
        <span data-cd-id="kid2">k</span>
      </div>
      <Card data-cd-id="c1" data-cd-locked />
      <Card data-cd-id="c2" />
    </section>
  );
}`;

type Api = Awaited<ReturnType<typeof rig>>['api'];
type Answer = { ok: boolean; status?: number; code?: string; error?: string };
type Call = (api: Api, locked: boolean) => Promise<unknown>;
const kids = (container: string, child: string) => ({
  canvas: 'ui/Knob',
  containerId: container,
  containerSetRelative: true,
  children: [{ id: child, left: 0, top: 0, width: 10, height: 10 }],
});
const CALLS: Array<[string, Call]> = [
  [
    'edit-text',
    (api, l) => api.editText({ canvas: 'ui/Knob', id: l ? 'hero' : 'card', text: 'New words' }),
  ],
  [
    'edit-attr',
    (api, l) =>
      api.editAttr({ canvas: 'ui/Knob', id: l ? 'hero' : 'card', attr: 'title', value: 'x' }),
  ],
  [
    'reorder',
    (api, l) =>
      api.reorder({ canvas: 'ui/Knob', id: l ? 'hero' : 'card', refId: 'box2', position: 'after' }),
  ],
  [
    'delete-element',
    (api, l) => api.deleteElementOp({ canvas: 'ui/Knob', id: l ? 'hero' : 'card' }),
  ],
  [
    'insert-element (into it)',
    (api, l) =>
      api.insertElementOp({
        canvas: 'ui/Knob',
        refId: l ? 'box' : 'box2',
        position: 'inside-end',
        kind: 'div',
      }),
  ],
  [
    'convert-to-absolute (the container)',
    (api, l) => api.convertChildrenToAbsoluteOp(l ? kids('box', 'kid') : kids('box2', 'kid2')),
  ],
  [
    'detach-component (the instance used first is locked)',
    (api, l) => api.detachComponentOp({ canvas: 'ui/Knob', id: 'art', idIndex: l ? 0 : 1 }),
  ],
];

describe('p8-lock-reasons — every direct object write refuses a locked object', () => {
  for (const [name, call] of CALLS) {
    test(`${name}: locked → 409 locked, file unchanged; unlocked → written`, async () => {
      const locked = await rig(MANY);
      const no = (await call(locked.api, true)) as Answer;
      expect({ ok: no.ok, status: no.status, code: no.code }).toEqual({
        ok: false,
        status: 409,
        code: 'locked',
      });
      expect(no.error).toMatch(/ is locked · ⇧⌘L unlocks$/);
      expect(await Bun.file(locked.abs).text()).toBe(MANY);

      const free = await rig(MANY);
      const yes = (await call(free.api, false)) as Answer;
      expect({ ok: yes.ok, error: yes.error }).toEqual({ ok: true, error: undefined });
      expect(await Bun.file(free.abs).text()).not.toBe(MANY);
    });
  }

  test('a locked child of the container is refused too (convert-to-absolute names it)', async () => {
    const r = await rig(
      MANY.replace('<span data-cd-id="kid2">', '<span data-cd-id="kid2" data-cd-locked>')
    );
    const no = (await r.api.convertChildrenToAbsoluteOp(kids('box2', 'kid2'))) as Answer;
    expect(no.status).toBe(409);
  });

  test('the routes answer the edit-op 409 shape (code + message)', () => {
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    for (const route of [
      '/_api/edit-text',
      '/_api/edit-attr',
      '/_api/reorder',
      '/_api/delete-element',
      '/_api/insert-element',
      '/_api/convert-to-absolute',
      '/_api/detach-component',
    ]) {
      const start = http.indexOf(`'${route}': async`);
      expect(start).toBeGreaterThan(-1);
      const body = http.slice(start, http.indexOf("\n    '/_", start + 20));
      expect({ route, has: body.includes('code: result.code, message: result.error') }).toEqual({
        route,
        has: true,
      });
    }
  });
});
