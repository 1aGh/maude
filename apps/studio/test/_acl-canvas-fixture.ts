// S9.10 — the canvas-only filter fixture (V2-1.16 L6–L10, studio browser door).
//
// One cell child, three canvases, and a CANARY everywhere B and C could leak:
//   - A  `ui/a.tsx`                          DS `shared`        — the session's one grant
//   - B  `ui/canary-folder/canary-b.tsx`     DS `shared`        kind `imported-figma`,
//                                                               a comment holding CANARY
//   - C  `ui/canary-c.tsx`                   DS `canary-ds`     (a DS only C renders with)
//   - an empty folder `ui/canary-empty/` (a folder-only name)
//   - git: one commit touching A + B (`design: update 2 canvases`, a body naming B), one
//     manual commit naming B in its subject, one touching C only; then A, B and C are
//     edited in the working tree so `/_api/git/diff` has all three to list.
// Every filtered answer for an A-only session must hold no `canary` (any case); the same
// answer for the owner must hold it (or the assertion would be vacuous).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

export const CANARY = 'canary';
export const A = '.design/ui/a.tsx';
export const B = '.design/ui/canary-folder/canary-b.tsx';
export const C = '.design/ui/canary-c.tsx';
export const B_COMMENT_ID = 'c_bbbbbbbbbbbb';
export const A_COMMENT_ID = 'c_aaaaaaaaaaaa';

const SRC = (n: string) =>
  `export default function C() { return <div data-dc-screen="${n}">x</div>; }\n`;

const claimHeader = (claim: AccessClaim) => ({
  'x-maude-access': Buffer.from(JSON.stringify(claim)).toString('base64url'),
});

export const OWNER = {
  ...claimHeader({ v: 1, role: 'owner' }),
  'x-maude-role': 'owner',
  'x-maude-readonly': '0',
};
export const asRole = (role: string) => ({
  ...claimHeader({ v: 1, role } as AccessClaim),
  'x-maude-role': role,
  'x-maude-readonly': role === 'member' || role === 'owner' ? '0' : '1',
});
export const canvasOnly = (r: 'observer' | 'viewer' | 'member', c = 'ui/a.tsx') => ({
  ...claimHeader({ v: 1, role: null, grants: [{ c, r }] }),
  'x-maude-readonly': '1',
});
export const A_ONLY = canvasOnly('member');

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(
    ['git', '-c', 'user.name=Tess Ter', '-c', 'user.email=tess@example.com', ...args],
    { cwd, stdout: 'pipe', stderr: 'pipe' }
  );
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

const comment = (id: string, file: string, text: string) => ({
  id,
  file,
  selector: '[data-dc-screen]',
  dom_path: [],
  tag: 'div',
  classes: '',
  bounds: null,
  html_excerpt: '',
  text,
  status: 'open',
  created: '2026-10-01T00:00:00.000Z',
  resolved_at: null,
  author: 'Tess Ter',
  thread: [],
  mentions: [],
});

export interface Cell {
  base: string;
  root: string;
  designRoot: string;
  /** The A + B commit (its tree has every canvas, so a diff against it lists A, B and C). */
  firstSha: string;
  stop(): Promise<void>;
}

export async function bootCanaryCell(): Promise<Cell> {
  const { root, designRoot } = makeSandbox();
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify(
      {
        name: 'test',
        designRoot: '.design',
        // a v2 project: the full format gate (Michal 2A) would open a format-1 one view only
        formatVersion: 2,
        canvasGroups: [
          { label: 'System', path: 'system' },
          { label: 'UI', path: 'ui' },
        ],
        designSystems: [
          { name: 'shared', path: 'system/shared' },
          { name: 'canary-ds', path: 'system/canary-ds' },
        ],
        defaultDesignSystem: 'shared',
      },
      null,
      2
    )
  );
  for (const ds of ['shared', 'canary-ds']) {
    mkdirSync(join(designRoot, 'system', ds, 'preview'), { recursive: true });
    writeFileSync(
      join(designRoot, 'system', ds, 'colors_and_type.css'),
      ':root { --bg-0: #000; }\n'
    );
    writeFileSync(join(designRoot, 'system', ds, 'README.md'), `# ${ds}\n`);
    writeFileSync(join(designRoot, 'system', ds, 'preview', `${ds}-specimen.tsx`), SRC(ds));
  }
  writeFileSync(join(designRoot, 'README.md'), '# The project README\n');
  mkdirSync(join(designRoot, 'ui', 'canary-folder'), { recursive: true });
  mkdirSync(join(designRoot, 'ui', 'canary-empty'), { recursive: true });
  const put = (rel: string, text: string) => writeFileSync(join(root, rel), text);
  put(A, SRC('a1'));
  put(A.replace('.tsx', '.meta.json'), JSON.stringify({ designSystem: 'shared' }));
  put(B, SRC('canary-board'));
  put(
    B.replace('.tsx', '.meta.json'),
    JSON.stringify({ designSystem: 'shared', kind: 'imported-figma' })
  );
  put(C, SRC('c1'));
  put(C.replace('.tsx', '.meta.json'), JSON.stringify({ designSystem: 'canary-ds' }));
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, '_comments', 'a.json'),
    JSON.stringify([comment(A_COMMENT_ID, A, 'hello A')])
  );
  writeFileSync(
    join(designRoot, '_comments', 'b.json'),
    JSON.stringify([comment(B_COMMENT_ID, B, 'CANARY secret on B')])
  );
  writeFileSync(join(root, '.gitignore'), '.design/_*\n');

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.gitignore', '.design/config.json', '.design/system', A, B, C);
  git(root, 'add', A.replace('.tsx', '.meta.json'), B.replace('.tsx', '.meta.json'));
  git(root, 'add', C.replace('.tsx', '.meta.json'), '.design/ui/fixture.html');
  git(root, 'commit', '-q', '-m', 'design: update 2 canvases\n\n- canary-folder/canary-b\n- a');
  const firstSha = git(root, 'rev-parse', 'HEAD');
  put(A, SRC('a2'));
  put(B, SRC('canary-board-2'));
  git(root, 'add', A, B);
  git(root, 'commit', '-q', '-m', 'tweak canary-b and a');
  put(C, SRC('c2'));
  git(root, 'add', C);
  git(root, 'commit', '-q', '-m', 'canary only commit');
  // The working tree moves on, so a diff against the first commit lists all three.
  put(A, SRC('a3'));
  put(B, SRC('canary-board-3'));
  put(C, SRC('c3'));

  const port = nextPort();
  const proc: Subprocess = await bootServer(root, port, {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Alligators',
  });
  const base = `http://localhost:${port}`;
  return { base, root, designRoot, firstSha, stop: () => killProc(proc) };
}

export async function send(
  cell: Cell,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: unknown = {}
) {
  const r = await fetch(cell.base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: cell.base, ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, text, json };
}

export const get = (cell: Cell, path: string, headers: Record<string, string>) =>
  send(cell, 'GET', path, headers);

/** Every `canary` in a body, case-insensitive (the assertion message names them). */
export const canaries = (text: string): string[] =>
  [...text.matchAll(/.{0,40}canary.{0,40}/gi)].map((m) => m[0]);
