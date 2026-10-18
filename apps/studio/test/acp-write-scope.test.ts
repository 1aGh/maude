// feature-acp-write-path-scope — the path gate's unit tests.
//
// The ESCAPE SHAPES are the point of this file, not the happy path. Every case
// below that resolves to "prompt" is a write that used to land silently, with
// no prompt and no `_history/` rollback, because Edit/Write/NotebookEdit were
// bare names on MAUDE_DEFAULT_ALLOWED_TOOLS (so the CLI approved them itself and
// the bridge's gate was never called).
//
// Real filesystem, not mocks: the whole mechanism is `realpathSync` +
// `path.relative`, so a mocked fs would test the mock. Symlinks in particular
// cannot be exercised any other way — and the symlink-inside-the-project case is
// precisely the one a lexical check passes and a real check catches.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isInsideRoot,
  isWriteToolName,
  PROTECTED_IN_PROJECT as PROTECTED,
  pinScopeRoot,
  resolveRealPath,
  WRITE_TOOL_NAMES,
  writeTargetsInsideProject,
} from '../acp/write-scope.ts';

let tmp: string;
let root: string; // the "project" — the pinned scope root
let outside: string; // a sibling directory the project must never reach
let siblingPrefix: string; // `<root>-evil` — the classic startsWith() bug

