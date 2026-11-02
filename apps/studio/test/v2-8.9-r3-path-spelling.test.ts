// V2-8.9 re-check H1 + M1 (decisions maude/v2-p8-one-agent-path-normalizer,
// maude/v2-p8-outside-reads-are-private).
//
// H1 — the bridge and Claude Code must name the same file. Claude Code 2.1.x expandPath trims, turns
// `~` / `~/x` into the home folder, and resolves the rest against the session cwd; the bridge used
// to read `~/maude-p8-probe/x` as `<repo>/~/maude-p8-probe/x` (inside → approved), a Grep/Glob path `~`
// searched the whole home, and `' ~/.SSH/id_rsa'` slipped past the credential check. One normalizer
// (acp/agent-path.ts) now feeds every gate, and a path spelled so readers may disagree is outside.
//
// M1 — a file read from outside the project (a folder the person let AI read, the temp folder…) is
// tracked as a private source, so a hub-linked write after it is the person's card.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentPath } from '../acp/agent-path.ts';
import { privateLeak, readPathsOf } from '../acp/audience.ts';
import { credentialPathsFor, credentialRefusal, readVerdict } from '../acp/may-scope.ts';
import { resolveWriteTargets } from '../acp/write-scope.ts';

let tmp: string;
let repo: string;
let design: string;
let consented: string;
let plugin: string;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-path-spelling-')));
  repo = join(tmp, 'repo');
  design = join(repo, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(design, 'ui', 'a.tsx'), '// a\n');
  // A literal `~` folder inside the project: what the old resolution judged.
  mkdirSync(join(repo, '~', 'maude-p8-probe'), { recursive: true });
  writeFileSync(join(repo, '~', 'maude-p8-probe', 'x.txt'), 'x');
  consented = join(tmp, 'Combine');
  mkdirSync(consented, { recursive: true });
  writeFileSync(join(consented, 'notes.txt'), 'private');
  plugin = join(tmp, 'plugins', 'design');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'SKILL.md'), '# s\n');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const call = (rawInput: Record<string, unknown>) => ({ rawInput });

describe('agentPath — Claude Code’s expandPath', () => {
  test('trim, ~, ~/, relative to the session cwd; NUL and empty → null', () => {
    expect(agentPath('~', '/repo', '/Users/u')).toEqual({ abs: '/Users/u', odd: true });
    expect(agentPath('~/maude-p8-probe/x', '/repo', '/Users/u')).toEqual({
      abs: '/Users/u/maude-p8-probe/x',
      odd: true,
    });
    expect(agentPath(' ~/.SSH/id_rsa', '/repo', '/Users/u')).toEqual({
      abs: '/Users/u/.SSH/id_rsa',
      odd: true,
    });
    expect(agentPath('ui/a.tsx', '/repo', '/Users/u')).toEqual({
      abs: '/repo/ui/a.tsx',
      odd: false,
    });
    expect(agentPath('ui/a.tsx ', '/repo', '/Users/u')).toEqual({
      abs: '/repo/ui/a.tsx',
      odd: true,
    });
    expect(agentPath('~user/x', '/repo', '/Users/u')?.odd).toBe(true);
    expect(agentPath('a\0b', '/repo', '/Users/u')).toBeNull();
    expect(agentPath('   ', '/repo', '/Users/u')).toBeNull();
  });
});

