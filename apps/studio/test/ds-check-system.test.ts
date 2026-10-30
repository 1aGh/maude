// S10.19 (S10 Q9, Q10): "Check the system" (13 · ds-advanced) and Design system › Advanced's file view.
// Deterministic: the schema level, a contrast matrix over both themes and completeness; every line is computed
// from those facts, kept in `_state/ds-check/<ds>.json`, and served by the routes and `ds check-system` alike.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import {
  CHECK_FORMAT,
  checkFileOf,
  computeSystemCheck,
  lastSystemCheck,
  linesOf,
  runSystemCheck,
  shortWords,
} from '../ds/check-system.ts';
import {
  CheckUsageError,
  checkText,
  execCheckPlan,
  planCheckVerb,
} from '../ds/check-system-verb.ts';
import { emitTokensJson } from '../ds/emit.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { loadSystem } from '../ds/system.ts';
import { abbreviateCss, abbreviateJson, filesOf, historyOf } from '../ds/system-files.ts';
import { createDsCheckRoutes } from '../routes/ds-check.ts';
import type { RouteSpec } from '../routes/table.ts';
import { cleanup, DS, DS_PATH, makeProject, type Project } from './_ds-engine-fixture.ts';
import { conformantFiles, fixtureConfig, memFs } from './_ds-fixture.ts';

afterAll(cleanup);

const CSS = (light: string[], dark: string[]) => `/* acme */
:root,
.acme[data-theme="light"],
.ds[data-theme="light"] {
${light.map((l) => `  ${l};`).join('\n')}
}

.acme[data-theme="dark"],
.ds[data-theme="dark"] {
${dark.map((l) => `  ${l};`).join('\n')}
}
`;

async function project(css: string): Promise<Project> {
  const p = await makeProject({ kernel: null });
  p.write(`${DS_PATH}/colors_and_type.css`, css);
  return p;
}
const sysOf = (p: Project) => {
  const s = p.engine.systems().find((x) => x.name === DS);
  if (!s) throw new Error('no system');
  return s;
};

describe('check-system — the contrast matrix', () => {
  test('it counts the pairs in both themes and names the one that falls short, with its ratio and the bar', async () => {
    const p = await project(
      CSS(
        ['--bg-0: #ffffff', '--fg-0: #111111', '--fg-3: #999999'],
        ['--bg-0: #000000', '--fg-0: #eeeeee', '--fg-3: #888888']
      )
    );
    const r = computeSystemCheck(p.designRoot, sysOf(p));
    // (--fg-0, --bg-0) and (--fg-3, --bg-0) in Light and in Dark
    expect(r.contrast).toMatchObject({ themes: ['light', 'dark'], total: 4, pass: 3 });
    expect(r.contrast.fails).toHaveLength(1);
    const f = r.contrast.fails[0];
    expect(f).toMatchObject({ theme: 'light', fg: '--fg-3', bg: '--bg-0', need: 3 });
    expect(f?.ratio).toBeGreaterThan(2.7);
    expect(f?.ratio).toBeLessThan(3);
    const head = r.lines.find((l) => l.id === 'contrast');
    expect(head).toMatchObject({ ok: false, text: '3 of 4 text pairs pass, Light and Dark' });
    const pair = r.lines.find((l) => l.id === 'pair');
    expect(pair).toMatchObject({ ok: false, show: '--fg-3' });
    expect(pair?.text).toBe('Light: 2.8:1 — below 3:1');
  });

  test('a pair just under the text bar but over 3:1 is "large text only"', () => {
    expect(shortWords({ theme: 'dark', ratio: 4.2, need: 4.5 })).toBe(
      'Dark: 4.2:1 — large text only'
    );
    expect(shortWords({ theme: 'dark', ratio: 2.9, need: 4.5 })).toBe('Dark: 2.9:1 — below 4.5:1');
  });

  test('when every pair passes, the line says so and no pair row follows', async () => {
    const p = await project(
      CSS(['--bg-0: #ffffff', '--fg-0: #111111'], ['--bg-0: #000000', '--fg-0: #eeeeee'])
    );
    const r = computeSystemCheck(p.designRoot, sysOf(p));
    expect(r.contrast).toMatchObject({ total: 2, pass: 2 });
    expect(r.lines.find((l) => l.id === 'contrast')).toMatchObject({
      ok: true,
      text: 'All 2 text pairs pass, Light and Dark',
    });
    expect(r.lines.some((l) => l.id === 'pair')).toBe(false);
  });

  test('a value that is not a plain colour is not judged, not failed', async () => {
    const p = await project(
      CSS(
        ['--bg-0: linear-gradient(#fff, #eee)', '--fg-0: #111111'],
        ['--bg-0: #000000', '--fg-0: #eeeeee']
      )
    );
    const r = computeSystemCheck(p.designRoot, sysOf(p));
    expect(r.contrast.unjudged).toBe(1);
    expect(r.contrast).toMatchObject({ total: 1, pass: 1 });
  });

  test('a long list of failures names the worst few and counts the rest', () => {
    const fails = Array.from({ length: 7 }, (_, i) => ({
      theme: 'light',
      fg: `--fg-${i}`,
      bg: '--bg-0',
      fgLabel: `Text ${i}`,
      bgLabel: 'Page',
      need: 4.5,
      ratio: 2 + i / 10,
    }));
    const lines = linesOf({
      schema: { level: 0, reasons: [] },
      contrast: { themes: ['light', 'dark'], total: 20, pass: 13, unjudged: 0, fails },
      complete: { sections: { done: 7, of: 7, waiting: [] }, bothModes: true, reducedMotion: true },
    });
    const pairs = lines.filter((l) => l.id === 'pair');
    expect(pairs).toHaveLength(5);
    expect(pairs[0]?.title).toBe('Text 0 on Page');
    expect(pairs.at(-1)).toMatchObject({ title: 'And more', text: '3 more pairs fall short' });
  });
});

