// Audit 2026-09-13 P1 #5 / plan T5 — a CSS or attribute undo must not
// unconditionally overwrite a newer value a teammate wrote. The undo command
// carries the value it expects to find (`from`); the route refuses when the
// source holds anything else, and a retry of an already-applied write is an
// idempotent success rather than a false conflict.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { readAttributeState } from '../canvas-edit.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
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
}

const SRC = `export default function Knob() {
  return (
    <section>
      <div id="a" style={{ color: "red" }} data-tone="warm">Alpha</div>
      <div id="b">Beta</div>
    </section>
  );
}`;

function cdIds(abs: string, source: string): Record<string, string> {
  const { withIds } = transpileCanvasSource(abs, source);
  const out: Record<string, string> = {};
  for (const m of withIds.matchAll(/data-cd-id="([0-9a-f]{8})"[^>]*?\bid="([^"]+)"/g)) {
    out[m[2] as string] = m[1] as string;
  }
  return out;
}

async function mkRig() {
  const { root, designRoot } = makeSandbox();
  const abs = join(designRoot, 'ui', 'Knob.tsx');
  await Bun.write(abs, SRC);
  const api = createApi(mkCtx(root, designRoot), { onCommentsChanged: () => {} });
  const ids = cdIds(abs, SRC);
  const read = async (attr: string, id = ids.a as string) =>
    readAttributeState(abs, await Bun.file(abs).text(), id, attr);
  return { abs, api, ids, read };
}

describe('readAttributeState', () => {
  test('reports literal, absent and expression values', async () => {
    const { abs, ids } = await mkRig();
    const src = `export default () => <p id="a" style={{ color: "red", top: 4, ...x }} title={"t"} data-y={z}>x</p>;`;
    const id = cdIds(abs, src).a as string;
    expect(readAttributeState(abs, src, id, 'style.color')).toEqual({
      kind: 'literal',
      value: 'red',
    });
    expect(readAttributeState(abs, src, id, 'style.top')).toEqual({ kind: 'literal', value: '4' });
    // A spread may supply an absent key at runtime — never guess "absent".
    expect(readAttributeState(abs, src, id, 'style.margin')).toEqual({ kind: 'expression' });
    expect(readAttributeState(abs, src, id, 'title')).toEqual({ kind: 'literal', value: 't' });
    expect(readAttributeState(abs, src, id, 'data-y')).toEqual({ kind: 'expression' });
    expect(readAttributeState(abs, src, id, 'lang')).toEqual({ kind: 'absent' });
    expect(ids.a).toBeDefined();
  });
});

describe('css precondition', () => {
  test('undo applies when the source still holds the expected value', async () => {
    const { api, ids, read } = await mkRig();
    const res = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'blue',
      expected: 'red',
    });
    expect(res.ok).toBe(true);
    expect(await read('style.color')).toEqual({ kind: 'literal', value: 'blue' });
  });

  test("undo refuses to overwrite a teammate's newer value", async () => {
    const { api, ids, read } = await mkRig();
    // A peer changed red → green after our edit recorded red.
    await api.editCss({ canvas: 'ui/Knob', id: ids.a, property: 'color', value: 'green' });
    const res = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'black',
      expected: 'red',
    });
    expect(res).toMatchObject({ ok: false, status: 409, conflict: true });
    expect(await read('style.color')).toEqual({ kind: 'literal', value: 'green' });
  });

  test('a retried write that already landed is an idempotent success', async () => {
    const { api, ids, read } = await mkRig();
    const first = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'blue',
      expected: 'red',
    });
    const again = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'blue',
      expected: 'red',
    });
    expect(first.ok && again.ok).toBe(true);
    expect(again).toMatchObject({ ok: true, delta: 0 });
    expect(await read('style.color')).toEqual({ kind: 'literal', value: 'blue' });
  });

  test('expected null means "currently unset"', async () => {
    const { api, ids, read } = await mkRig();
    const set = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.b,
      property: 'color',
      value: 'blue',
      expected: null,
    });
    expect(set.ok).toBe(true);
    expect(await read('style.color', ids.b)).toEqual({ kind: 'literal', value: 'blue' });
    // Now set — a second "expected unset" write is a conflict, not an overwrite.
    const again = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.b,
      property: 'color',
      value: 'pink',
      expected: null,
    });
    expect(again).toMatchObject({ ok: false, status: 409, conflict: true });
  });

  test('a reset (undo back to unset) is guarded the same way', async () => {
    const { api, ids, read } = await mkRig();
    await api.editCss({ canvas: 'ui/Knob', id: ids.a, property: 'color', value: 'green' });
    const refused = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      reset: true,
      expected: 'red',
    });
    expect(refused).toMatchObject({ ok: false, status: 409, conflict: true });
    expect(await read('style.color')).toEqual({ kind: 'literal', value: 'green' });
    const applied = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      reset: true,
      expected: 'green',
    });
    expect(applied.ok).toBe(true);
    expect(await read('style.color')).toEqual({ kind: 'absent' });
  });

  test('without expected the legacy unconditional write is unchanged', async () => {
    const { api, ids, read } = await mkRig();
    const res = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'teal',
    });
    expect(res.ok).toBe(true);
    expect(await read('style.color')).toEqual({ kind: 'literal', value: 'teal' });
  });

  test('a malformed expected value is refused before any write', async () => {
    const { api, ids, read } = await mkRig();
    const res = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'teal',
      expected: 42,
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(await read('style.color')).toEqual({ kind: 'literal', value: 'red' });
  });
});

describe('attr precondition', () => {
  test("undo refuses to overwrite a teammate's attribute and applies when unchanged", async () => {
    const { api, ids, read } = await mkRig();
    await api.editAttr({ canvas: 'ui/Knob', id: ids.a, attr: 'data-tone', value: 'cool' });
    const refused = await api.editAttr({
      canvas: 'ui/Knob',
      id: ids.a,
      attr: 'data-tone',
      value: 'neutral',
      expected: 'warm',
    });
    expect(refused).toMatchObject({ ok: false, status: 409, conflict: true });
    expect(await read('data-tone')).toEqual({ kind: 'literal', value: 'cool' });
    const applied = await api.editAttr({
      canvas: 'ui/Knob',
      id: ids.a,
      attr: 'data-tone',
      reset: true,
      expected: 'cool',
    });
    expect(applied.ok).toBe(true);
    expect(await read('data-tone')).toEqual({ kind: 'absent' });
  });
});

// The undo entry must record what the write REPLACED, read server-side under
// the file lock — the inspector's own value can be a teammate's edit old
// (the canvas does not re-post a selection when a peer changes the source).
describe('writes report what they replaced', () => {
  test('css set, css reset and attr set each return `previous`', async () => {
    const { api, ids } = await mkRig();
    const set = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      value: 'blue',
    });
    expect(set).toMatchObject({ ok: true, previous: 'red' });
    const fresh = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.b,
      property: 'color',
      value: 'blue',
    });
    expect(fresh).toMatchObject({ ok: true, previous: null });
    const reset = await api.editCss({
      canvas: 'ui/Knob',
      id: ids.a,
      property: 'color',
      reset: true,
    });
    expect(reset).toMatchObject({ ok: true, previous: 'blue' });
    const attr = await api.editAttr({
      canvas: 'ui/Knob',
      id: ids.a,
      attr: 'data-tone',
      value: 'cool',
    });
    expect(attr).toMatchObject({ ok: true, previous: 'warm' });
  });
});
