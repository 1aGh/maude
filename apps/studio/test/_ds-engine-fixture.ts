// S10.2 test fixture: a scratch project with one CONVERTED design system (`acme`: R0 written, head =
// base = R0), three canvases that follow it, its Design system canvas, a real local home (the
// in-process kernel over bun:sqlite) and a DS engine whose kernel port is that home. Never this
// repo's `.design`, never ~/.config/maude.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDsEngine, type DsEngine, type DsKernelPort } from '../ds/engine.ts';
import { type HeadDoc, newHead, readHead, writeHead } from '../ds/head.ts';
import { buildRevision, revisionWritePlan } from '../ds/revision.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

export const DS = 'acme';
export const DS_PATH = 'system/acme';
export const PERSON = { kind: 'person', name: 'Michal' } as const;

export const TOKENS_CSS = `/* acme tokens */
:root,
.acme[data-theme="light"],
.ds[data-theme="light"] {
  --accent: oklch(0.55 0.2 255);
  --fg-0: #111111;
  --x-line-fine: #dddddd;
  --x-line-mid: #bbbbbb;
}

.acme[data-theme="dark"],
.ds[data-theme="dark"] {
  --accent: oklch(0.65 0.2 255);
  --fg-0: #eeeeee;
  --x-line-fine: #333333;
  --x-line-mid: #555555;
}
`;
export const COMPONENTS_CSS = `.btn {
  border-radius: 4px;
}
`;

const CONFIG = {
  designSystems: [
    {
      name: DS,
      path: DS_PATH,
      themes: ['light', 'dark'],
      themeDefault: 'light',
      rootClass: 'acme',
    },
  ],
  defaultDesignSystem: DS,
  canvasGroups: [{ path: 'ui' }, { path: 'system' }],
};

export const canvasTsx = (title: string, pinned = false) =>
  `export default () => <section><h1>${title}</h1><button className="btn"${pinned ? ' data-ds-rev="head"' : ''}>Go</button></section>;\n`;

const dirs: string[] = [];
const homes: LocalHome[] = [];
export function cleanup() {
  for (const h of homes.splice(0)) h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export interface Project {
  root: string;
  designRoot: string;
  dsAbs: string;
  R0: string;
  home: LocalHome;
  engine: DsEngine;
  read(rel: string): string | null;
  write(rel: string, text: string): void;
  meta(canvasRel: string): Record<string, unknown>;
  head(): HeadDoc;
  /** an outside edit the watcher records (kind `outside`) */
  outside(rel: string, text: string): Promise<void>;
  undo(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
}

export async function makeProject(
  o: { machine?: string; kernel?: DsKernelPort | null } = {}
): Promise<Project> {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-engine-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const dsAbs = path.join(designRoot, DS_PATH);
  const write = (rel: string, text: string) => {
    const abs = path.join(designRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const read = (rel: string) => {
    const abs = path.join(designRoot, rel);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  write('config.json', `${JSON.stringify(CONFIG, null, 2)}\n`);
  write(`${DS_PATH}/colors_and_type.css`, TOKENS_CSS);
  write(`${DS_PATH}/preview/_components.css`, COMPONENTS_CSS);
  write(`${DS_PATH}/design-system.tsx`, canvasTsx('Design system'));
  write(
    `${DS_PATH}/design-system.meta.json`,
    `${JSON.stringify({ title: 'Design system' }, null, 2)}\n`
  );
  for (const c of ['Home', 'Landing', 'Pricing']) {
    write(`ui/${c}.tsx`, canvasTsx(c, c === 'Pricing'));
    write(`ui/${c}.meta.json`, `${JSON.stringify({ title: c }, null, 2)}\n`);
  }
  // conversion (S10.12's job; done by hand here): R0 = the working files, head = base = R0
  const R0 = buildRevision(DS, {
    'colors_and_type.css': TOKENS_CSS,
    'preview/_components.css': COMPONENTS_CSS,
  });
  for (const w of revisionWritePlan(() => null, R0, {})) write(`${DS_PATH}/${w.path}`, w.text);
  writeHead(dsAbs, newHead(DS, { head: R0.id, base: R0.id }), 'absent');

  const home = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => CONFIG.canvasGroups,
    machine: { id: o.machine ?? 'm_ds', name: 'Mac' },
    bootId: 'boot-ds',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(home);
  await home.ready();
  const port: DsKernelPort = {
    propose: (files, action) => home.runtime.proposeFiles(files, action),
  };
  const engine = createDsEngine({
    designRoot,
    kernel: o.kernel === undefined ? port : o.kernel,
    log: { warn() {}, error() {} },
  });
  const undoSpec = createProjectUndoRoutes({
    control: () => home.runtime,
    designRel: '.design',
  }).find((s) => s.method === 'POST' && s.path === '/_api/project/undo');
  return {
    root,
    designRoot,
    dsAbs,
    R0: R0.id,
    home,
    engine,
    read,
    write,
    meta: (c) => JSON.parse(read(c.replace(/\.tsx$/, '.meta.json')) ?? '{}'),
    head: () => {
      const h = readHead(dsAbs);
      if (h.state !== 'ok') throw new Error(`head.json is ${h.state}`);
      return h.doc;
    },
    outside: async (rel, text) => {
      write(rel, text);
      home.observe(rel);
      await home.flush();
    },
    undo: async (body) => {
      const res = await (
        undoSpec as unknown as { handle: (r: Request) => Promise<Response> }
      ).handle(
        new Request('http://localhost/_api/project/undo', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        })
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
}

export const ACCENT = (light: string, dark: string) => ({ '--accent': { light, dark } });