describe('check-system — what the Complete line says', () => {
  const base = {
    schema: { level: 0 as const, reasons: [] },
    contrast: { themes: ['light', 'dark'], total: 0, pass: 0, unjudged: 0, fails: [] },
  };
  const line = (complete: Parameters<typeof linesOf>[0]['complete']) =>
    linesOf({ ...base, complete }).find((l) => l.id === 'complete');

  test('it names what is waiting, then what is missing besides', () => {
    expect(
      line({
        sections: { done: 4, of: 7, waiting: ['Motion', 'Components', 'Patterns'] },
        bothModes: false,
        reducedMotion: false,
      })
    ).toMatchObject({
      ok: false,
      text: '4 of 7 sections — Motion, Components and Patterns waiting · one mode only · no reduced motion',
    });
    expect(
      line({
        sections: {
          done: 0,
          of: 7,
          waiting: ['Brand', 'Colour', 'Type', 'Space & shape', 'Motion', 'Components', 'Patterns'],
        },
        bothModes: true,
        reducedMotion: true,
      })?.text
    ).toBe('0 of 7 sections — Brand, Colour, Type and 4 more waiting');
    expect(
      line({ sections: { done: 7, of: 7, waiting: [] }, bothModes: true, reducedMotion: false })
    ).toMatchObject({ ok: false, text: 'no reduced motion' });
  });
});

