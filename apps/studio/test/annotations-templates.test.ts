// annotations-templates — S4.4. The templates are ONE list (annotations/templates.ts) behind the
// Templates panel, the ⌘K rows and `maude design annotate <canvas> --board <template-id>`. Rule 14:
// what the person's pick expands to and what the verb writes are the same elements, because both
// feed the same spec to the same layout engine.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTemplate, TEMPLATES, templateBoard } from '../annotations/templates.ts';

const BIN = new URL('../bin/annotate.mjs', import.meta.url).pathname;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'annotations-templates-'));
  mkdirSync(join(root, '.design'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function annotate(args: string[], stdin?: unknown) {
  const proc = Bun.spawnSync(['bun', BIN, ...args, '--root', root], {
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(JSON.stringify(stdin)),
  });
  return {
    code: proc.exitCode ?? 1,
    out: new TextDecoder().decode(proc.stdout),
    err: new TextDecoder().decode(proc.stderr),
  };
}

type Put = { op: string; el: Record<string, unknown> };

/** The dry-run ops with their random element ids (`s_xxxxxxxx`, also inside arrow binds) renamed by order of appearance. */
function normalise(ops: Put[]): unknown {
  const names = new Map<string, string>();
  const text = JSON.stringify(ops).replace(/s_[a-z0-9]{8}/g, (id) => {
    if (!names.has(id)) names.set(id, `e${names.size}`);
    return names.get(id) as string;
  });
  return JSON.parse(text);
}

describe('the template list', () => {
  test('eight templates, the canvas-15 titles, unique ids, every one with a thumbnail', () => {
    expect(TEMPLATES.map((t) => t.title)).toEqual([
      'Kanban',
      'Retro',
      'Flowchart',
      'Content calendar',
      'Roadmap',
      'Brainstorm',
      'Checklist',
      'Blank section',
    ]);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(8);
    for (const t of TEMPLATES) expect(t.thumb).toBeTruthy();
  });

  test('templateBoard hands out a fresh copy; an unknown id is null', () => {
    const a = templateBoard('kanban');
    expect(a).toEqual(findTemplate('kanban')?.board);
    a?.groups?.push({ title: 'extra' });
    expect(findTemplate('kanban')?.board.groups).toHaveLength(3);
    expect(templateBoard('nope')).toBeNull();
    expect(findTemplate(undefined)).toBeNull();
  });
});

describe('annotate --board <template-id> (UI path == verb path)', () => {
  for (const t of TEMPLATES) {
    test(`${t.id}: the id writes exactly what the template's spec does`, () => {
      const byId = annotate(['ui/T.tsx', '--board', t.id, '--dry-run']);
      expect(byId.code).toBe(0);
      const specFile = join(root, `${t.id}.json`);
      writeFileSync(specFile, JSON.stringify(templateBoard(t.id)));
      const bySpec = annotate(['ui/T.tsx', '--board', specFile, '--dry-run']);
      expect(bySpec.code).toBe(0);
      const ops = JSON.parse(byId.out).ops as Put[];
      expect(ops.length).toBeGreaterThan(0);
      expect(normalise(ops)).toEqual(normalise(JSON.parse(bySpec.out).ops));
    });
  }

  test('a kanban is three titled sections with their stickies inside', () => {
    const res = annotate(['ui/T.tsx', '--board', 'kanban', '--dry-run']);
    const ops = JSON.parse(res.out).ops as Put[];
    const sections = ops.filter((o) => o.el.type === 'section');
    expect(sections.map((o) => o.el.label)).toEqual(['To do', 'Doing', 'Done']);
    const ids = new Set(sections.map((o) => o.el.id));
    const stickies = ops.filter((o) => o.el.type === 'sticky');
    expect(stickies).toHaveLength(4);
    for (const st of stickies) expect(ids.has(st.el.parent as string)).toBe(true);
  });

  test('a file path that is not a template id still reads as a file', () => {
    const res = annotate(['ui/T.tsx', '--board', join(root, 'missing.json'), '--dry-run']);
    expect(res.code).toBe(2);
    expect(res.err).toContain('input not found');
  });
});
