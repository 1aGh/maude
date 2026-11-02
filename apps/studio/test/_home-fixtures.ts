// Shared fixtures for the Home server tests (V2-3.3): temp projects with a real snapshot in a
// temp machine index, and an in-process Home fetch. Never touches ~/Maude or ~/.maude.

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NEW_PROJECT_FORMAT } from '../format.ts';
import { createHomeAi } from '../home/ai.ts';
import { createHomeCli } from '../home/cli.ts';
import { createHomeCloud } from '../home/cloud.ts';
import { createHomeFetch, type HomeDeps } from '../home/routes.ts';
import { createIndexService } from '../index/service.ts';
import { pidOf } from '../index/snapshot.ts';
import { writeThumb } from '../thumbs/store.ts';

export const TOKEN = 'ab'.repeat(32);
/** The per-spawn Home PAGE secret (V2-3.6 H1) — what `home_session()` hands the Home window. */
export const PAGE_SECRET = 'ef'.repeat(32);

/** Point the machine index at a fresh temp dir (indexDir() reads the env on every call). */
export function freshIndexDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maude-home-index-'));
  process.env.MAUDE_INDEX_DIR = dir;
  return dir;
}

export interface FixtureProject {
  root: string;
  designRoot: string;
  pid: string;
}

const canvas = (label: string, id: string) =>
  `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="${id}" label="${label}" width={400} height={300} />
    </DesignCanvas>
  );
}
`;

/** A project with `canvases` under ui/, indexed into the current MAUDE_INDEX_DIR. */
export function makeProject(name: string, canvases: Record<string, string>): FixtureProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `maude-home-${name}-`)));
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({
      name,
      designRoot: '.design',
      // A project a person uses is a v2 project: the format gate opens format 1 view only
      // (format.ts FORMAT_GATE_OPTS), and the desktop e2e lanes drive these projects.
      formatVersion: NEW_PROJECT_FORMAT,
      canvasGroups: [{ label: 'UI', path: 'ui' }],
    })
  );
  for (const [rel, label] of Object.entries(canvases)) {
    const abs = join(designRoot, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, canvas(label, label.toLowerCase().replace(/\W+/g, '-')));
  }
  indexProject(root, name);
  return { root, designRoot, pid: pidOf(root) };
}

/** (Re)write a project's snapshot the way its own server does. */
export function indexProject(root: string, name: string) {
  const designRoot = join(root, '.design');
  const svc = createIndexService({
    root,
    designRel: '.design',
    context: () => ({
      designRoot,
      repoRoot: root,
      groups: [{ label: 'UI', path: 'ui' }],
      defaultDs: null,
      designSystems: [],
    }),
    project: () => ({ name, label: null, formatVersion: 2, linkedHub: null, managed: false }),
    persist: true,
  });
  svc.flush();
  svc.stop();
  return svc;
}

/** A tiny valid JPEG (SOI … EOI with a 1×1 SOF0) — enough for checkJpeg. */
export function tinyJpeg(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
      'base64'
    )
  );
}

/** Give a project's first canvas a cover picture; returns its key. */
export function addCover(p: FixtureProject, rel: string, key: string) {
  const svc = createIndexService({
    root: p.root,
    designRel: '.design',
    context: () => ({
      designRoot: p.designRoot,
      repoRoot: p.root,
      groups: [{ label: 'UI', path: 'ui' }],
      defaultDs: null,
      designSystems: [],
    }),
    project: () => ({ name: 'x', label: null, formatVersion: 2, linkedHub: null, managed: false }),
    persist: true,
  });
  const row = svc.canvas(rel);
  if (!row) throw new Error(`no row ${rel}`);
  svc.setCover(rel, { key, w: 480, h: 360, ofSrc: row.srcHash });
  svc.flush();
  svc.stop();
  writeThumb(p.pid, key, tinyJpeg());
  return key;
}

export function homeDeps(over: Partial<HomeDeps> = {}): HomeDeps {
  return {
    stateDir: mkdtempSync(join(tmpdir(), 'maude-home-state-')),
    token: TOKEN,
    pageSecret: PAGE_SECRET,
    version: '9.9.9-test',
    cloudOrigin: 'https://cloud.example.test',
    formatSupported: 2,
    projectsDir: mkdtempSync(join(tmpdir(), 'maude-home-projects-')),
    cloud: createHomeCloud(),
    // S6.6 — never the real Claude CLI or ~/.local/bin from a test: a still AI module and a
    // CLI installer rooted in a temp dir with no bundled maude (every install → unavailable)
    ai: createHomeAi({
      probe: async () => ({ available: false, adapterEntry: null, claudePath: null }),
      installState: () => ({ phase: 'idle' }),
      signinInFlight: () => false,
      startInstall: () => ({ ok: false, reason: 'test' }),
      startSignin: () => ({ ok: false, reason: 'test' }),
      cancelSignin: () => {},
      cancelInstall: () => {},
    }),
    cli: createHomeCli({
      paths: () => ({ binDir: join(tmpdir(), 'maude-home-cli-never'), bundled: null }),
      claude: () => null,
      run: async () => 1,
    }),
    ...over,
  };
}

export const HOST = '127.0.0.1:4500';

/** A request the Home page itself would send. */
export function homeReq(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
) {
  return new Request(`http://${HOST}${path}`, {
    ...init,
    headers: {
      host: HOST,
      'x-maude-home': PAGE_SECRET,
      'sec-fetch-site': 'same-origin',
      ...(init.headers ?? {}),
    },
  });
}

/** A request Rust sends to an internal route. */
export function rustReq(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://${HOST}${path}`, {
    headers: { host: HOST, 'x-maude-home': '1', authorization: `Bearer ${TOKEN}`, ...headers },
  });
}

export function homeFetch(over: Partial<HomeDeps> = {}) {
  return createHomeFetch(homeDeps(over));
}