describe('check-system — completeness and the schema', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('seven sections, both modes and reduced motion read as one line; losing reduced motion changes it', () => {
    const cfg = fixtureConfig({
      name: DS,
      path: DS_PATH,
      rootClass: 'acme',
      tokensCssRel: `${DS_PATH}/colors_and_type.css`,
    });
    const files = conformantFiles(cfg);
    const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-check-'));
    dirs.push(root);
    const designRoot = path.join(root, '.design');
    const put = (rel: string, text: string) => {
      mkdirSync(path.dirname(path.join(designRoot, rel)), { recursive: true });
      writeFileSync(path.join(designRoot, rel), text);
    };
    for (const [rel, text] of Object.entries(files)) put(rel, text);
    const without = computeSystemCheck(designRoot, cfg);
    expect(without.complete.reducedMotion).toBe(false);
    expect(without.lines.find((l) => l.id === 'complete')).toMatchObject({
      ok: false,
      text: expect.stringContaining('no reduced motion'),
    });
    const css = `${files[`${DS_PATH}/colors_and_type.css`]}\n@media (prefers-reduced-motion: reduce) {\n  :root { --dur-fast: 1ms; }\n}\n`;
    const next = { ...files, [`${DS_PATH}/colors_and_type.css`]: css };
    // the manifest is generated from the CSS; a CSS that moved without it is a different finding (manifest-stale)
    put(`${DS_PATH}/colors_and_type.css`, css);
    put(
      `${DS_PATH}/tokens.json`,
      emitTokensJson(loadSystem(memFs(next), cfg), indexRegistry(loadRegistry()), null)
    );
    const withMotion = computeSystemCheck(designRoot, cfg);
    expect(withMotion.complete).toMatchObject({
      bothModes: true,
      reducedMotion: true,
      sections: { done: 7, of: 7, waiting: [] },
    });
    expect(withMotion.lines.find((l) => l.id === 'complete')).toMatchObject({
      ok: true,
      text: '7 sections, both modes, reduced motion',
    });
    expect(withMotion.lines.find((l) => l.id === 'schema')).toMatchObject({
      ok: true,
      text: 'Follows the schema — switches cleanly with any system that does',
    });
  });

  test('a system with one mode, and names missing, says which sections are waiting', async () => {
    const p = await project(CSS(['--bg-0: #ffffff', '--fg-0: #111111'], []));
    const r = computeSystemCheck(p.designRoot, sysOf(p));
    expect(r.schema.level).toBeGreaterThan(0);
    expect(r.complete.sections.done).toBeLessThan(7);
    expect(r.complete.sections.waiting.length).toBeGreaterThan(0);
    const line = r.lines.find((l) => l.id === 'complete');
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain('waiting');
    expect(r.lines.find((l) => l.id === 'schema')?.ok).toBe(false);
  });
});

describe('check-system — what is kept', () => {
  test('a run writes _state/ds-check/<ds>.json; the last answer reads back', async () => {
    const p = await project(
      CSS(['--bg-0: #ffffff', '--fg-0: #111111'], ['--bg-0: #000000', '--fg-0: #eeeeee'])
    );
    expect(lastSystemCheck(p.designRoot, DS)).toBeNull();
    const ran = runSystemCheck(p.designRoot, sysOf(p));
    const file = path.join(p.designRoot, '_state', 'ds-check', `${DS}.json`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).format).toBe(CHECK_FORMAT);
    expect(lastSystemCheck(p.designRoot, DS)).toEqual(ran);
  });

  test('a planted or unreadable file is no answer, and a name that is a path is never a file', async () => {
    const p = await project(CSS(['--bg-0: #ffffff'], []));
    const file = checkFileOf(p.designRoot, DS) as string;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{"format":"something-else","v":1}');
    expect(lastSystemCheck(p.designRoot, DS)).toBeNull();
    writeFileSync(file, 'not json');
    expect(lastSystemCheck(p.designRoot, DS)).toBeNull();
    for (const bad of ['../x', 'a/b', '.hidden', '', 'x'.repeat(65)])
      expect(checkFileOf(p.designRoot, bad)).toBeNull();
  });
});