beforeAll(() => {
  // `realpathSync` the tmp base up front: on macOS `/var` is a symlink to
  // `/private/var`, so an un-resolved base would make every single case look
  // like an escape and the suite would pass for the wrong reason.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-write-scope-')));
  root = join(tmp, 'repo');
  outside = join(tmp, 'elsewhere');
  siblingPrefix = join(tmp, 'repo-evil');
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(siblingPrefix, { recursive: true });
  writeFileSync(join(root, '.design', 'ui', 'home.tsx'), '// canvas\n');
  writeFileSync(join(outside, 'secret.conf'), 'x\n');
  writeFileSync(join(siblingPrefix, 'payload.txt'), 'x\n');
  // A symlink that LIVES inside the project but POINTS outside it. Lexically
  // `<root>/escape/secret.conf` is unambiguously in-project; only a realpath
  // resolution reveals it is not.
  symlinkSync(outside, join(root, 'escape'), 'dir');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A permission request's `toolCall`, shaped exactly as the adapter builds it
 *  for Write/Edit: `locations[].path` is `input.file_path` VERBATIM (see the
 *  measured contract in acp/write-scope.ts's header — the adapter does not
 *  normalize or absolutize it). */
function writeCall(filePath: string) {
  return { toolCallId: 'tc1', locations: [{ path: filePath }], rawInput: { file_path: filePath } };
}

describe('isWriteToolName', () => {
  test('covers exactly the write tools, and nothing adjacent', () => {
    for (const n of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(isWriteToolName(n)).toBe(true);
    }
    // Read/Grep/Glob are deliberately unscoped — this change closes WRITE
    // egress, not read. If someone later scopes reads, that is a separate
    // rating, not a quiet extension of this one.
    for (const n of ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', '', null, undefined, 42]) {
      expect(isWriteToolName(n)).toBe(false);
    }
  });

  test('WRITE_TOOL_NAMES is the single source both the gate and the allow-list test read', () => {
    expect([...WRITE_TOOL_NAMES].sort()).toEqual(['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);
  });
});

describe('isInsideRoot — containment, not prefix matching', () => {
  test('a real child is inside', () => {
    expect(isInsideRoot(join(root, 'a', 'b.tsx'), root)).toBe(true);
  });

  test('the root ITSELF is not a write target', () => {
    // `path.relative(root, root)` is '' — an empty relative path must not read
    // as "inside", or a write whose target resolved to the directory itself
    // would be auto-approved.
    expect(isInsideRoot(root, root)).toBe(false);
  });

  test('THE SIBLING-PREFIX BUG: `<root>-evil` is NOT inside `<root>`', () => {
    // `'/tmp/x/repo-evil/payload.txt'.startsWith('/tmp/x/repo')` is TRUE. This
    // is why the implementation uses `path.relative` and why a "simplification"
    // back to startsWith is a security regression, not a cleanup.
    expect(join(siblingPrefix, 'payload.txt').startsWith(root)).toBe(true);
    expect(isInsideRoot(join(siblingPrefix, 'payload.txt'), root)).toBe(false);
  });

  test('a parent and an unrelated absolute path are outside', () => {
    expect(isInsideRoot(tmp, root)).toBe(false);
    expect(isInsideRoot(join(outside, 'secret.conf'), root)).toBe(false);
  });
});

describe('resolveRealPath', () => {
  test('a relative path resolves against the scope root', () => {
    // The adapter passes `file_path` through verbatim, so a relative path is
    // possible despite the ACP type declaring the field absolute. `cwd` for the
    // session IS the repo root (newSessionParams), so that is the right base.
    expect(resolveRealPath('.design/ui/home.tsx', root)).toBe(
      join(root, '.design', 'ui', 'home.tsx')
    );
  });

  test('a NON-EXISTENT target resolves via its nearest existing ancestor', () => {
    // The common case for `Write`: the file does not exist yet, so it has no
    // realpath of its own and the parent has to decide.
    const target = join(root, '.design', 'ui', 'brand-new.tsx');
    expect(resolveRealPath(target, root)).toBe(target);
  });

  test('a non-existent target UNDER an escaping symlink resolves outside', () => {
    // The parent-decides rule doing the work it exists for: creating
    // `<root>/escape/new.conf` must be judged against `outside`, not against
    // the symlink's own in-project location.
    expect(resolveRealPath(join(root, 'escape', 'new.conf'), root)).toBe(join(outside, 'new.conf'));
  });

  test('`..` segments collapse even when nothing on the path exists', () => {
    expect(resolveRealPath('a/b/../../../gone.txt', root)).toBe(join(tmp, 'gone.txt'));
  });
});

describe('writeTargetsInsideProject — the gate', () => {
  const scope = () => pinScopeRoot(root);

  test('IN-PROJECT existing file → auto-approve (DDR-184 preserved)', () => {
    const v = writeTargetsInsideProject(
      writeCall(join(root, '.design', 'ui', 'home.tsx')),
      scope(),
      'Edit'
    );
    expect(v).toMatchObject({ inside: true, reason: 'inside' });
  });

  test('IN-PROJECT file that does not exist yet → auto-approve', () => {
    const v = writeTargetsInsideProject(
      writeCall(join(root, '.design', 'ui', 'new.tsx')),
      scope(),
      'Write'
    );
    expect(v.inside).toBe(true);
  });

  test('IN-PROJECT relative path → auto-approve (resolved against the root)', () => {
    const v = writeTargetsInsideProject(writeCall('.design/ui/home.tsx'), scope(), 'Edit');
    expect(v.inside).toBe(true);
    expect(v.resolved).toEqual([join(root, '.design', 'ui', 'home.tsx')]);
  });

  test('`../` ESCAPE → prompt, and the verdict carries the RESOLVED path', () => {
    const v = writeTargetsInsideProject(
      writeCall(join(root, '.design', '..', '..', 'elsewhere', 'secret.conf')),
      scope(),
      'Write'
    );
    expect(v).toMatchObject({ inside: false, reason: 'outside' });
    // What the prompt renders. The model's own string reads like a `.design`
    // edit; the resolution is what tells the truth.
    expect(v.resolved).toEqual([join(outside, 'secret.conf')]);
  });

  test('ABSOLUTE escape → prompt', () => {
    const v = writeTargetsInsideProject(writeCall(join(outside, 'secret.conf')), scope(), 'Write');
    expect(v).toMatchObject({ inside: false, reason: 'outside' });
  });

  test('SYMLINK inside the project pointing OUT → prompt', () => {
    // Lexically in-project; only realpath catches it. This case is why the
    // implementation resolves rather than string-compares.
    const v = writeTargetsInsideProject(
      writeCall(join(root, 'escape', 'secret.conf')),
      scope(),
      'Write'
    );
    expect(v).toMatchObject({ inside: false, reason: 'outside' });
    expect(v.resolved).toEqual([join(outside, 'secret.conf')]);
  });

  test('SIBLING-PREFIX directory → prompt', () => {
    const v = writeTargetsInsideProject(
      writeCall(join(siblingPrefix, 'payload.txt')),
      scope(),
      'Write'
    );
    expect(v.inside).toBe(false);
  });

  test('NO resolvable location at all → prompt (fail closed)', () => {
    const v = writeTargetsInsideProject(
      { toolCallId: 'tc1', locations: [], rawInput: {} },
      scope(),
      'Write'
    );
    expect(v).toMatchObject({ inside: false, reason: 'no-target', resolved: [] });
  });

  test('locations MISSING but rawInput present → still judged (NotebookEdit has no locations at all)', () => {
    // Measured: NotebookEdit has no case in the adapter's tool mapper, so it
    // falls through to `case "Other"`, which emits NO locations. The rawInput
    // fallback is mandatory for it, not a defensive nicety — and its field is
    // `notebook_path`, not `file_path`.
    const inProject = writeTargetsInsideProject(
      { toolCallId: 'tc1', rawInput: { notebook_path: join(root, 'nb.ipynb') } },
      scope(),
      'NotebookEdit'
    );
    expect(inProject.inside).toBe(true);

    const escaping = writeTargetsInsideProject(
      { toolCallId: 'tc1', rawInput: { notebook_path: join(outside, 'nb.ipynb') } },
      scope(),
      'NotebookEdit'
    );
    expect(escaping.inside).toBe(false);
  });

  test('locations and rawInput DISAGREE → prompt', () => {
    // Tautological against today's adapter (both read `input.file_path`), which
    // is documented in the implementation — kept because a gate whose entire job
    // is failing closed should not assume a well-behaved counterparty.
    const v = writeTargetsInsideProject(
      {
        toolCallId: 'tc1',
        locations: [{ path: join(root, 'ok.tsx') }],
        rawInput: { file_path: join(outside, 'secret.conf') },
      },
      scope(),
      'Write'
    );
    expect(v).toMatchObject({ inside: false, reason: 'disagreement' });
  });

  test('agreement is judged on RESOLVED paths, not raw strings', () => {
    // `./x.tsx` and `<root>/x.tsx` are the same file — calling that a
    // disagreement would prompt on a perfectly ordinary in-project write.
    const v = writeTargetsInsideProject(
      {
        toolCallId: 'tc1',
        locations: [{ path: join(root, 'x.tsx') }],
        rawInput: { file_path: 'x.tsx' },
      },
      scope(),
      'Write'
    );
    expect(v.inside).toBe(true);
  });

  test('MULTI-LOCATION with one escape → prompt (every target must pass)', () => {
    const v = writeTargetsInsideProject(
      {
        toolCallId: 'tc1',
        locations: [{ path: join(root, 'a.tsx') }, { path: join(outside, 'secret.conf') }],
        rawInput: {},
      },
      scope(),
      'Write'
    );
    expect(v.inside).toBe(false);
    expect(v.resolved).toContain(join(outside, 'secret.conf'));
  });

  test('a NON-write tool is never granted by this helper', () => {
    // The helper grants nothing it was not explicitly asked about — so it can
    // never turn into a general-purpose "is this path ok" auto-approver for a
    // tool whose risk was never rated.
    const v = writeTargetsInsideProject(writeCall(join(root, 'x.tsx')), scope(), 'Bash');
    expect(v.inside).toBe(false);
  });

  test('an UNKNOWN tool name (notification missed / evicted) → prompt', () => {
    expect(
      writeTargetsInsideProject(writeCall(join(root, 'x.tsx')), scope(), undefined).inside
    ).toBe(false);
  });
});

describe('pinScopeRoot — Task 11 / Solution E', () => {
  test('resolves the root through symlinks so in-project writes are not rejected', () => {
    const linked = join(tmp, 'repo-link');
    symlinkSync(root, linked, 'dir');
    // A bridge created with the SYMLINK path must still auto-approve writes
    // named via the real path (and vice versa) — otherwise pinning would break
    // every project reached through a symlinked checkout.
    const pinned = pinScopeRoot(linked);
    expect(pinned).toBe(root);
    expect(
      writeTargetsInsideProject(writeCall(join(root, '.design', 'ui', 'home.tsx')), pinned, 'Edit')
        .inside
    ).toBe(true);
  });

  test('a session pinned to project A does NOT gain write access to project B', () => {
    // The Addendum invariant, proven at the helper level (the bridge-level
    // proof, with a different project "open", lives in acp-permission.test.ts).
    // Once a session can outlive a project switch, this is the difference
    // between a scoped gate and no gate at all.
    const projectA = pinScopeRoot(root);
    const projectB = join(tmp, 'project-b');
    mkdirSync(projectB, { recursive: true });
    const v = writeTargetsInsideProject(writeCall(join(projectB, 'canvas.tsx')), projectA, 'Write');
    expect(v).toMatchObject({ inside: false, reason: 'outside' });
  });
});

describe('PROTECTED_IN_PROJECT — in-project is necessary, not sufficient', () => {
  // SECURITY. The feature's premise is that an in-project write is safe because
  // it "lands in the served project (already the edit target) and is reversible
  // via the `_history/` snapshot stack". `.git/hooks/pre-commit` is the named
  // counterexample where BOTH halves are false: it is not the edit target, and
  // `_history/` snapshots canvases under `<designRoot>` — never this.
  //
  // The chain needs NO second tool call, which makes it cheaper than the
  // accepted `Bash(maude:*)` code-execution path: write the hook (auto-approved,
  // in-project), then wait for ANY git operation — the branch switcher's
  // `/_api/git/checkout`, or simply the user's own `git commit` in a terminal.
  const scope = () => pinScopeRoot(root);

  test('`.git/hooks/pre-commit` is INSIDE the root and still not auto-approved', () => {
    const target = join(root, '.git', 'hooks', 'pre-commit');
    // Genuinely inside — this is not an escape, which is the whole point.
    expect(isInsideRoot(target, root)).toBe(true);
    const v = writeTargetsInsideProject(writeCall(target), scope(), 'Write');
    expect(v).toMatchObject({ inside: false, reason: 'in-project-denied' });
  });

  test('`.git/config` too — core.pager / fsmonitor / aliases all execute', () => {
    const v = writeTargetsInsideProject(writeCall(join(root, '.git', 'config')), scope(), 'Write');
    expect(v.inside).toBe(false);
  });

  test('a `../`-laundered path into `.git/` is caught after resolution', () => {
    // The check runs on the RESOLVED path, so dressing it up doesn't help.
    const sneaky = join(root, '.design', '..', '.git', 'hooks', 'post-checkout');
    const v = writeTargetsInsideProject(writeCall(sneaky), scope(), 'Write');
    expect(v).toMatchObject({ inside: false, reason: 'in-project-denied' });
  });

  test('`.claude/` is denied — it steers a FUTURE terminal session', () => {
    // DDR-144 pins settingSources:['user'] so the ACP session doesn't read the
    // project's copy — but a plain `claude` the user opens in this repo does.
    const v = writeTargetsInsideProject(
      writeCall(join(root, '.claude', 'settings.json')),
      scope(),
      'Write'
    );
    expect(v.inside).toBe(false);
  });

  test('the list is pinned — additions need their own argued case', () => {
    // Deliberately pinned. Every entry costs a prompt on a path that is
    // genuinely in-project, so growing this list is a real UX cost and should be
    // an explicit decision, not drift. Equally: this is a SHAPE, not a proof of
    // completeness — the plan's recurring-enumeration warning applies here too.
    expect(PROTECTED.slice(0, 5)).toEqual([
      '.git',
      '.gitattributes',
      '.gitmodules',
      '.claude',
      'CLAUDE.md',
    ]);
  });

  test('ordinary in-project writes are UNAFFECTED — the list stays small', () => {
    // Every entry costs a prompt, and prompt fatigue is itself a security
    // failure. Guard against the denylist creeping over normal design work.
    for (const p of ['.design/ui/home.tsx', '.design/config.json', 'README.md', 'src/app.tsx']) {
      expect(writeTargetsInsideProject(writeCall(join(root, p)), scope(), 'Write').inside).toBe(
        true
      );
    }
  });

  test('a directory merely STARTING with `.git` is not denied (segment match, not prefix)', () => {
    // `.gitignore` and `.github/` are ordinary files. A prefix compare would
    // catch both — the same sibling-prefix bug as the root check itself.
    for (const p of ['.gitignore', join('.github', 'CODEOWNERS')]) {
      expect(writeTargetsInsideProject(writeCall(join(root, p)), scope(), 'Write').inside).toBe(
        true
      );
    }
  });
});

describe('PROTECTED_IN_PROJECT — the traced A1 chain, and depth', () => {
  const scope = () => pinScopeRoot(root);
  const denied = (p: string) =>
    expect(writeTargetsInsideProject(writeCall(join(root, p)), scope(), 'Write')).toMatchObject({
      inside: false,
      reason: 'in-project-denied',
    });

  test('`.git/config` — THE vector, because it needs no executable bit', () => {
    // `Write` creates 0644 and the session has no `chmod`, so `.git/hooks/*` is
    // inert on its own. `core.fsmonitor` is invoked THROUGH A SHELL during a
    // routine index refresh, so mode bits are irrelevant. That asymmetry is why
    // the fix must cover `.git/` wholesale rather than just `hooks/`.
    denied('.git/config');
  });

  test('`.git` at DEPTH is caught — a nested checkout is the same primitive', () => {
    // The first cut matched only the FIRST path segment, which missed this.
    denied(join('vendor', 'sub', '.git', 'config'));
    denied(join('a', 'b', 'c', '.git', 'hooks', 'pre-commit'));
  });

  test('the other git-read files that are NOT under .git/', () => {
    // `filter.*.smudge` needs a `.gitattributes` to bind to, and both are read
    // by git without living under `.git/`.
    denied('.gitattributes');
    denied('.gitmodules');
  });

  test('CLAUDE.md — settingSources:[user] does NOT cover it', () => {
    // DDR-144's narrowing genuinely stops the project's .claude/settings.json
    // being read (verified), but CLAUDE.md is loaded by a separate path, so one
    // write steers every future session in this repo — including the user's own
    // terminal `claude`, which runs with wider permissions than the panel.
    denied('CLAUDE.md');
  });

  test('package manifests + lockfiles + node_modules', () => {
    denied('package.json');
    denied('pnpm-lock.yaml');
    denied(join('node_modules', 'react', 'index.js'));
    denied('.mcp.json');
  });

  test('STILL allowed: the look-alikes a prefix match would have broken', () => {
    // `.gitignore` and `.github/` are ordinary versioned files. A prefix compare
    // would deny both — the same sibling-prefix bug as the root check — and
    // denying ordinary files is how a gate earns click-through.
    for (const p of ['.gitignore', join('.github', 'CODEOWNERS'), 'CLAUDE.md.bak']) {
      expect(writeTargetsInsideProject(writeCall(join(root, p)), scope(), 'Write').inside).toBe(
        true
      );
    }
  });
});

describe('PROTECTED_IN_PROJECT — case folding (ethical-hacker A6)', () => {
  const scope = () => pinScopeRoot(root);
  const verdict = (p: string) =>
    writeTargetsInsideProject(writeCall(join(root, p)), scope(), 'Write');

  test('a protected name is denied in ANY case, on every platform', () => {
    // The hole: `realpathSync.native` canonicalizes casing only for components
    // that EXIST on disk. A protected path that does NOT yet exist keeps the
    // caller's casing — and macOS's default filesystem is case-INSENSITIVE, so
    // `.CLAUDE/settings.json` IS `.claude/settings.json`. In a typical design
    // project `.claude/`, `CLAUDE.md`, `.mcp.json`, `.gitattributes` and
    // `.gitmodules` are all absent, so every one was reachable by pressing
    // shift. Measured against this module before the fix: `claude.md`,
    // `.CLAUDE/settings.json` and `.MCP.json` were all auto-approved.
    for (const p of [
      '.CLAUDE/settings.json',
      '.Claude/hooks/x.sh',
      'claude.md',
      'Claude.MD',
      '.MCP.json',
      '.GITATTRIBUTES',
      '.GitModules',
      'Package.json',
      join('NODE_MODULES', 'react', 'index.js'),
    ]) {
      expect(verdict(p)).toMatchObject({ inside: false, reason: 'in-project-denied' });
    }
  });

  test('the lowercase forms are still denied (the fix did not invert anything)', () => {
    for (const p of ['.claude/settings.json', 'CLAUDE.md', '.mcp.json', '.gitattributes']) {
      expect(verdict(p).inside).toBe(false);
    }
  });

  test('the three execution-on-open paths (.envrc / .vscode / .github/workflows)', () => {
    // Added from the PREDICATE rather than from a list: "an in-project path that
    // reaches execution without a further agent action."
    //   .envrc            — direnv runs it on `cd`; no app action at all.
    //   .vscode/**        — terminal.integrated.env.*, tasks.json runOn:folderOpen.
    //   .github/workflows — CI with repo secrets, and Maude ships the trigger:
    //                       Save version → Publish is two clicks from write to CI.
    for (const p of [
      '.envrc',
      join('.vscode', 'settings.json'),
      join('.vscode', 'tasks.json'),
      join('.github', 'workflows', 'release.yml'),
      join('.GITHUB', 'Workflows', 'ci.yml'),
    ]) {
      expect(verdict(p)).toMatchObject({ inside: false, reason: 'in-project-denied' });
    }
  });

  test('`.github/` ITSELF stays allowed — that is why it is a prefix rule, not a segment rule', () => {
    // A segment match on `.github` would deny ordinary versioned files, and
    // denying ordinary files is how a gate earns click-through.
    for (const p of [
      join('.github', 'CODEOWNERS'),
      join('.github', 'dependabot.yml'),
      join('.github', 'ISSUE_TEMPLATE', 'bug.md'),
    ]) {
      expect(verdict(p).inside).toBe(true);
    }
  });

  test('look-alikes stay ALLOWED in any case — folding must not become a prefix match', () => {
    // Folding widens what matches, so re-assert the other direction: these are
    // ordinary versioned files and denying them is how a gate earns click-through.
    for (const p of [
      '.gitignore',
      '.GITIGNORE',
      join('.github', 'dependabot.yml'),
      'claude.md.bak',
    ]) {
      expect(verdict(p).inside).toBe(true);
    }
  });
});

// S5.10 — a folder the person allowed AI to READ never becomes a write path, inside the project or
// out, by its own path, a `..` route, or a symlink that leads into it.
describe('writeTargetsInsideProject — read-only grants (S5.10)', () => {
  const scope = () => pinScopeRoot(root);
  const granted = () => [join(root, 'brief')];
  beforeAll(() => {
    mkdirSync(join(root, 'brief', 'shots'), { recursive: true });
    writeFileSync(join(root, 'brief', 'notes.md'), 'x\n');
    symlinkSync(join(root, 'brief'), join(root, '.design', 'ui', 'brief-link'), 'dir');
  });

  test('an in-project write OUTSIDE the granted folder still auto-approves', () => {
    const v = writeTargetsInsideProject(
      writeCall(join(root, '.design', 'ui', 'home.tsx')),
      scope(),
      'Write',
      granted()
    );
    expect(v).toMatchObject({ inside: true, reason: 'inside' });
  });

  test('a write INTO a granted folder inside the project prompts', () => {
    for (const p of [
      join(root, 'brief', 'notes.md'),
      join(root, 'brief', 'shots', 'new.jpg'),
      'brief/notes.md',
      join(root, '.design', 'ui', '..', '..', 'brief', 'x.md'),
    ]) {
      const v = writeTargetsInsideProject(writeCall(p), scope(), 'Edit', granted());
      expect(v).toMatchObject({ inside: false, reason: 'read-only-grant' });
    }
  });

  test('a write through a symlink that leads into the granted folder prompts', () => {
    const v = writeTargetsInsideProject(
      writeCall(join(root, '.design', 'ui', 'brief-link', 'notes.md')),
      scope(),
      'Write',
      granted()
    );
    expect(v).toMatchObject({ inside: false, reason: 'read-only-grant' });
    expect(v.resolved).toEqual([join(root, 'brief', 'notes.md')]);
  });

  test('a granted folder OUTSIDE the project is named as the reason (it prompted already)', () => {
    const v = writeTargetsInsideProject(writeCall(join(outside, 'secret.conf')), scope(), 'Write', [
      outside,
    ]);
    expect(v).toMatchObject({ inside: false, reason: 'read-only-grant' });
  });
});