describe('H1 — the read gate', () => {
  test('`~/maude-p8-probe/x` is the home folder’s, never `<repo>/~/maude-p8-probe/x`', () => {
    expect(readVerdict('Read', call({ file_path: '~/maude-p8-probe/x.txt' }), repo, [repo])).toBe(
      'outside'
    );
  });
  test('Grep / Glob with path `~` search the home folder → the card', () => {
    expect(readVerdict('Grep', call({ pattern: 'secret', path: '~' }), repo, [repo])).toBe(
      'outside'
    );
    expect(readVerdict('Glob', call({ pattern: '**/*', path: '~' }), repo, [repo])).toBe('outside');
    expect(readVerdict('Glob', call({ pattern: '~/**/*.pdf' }), repo, [repo])).toBe('outside');
  });
  test('a path with spaces around it is outside, even when it trims to a project file', () => {
    expect(readVerdict('Read', call({ file_path: ' .design/ui/a.tsx' }), repo, [repo])).toBe(
      'outside'
    );
    expect(readVerdict('Read', call({ file_path: '.design/ui/a.tsx' }), repo, [repo])).toBe(
      'inside'
    );
  });
  test('L3 — an absolute Glob pattern is judged by its own prefix, not by an in-project path', () => {
    expect(
      readVerdict('Glob', call({ pattern: `${consented}/**/*`, path: repo }), repo, [repo])
    ).toBe('outside');
  });
});

describe('H1 — the credential check', () => {
  const HOME = '/Users/fixture';
  const p = credentialPathsFor({ HOME }, HOME);
  const refuse = (rawInput: Record<string, unknown>) =>
    credentialRefusal({ rawInput }, p, '/repo', HOME);
  test('`  ~/.SSH/id_rsa` (spaces, tilde, other case) is a key', () => {
    expect(refuse({ file_path: ' ~/.SSH/id_rsa' })).toBe('credentials');
    expect(refuse({ file_path: '~/.ssh/id_rsa\t' })).toBe('credentials');
    expect(refuse({ path: '~/.aws' })).toBe('credentials');
    expect(refuse({ pattern: ' ~/.ssh/*' })).toBe('credentials');
  });
  test('an ordinary project path still passes', () => {
    expect(refuse({ file_path: '.design/ui/a.tsx' })).toBeNull();
  });
});

describe('H1 — the write gate', () => {
  const write = (file_path: string) =>
    resolveWriteTargets({ toolCallId: 't', rawInput: { file_path } }, repo);
  test('`~/x` is a write outside the project, not into `<repo>/~/x`', () => {
    const v = write('~/maude-p8-probe/x.txt');
    expect(v.inside).toBe(false);
    expect(v.resolved).toEqual([join(homedir(), 'maude-p8-probe', 'x.txt')]);
  });
  test('a spaced spelling is never auto-approved; a NUL names nothing', () => {
    expect(write(' .design/ui/a.tsx').inside).toBe(false);
    expect(write('.design/ui/a.tsx').inside).toBe(true);
    expect(write('.design/ui/a\0.tsx')).toMatchObject({ inside: false, reason: 'no-target' });
  });
});

describe('M1 — a read from outside the project is a private source', () => {
  const kind = (abs: string) => {
    try {
      const st = statSync(abs);
      return st.isDirectory() ? 'dir' : 'file';
    } catch {
      return null;
    }
  };
  test('a consented-folder read is tracked as outside; project and own-root reads are not', () => {
    const reads = [
      ...readPathsOf(
        'Read',
        call({ file_path: join(consented, 'notes.txt') }),
        repo,
        [design],
        kind,
        [plugin]
      ),
      ...readPathsOf('Read', call({ file_path: join(plugin, 'SKILL.md') }), repo, [design], kind, [
        plugin,
      ]),
      ...readPathsOf(
        'Read',
        call({ file_path: join(repo, '~', 'maude-p8-probe', 'x.txt') }),
        repo,
        [design],
        kind,
        [plugin]
      ),
    ];
    expect(reads).toEqual([{ rel: join(consented, 'notes.txt'), dir: false, outside: true }]);
    expect(privateLeak(reads, 'ui/a.tsx')).toEqual({
      canvas: 'ui/a.tsx',
      who: [],
      sources: [join(consented, 'notes.txt')],
    });
  });
  test('a shell read of a consented folder counts too; `cat ~/…` is the home folder', () => {
    const r = readPathsOf(
      'Bash',
      call({ command: `cat ${consented}/notes.txt` }),
      repo,
      [design],
      kind
    );
    expect(r).toEqual([{ rel: join(consented, 'notes.txt'), dir: false, outside: true }]);
    expect(privateLeak([], 'ui/a.tsx')).toBeNull();
  });
});