describe('Advanced — the files view', () => {
  test('a tokens file is shortened block by block: the first names, then how many more', () => {
    const decls = Array.from({ length: 10 }, (_, i) => `  --t-${i}: ${i}px;`).join('\n');
    const out = abbreviateCss(
      `:root {\n${decls}\n}\n\n[data-theme="dark"] {\n  --a: 1;\n  --b: 2;\n}\n`
    );
    const lines = out.split('\n');
    expect(lines.filter((l) => l.includes('--t-'))).toHaveLength(6);
    expect(out).toContain('…  /* 4 more */');
    expect(out).toContain('[data-theme="dark"] {');
    expect(out).toContain('--b: 2;');
    // a short file is whole
    expect(abbreviateCss(':root {\n  --a: 1;\n}\n')).toBe(':root {\n  --a: 1;\n}');
  });

  test('a long file header is one line: the view starts at the tokens (the board draws :root first)', () => {
    const head = [
      '/*',
      ' * maude-v2 — design tokens',
      ' * Authoritative token file.',
      ' * More notes.',
      ' * Even more.',
      ' */',
    ].join('\n');
    const out = abbreviateCss(`${head}\n:root {\n  --a: 1;\n}\n`);
    expect(out.split('\n')).toEqual([
      '/* maude-v2 — design tokens … */',
      ':root {',
      '  --a: 1;',
      '}',
    ]);
    // a short header stays whole
    expect(abbreviateCss('/* a */\n:root {\n  --a: 1;\n}\n')).toBe(
      '/* a */\n:root {\n  --a: 1;\n}'
    );
  });

  test('a long file stops after the line cap and says how many lines it left', () => {
    const many = Array.from({ length: 80 }, (_, i) => `/* c${i} */`).join('\n');
    const out = abbreviateCss(many, 6, 10);
    expect(out.split('\n')).toHaveLength(11);
    expect(out.split('\n').at(-1)).toBe('…  /* 70 more lines */');
    expect(abbreviateJson(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), 5)).toContain(
      '…  /* 25 more lines */'
    );
  });

  test('the folder is a short list: tokens, docs, specimens counted, assets by kind', async () => {
    const p = await makeProject({ kernel: null });
    p.write(`${DS_PATH}/tokens.json`, '{}');
    p.write(`${DS_PATH}/README.md`, '# r');
    p.write(`${DS_PATH}/SKILL.md`, '# s');
    for (const n of ['colors-a', 'colors-b', 'type-a', '_components'])
      p.write(`${DS_PATH}/preview/${n}.tsx`, 'export default () => null;');
    p.write(`${DS_PATH}/assets/logos/mark.svg`, '<svg/>');
    p.write(`${DS_PATH}/assets/fonts/x.txt`, 'x');
    const rows = filesOf(p.designRoot, sysOf(p));
    expect(rows[0]).toEqual({ kind: 'folder', names: [`${DS_PATH}/`], depth: 0 });
    expect(rows).toContainEqual({
      kind: 'file',
      names: ['colors_and_type.css', 'tokens.json'],
      depth: 1,
    });
    expect(rows).toContainEqual({
      kind: 'file',
      names: ['README.md', 'SKILL.md'],
      note: 'voice, rules',
      depth: 1,
    });
    expect(rows).toContainEqual({
      kind: 'folder',
      names: ['preview/'],
      note: '3 specimen pages',
      depth: 1,
    });
    expect(rows).toContainEqual({
      kind: 'folder',
      names: ['assets/'],
      note: 'fonts, logos',
      depth: 1,
    });
  });

  test('the history is the head log, newest first, in the hands that did it', () => {
    const rev = (n: number) => String(n).repeat(64);
    const rows = historyOf([
      { rev: rev(1), action: 'make', at: '2026-10-06T14:05:00Z', by: { kind: 'ai' } },
      { rev: rev(2), action: 'keep', at: '2026-10-20T09:00:00Z', by: { kind: 'agent' } },
      {
        rev: rev(3),
        action: 'publish',
        at: '2026-10-20T10:00:00Z',
        by: { kind: 'person', name: 'Michal' },
        summary: 'Accent → Deeper azure',
        updated: 4,
      },
    ]);
    expect(rows.map((r) => [r.who, r.kind])).toEqual([
      ['Michal', 'person'],
      ['Claude Code', 'file'],
      ['AI', 'ai'],
    ]);
    expect(rows[0]?.text).toBe('Accent → Deeper azure · 4 canvases updated');
    expect(rows[1]?.text).toBe('Kept a change made in the files');
    expect(rows[2]?.text).toBe('Made the Design system');
  });
});

