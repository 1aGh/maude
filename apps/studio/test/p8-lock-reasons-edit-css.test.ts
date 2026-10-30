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

async function rig() {
  const { root, designRoot } = makeSandbox();
  const abs = join(designRoot, 'ui', 'Knob.tsx');
  await Bun.write(abs, SRC);
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
    expect(body).toContain("...(result.code ? { code: result.code, message: result.error } : {})");
  });
});