describe('the routes and the verb', () => {
  const claims: Record<string, AccessClaim> = {
    view: { v: 1, role: 'observer' },
    edit: { v: 1, role: 'member' },
    homeOnly: { v: 1, role: null, grants: [{ c: 'ui/Home.tsx', r: 'member' }] },
  };
  const specs = (p: Project, who: keyof typeof claims): RouteSpec[] =>
    createDsCheckRoutes({
      engine: () => p.engine,
      access: () => resolveAccess(claims[who]),
      person: async () => ({ name: 'Michal' }),
    });
  async function call(s: RouteSpec[], method: 'GET' | 'POST', route: string, body?: object) {
    const [pathname, query] = route.split('?');
    const spec = s.find((x) => x.method === method && x.path === pathname);
    if (!spec) throw new Error(`no ${method} ${pathname}`);
    const url = `http://localhost${pathname}${query ? `?${query}` : ''}`;
    const req =
      method === 'GET'
        ? new Request(url)
        : new Request(url, {
            method,
            body: JSON.stringify(body ?? {}),
            headers: { 'content-type': 'application/json' },
          });
    const res = await spec.handle(req, {});
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  test('Can view reads the last answer and the files; running is Can edit; a hidden system does not exist', async () => {
    const p = await project(
      CSS(['--bg-0: #ffffff', '--fg-0: #111111'], ['--bg-0: #000000', '--fg-0: #eeeeee'])
    );
    const view = specs(p, 'view');
    expect((await call(view, 'GET', `/_api/ds/check-system?ds=${DS}`)).json.check).toBeNull();
    expect((await call(view, 'POST', '/_api/ds/check-system', { ds: DS })).status).toBe(403);
    expect(lastSystemCheck(p.designRoot, DS)).toBeNull();
    const files = await call(view, 'GET', `/_api/ds/system-files?ds=${DS}`);
    expect(files.status).toBe(200);
    expect(files.json).toMatchObject({
      format: 'maude.ds-system-files',
      ds: DS,
      folder: `${DS_PATH}/`,
    });
    const ran = await call(specs(p, 'edit'), 'POST', '/_api/ds/check-system', { ds: DS });
    expect(ran.status).toBe(200);
    expect(ran.json.lines.length).toBeGreaterThan(0);
    const last = await call(view, 'GET', `/_api/ds/check-system?ds=${DS}`);
    expect(last.json.check.at).toBe(ran.json.at);
    // a session that cannot see the system gets the answer of a system that is not there
    const hidden = await call(specs(p, 'homeOnly'), 'GET', `/_api/ds/check-system?ds=${DS}`);
    const none = await call(specs(p, 'edit'), 'GET', '/_api/ds/check-system?ds=nope');
    expect(hidden.status).toBe(404);
    expect(hidden.json.code).toBe(none.json.code);
    expect((await call(specs(p, 'edit'), 'POST', '/_api/ds/check-system', { ds: 5 })).status).toBe(
      404
    );
  });

  test('the verb says the route’s answer, in-process or through the studio', async () => {
    const p = await project(
      CSS(['--bg-0: #ffffff', '--fg-0: #111111'], ['--bg-0: #000000', '--fg-0: #eeeeee'])
    );
    const plan = planCheckVerb(['check-system', DS, '--json']);
    expect(plan).toEqual({ ds: DS, json: true, root: null });
    const inproc = await execCheckPlan(plan, { root: p.root, studio: null });
    expect(inproc.status).toBe(200);
    const viaRoute = await call(specs(p, 'edit'), 'POST', '/_api/ds/check-system', { ds: DS });
    const strip = (v: any) => ({ ...v, at: 'x' });
    expect(strip(inproc.body)).toEqual(strip(viaRoute.json));
    expect(checkText(inproc.body as any)).toContain('Contrast — All 2 text pairs pass');
    // a verb that is not asked right
    for (const bad of [['check-system'], ['check-system', 'a', 'b'], ['check-system', DS, '--fix']])
      expect(() => planCheckVerb(bad)).toThrow(CheckUsageError);
  });
});
