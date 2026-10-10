// V2-2.4b — the design plugin's hooks (contract V2-1.11 §5.4): `maude design hook <event>`
// (cli/lib/design-hook.mjs) wired from hooks.json. Deny-only and fail-open: no project, a path
// outside designRoot, bad stdin or no studio → exit 0; the studio-dependent parts (run bracket,
// one AI per artboard, attribution) are skipped while snapshot / check / rollback still run.
//
// Run: bun test plugins/design/hooks/hooks.test.mjs (a fixture studio = Bun.serve over the real
// agent RouteSpecs, so the CLI is spawned async — a spawnSync would block the server's loop).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentRouteSpecs } from '../../../apps/studio/routes/agent.ts';
import { mountRoutes } from '../../../apps/studio/routes/table.ts';
import { rootIdentity } from '../../../cli/lib/studio-locate.mjs';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');
const HOOKS = JSON.parse(readFileSync(join(import.meta.dir, 'hooks.json'), 'utf8')).hooks;

const PAD = Array.from({ length: 45 }, (_, i) => `// line ${i}`).join('\n');
const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
${PAD}
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" width={800} height={600}><h1 data-cd-id="title">Hi</h1></DCArtboard>
      <DCArtboard id="pricing" width={800} height={600}><p>x</p></DCArtboard>
    </DesignCanvas>
  );
}
`;

function makeProject(prefix) {
  const p = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  mkdirSync(join(p, '.design', 'ui'), { recursive: true });
  writeFileSync(join(p, '.design', 'config.json'), '{}');
  writeFileSync(join(p, '.design', 'ui', 'C.tsx'), CANVAS);
  return p;
}

async function hook(event, input) {
  const t0 = performance.now();
  const p = Bun.spawn(['node', MAUDE, 'design', 'hook', event], {
    stdin: new Blob([typeof input === 'string' ? input : JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1', CLAUDE_PROJECT_DIR: '' },
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return {
    status,
    stdout,
    stderr,
    json: stdout ? JSON.parse(stdout) : null,
    ms: performance.now() - t0,
  };
}

const edit = (project, session, toolUseId, old, neu) => ({
  session_id: session,
  tool_use_id: toolUseId,
  cwd: project,
  tool_name: 'Edit',
  tool_input: {
    file_path: join(project, '.design', 'ui', 'C.tsx'),
    old_string: old,
    new_string: neu,
  },
});
const canvasPath = (project) => join(project, '.design', 'ui', 'C.tsx');
const bash = (project, session, toolUseId, command) => ({
  session_id: session,
  tool_use_id: toolUseId,
  cwd: project,
  tool_name: 'Bash',
  tool_input: { command },
});
const isDeny = (r, code) =>
  r.status === 0 &&
  r.json?.hookSpecificOutput?.permissionDecision === 'deny' &&
  r.json.hookSpecificOutput.permissionDecisionReason.startsWith(`${code}: `);

describe('hooks.json wires `maude design hook <event>` (§5.4 table)', () => {
  const cmd = (event, matcher) =>
    (HOOKS[event] ?? []).find((g) => (matcher === undefined ? true : g.matcher === matcher))
      ?.hooks ?? [];
  test.each([
    ['UserPromptSubmit', undefined, 'prompt', 3],
    ['PreToolUse', 'Edit|Write|MultiEdit|NotebookEdit', 'pre-edit', 3],
    ['PostToolUse', 'Edit|Write|MultiEdit|NotebookEdit', 'post-edit', 5],
    ['PreToolUse', 'Bash', 'pre-bash', 3],
    ['PostToolUse', 'Bash', 'post-bash', 3],
    ['Stop', undefined, 'stop', 60],
  ])('%s → hook %s', (event, matcher, verb, timeout) => {
    const h = cmd(event, matcher).find((x) => x.command.includes(`design hook ${verb}`));
    expect(h?.type).toBe('command');
    expect(h?.timeout).toBe(timeout);
    // the fallback chain: the sibling CLI, else maude on PATH, else nothing (fail-open)
    expect(h?.command).toContain('cli/bin/maude.mjs');
    expect(h?.command).toContain('command -v maude');
    expect(h?.command.trim().endsWith('exit 0')).toBe(true);
  });
  test('the existing SessionStart preflight and ds-check hooks are kept', () => {
    expect(JSON.stringify(HOOKS.SessionStart)).toContain('preflight');
    expect(JSON.stringify(HOOKS.PostToolUse)).toContain('ds-check --hook');
  });
});

describe('no studio — fail-open, snapshot + check + rollback still run', () => {
  let project;
  beforeAll(() => {
    project = makeProject('maude-hook-solo-');
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  test('bad stdin, no project, or a path outside designRoot → exit 0, no output', async () => {
    expect(await hook('pre-edit', 'not json')).toMatchObject({ status: 0, stdout: '' });
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'maude-hook-none-')));
    try {
      const r = await hook('pre-edit', { ...edit(elsewhere, 's', 't', 'a', 'b') });
      expect(r).toMatchObject({ status: 0, stdout: '' });
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
    const out = await hook('pre-edit', {
      ...edit(project, 's', 't0', 'a', 'b'),
      tool_input: { file_path: join(project, 'README.md'), old_string: 'a', new_string: 'b' },
    });
    expect(out).toMatchObject({ status: 0, stdout: '' });
    expect(await hook('nope', {})).toMatchObject({ status: 0, stdout: '' });
  });

  test('pre-edit: Write over an existing canvas > 40 lines → deny whole-file-rewrite', async () => {
    const r = await hook('pre-edit', {
      session_id: 's1',
      tool_use_id: 'w1',
      cwd: project,
      tool_name: 'Write',
      tool_input: { file_path: canvasPath(project), content: 'export default () => null;\n' },
    });
    expect(r.status).toBe(0);
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(r.json.hookSpecificOutput.permissionDecisionReason).toMatch(
      /^whole-file-rewrite: .*Use Edit/
    );
  });

  test('pre-edit snapshots the bytes; a bad edit is blocked AND rolled back', async () => {
    const e = edit(project, 's1', 'e1', 'id="pricing"', 'id="hero"');
    expect(await hook('pre-edit', e)).toMatchObject({ status: 0, stdout: '' });
    expect(readFileSync(join(project, '.design', '_runs', 's1', 'snap', 'e1'), 'utf8')).toBe(
      CANVAS
    );
    writeFileSync(canvasPath(project), CANVAS.replace('id="pricing"', 'id="hero"')); // the tool ran
    const r = await hook('post-edit', e);
    expect(r.status).toBe(0);
    expect(r.json.decision).toBe('block');
    expect(r.json.reason).toContain('artboard-duplicate');
    expect(r.json.reason).toContain('restored to before this edit');
    expect(readFileSync(canvasPath(project), 'utf8')).toBe(CANVAS);
    expect(r.ms).toBeLessThan(1500); // the §5.4 post-edit budget, local check included
  });

  test('a file changed again after the tool → blocked but left as it is', async () => {
    const e = edit(project, 's1', 'e2', 'id="pricing"', 'id="hero"');
    await hook('pre-edit', e);
    const later = `${CANVAS.replace('id="pricing"', 'id="hero"')}// someone else\n`;
    writeFileSync(canvasPath(project), later);
    const r = await hook('post-edit', e);
    expect(r.json.decision).toBe('block');
    expect(r.json.reason).not.toContain('restored to before this edit');
    expect(readFileSync(canvasPath(project), 'utf8')).toBe(later);
    writeFileSync(canvasPath(project), CANVAS);
  });

  test('pre-bash: rm of a canvas → use-trash, sed -i into .design → not-a-writer, reads pass', async () => {
    expect(
      isDeny(await hook('pre-bash', bash(project, 's3', 'b1', 'rm .design/ui/C.tsx')), 'use-trash')
    ).toBe(true);
    expect(
      isDeny(
        await hook('pre-bash', bash(project, 's3', 'b2', "sed -i '' 's/Hi/Yo/' .design/ui/C.tsx")),
        'not-a-writer'
      )
    ).toBe(true);
    expect(
      isDeny(
        await hook('pre-bash', bash(project, 's3', 'b3', 'mv .design/ui/C.tsx /tmp/')),
        'use-verb'
      )
    ).toBe(true);
    for (const read of [
      'maude design read-annotations ui/C.tsx | python3 -c "import json,sys; json.load(sys.stdin)"',
      'cp .design/ui/C.tsx /tmp/',
      'PORT=$(maude design server-up) && maude design screenshot --canvas ui/C.tsx --out /tmp/x.png',
      'rm "unterminated',
    ])
      expect(await hook('pre-bash', bash(project, 's3', 'b4', read))).toMatchObject({
        status: 0,
        stdout: '',
      });
    expect(readFileSync(canvasPath(project), 'utf8')).toBe(CANVAS);
  });

  test("post-bash records a write verb's writes (via bash) so Stop checks them", async () => {
    const e = bash(project, 's4', 'v1', 'maude design canvas-edit ui/C.tsx --set x');
    expect(await hook('pre-bash', e)).toMatchObject({ status: 0, stdout: '' });
    writeFileSync(canvasPath(project), CANVAS.replace('<p>x</p>', '<p>z</p>')); // the verb ran
    expect(await hook('post-bash', e)).toMatchObject({ status: 0, stdout: '' });
    const touched = JSON.parse(
      readFileSync(join(project, '.design', '_runs', 's4', 'touched.json'), 'utf8')
    );
    expect(touched['ui/C.tsx']).toMatchObject({ by: 'main', via: 'bash' });
    // a read verb binds nothing
    const r = bash(
      project,
      's5',
      'v2',
      'maude design screenshot --canvas ui/C.tsx --out /tmp/x.png'
    );
    await hook('pre-bash', r);
    writeFileSync(canvasPath(project), CANVAS);
    await hook('post-bash', r);
    expect(existsSync(join(project, '.design', '_runs', 's5', 'touched.json'))).toBe(false);
    rmSync(join(project, '.design', '_runs', 's4'), { recursive: true, force: true });
  });

  test('a good edit passes silently and is recorded; Stop checks the run, then lets it end', async () => {
    const e = edit(project, 's2', 'g1', '<p>x</p>', '<p>y</p>');
    await hook('pre-edit', e);
    writeFileSync(canvasPath(project), CANVAS.replace('<p>x</p>', '<p>y</p>'));
    expect(await hook('post-edit', e)).toMatchObject({ status: 0, stdout: '' });
    const touched = JSON.parse(
      readFileSync(join(project, '.design', '_runs', 's2', 'touched.json'), 'utf8')
    );
    expect(Object.keys(touched)).toEqual(['ui/C.tsx']);
    // broken behind the hook's back → Stop blocks once with the errors…
    writeFileSync(
      canvasPath(project),
      CANVAS.replace('<p>x</p>', '<p>y</p>').replace('id="pricing"', 'id="hero"')
    );
    const stop = { session_id: 's2', cwd: project, stop_hook_active: false };
    const r1 = await hook('stop', stop);
    expect(r1.json.decision).toBe('block');
    expect(r1.json.reason).toContain('artboard-duplicate');
    // …and on the re-stop with the same list it lets the turn end (ended with warnings)
    expect(await hook('stop', { ...stop, stop_hook_active: true })).toMatchObject({
      status: 0,
      stdout: '',
    });
    expect(existsSync(join(project, '.design', '_runs', 's2', 'touched.json'))).toBe(false);
    writeFileSync(canvasPath(project), CANVAS);
  });
});

describe('with a studio — the run bracket and one AI per artboard', () => {
  let project;
  let server;
  const bracket = [];
  beforeAll(() => {
    project = makeProject('maude-hook-studio-');
    const { exact } = mountRoutes(
      agentRouteSpecs({
        repoRoot: project,
        designRel: '.design',
        shells: () => 1,
        emit: () => {},
        bracket: {
          begin: (r) => bracket.push(`begin ${r.session}`),
          touch: (r, p) => bracket.push(`touch ${r.session} ${p}`),
          end: (r, o) => bracket.push(`end ${r.session} ${o}`),
        },
      })
    );
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/_health')
          return Response.json({ app: 'design', rootId: rootIdentity(project) });
        const h = exact[url.pathname];
        return h ? h(req) : new Response('not found', { status: 404 });
      },
    });
    writeFileSync(
      join(project, '.design', '_server.json'),
      JSON.stringify({
        pid: process.pid,
        port: server.port,
        url: `http://127.0.0.1:${server.port}`,
      })
    );
  });
  afterAll(() => {
    server?.stop(true);
    rmSync(project, { recursive: true, force: true });
  });

  test('prompt opens the run; a second session editing the same artboard is denied', async () => {
    expect(
      await hook('prompt', { session_id: 'sa', prompt_id: 'p1', cwd: project, prompt: 'x' })
    ).toMatchObject({
      status: 0,
      stdout: '',
    });
    expect(bracket).toContain('begin sa');
    expect(await hook('pre-edit', edit(project, 'sa', 'a1', 'Hi', 'Hello'))).toMatchObject({
      stdout: '',
    });
    await hook('prompt', { session_id: 'sb', cwd: project, prompt: 'y' });
    const r = await hook('pre-edit', edit(project, 'sb', 'b1', 'Hi', 'Hey'));
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(r.json.hookSpecificOutput.permissionDecisionReason).toMatch(/^artboard-busy: hero /);
    expect(await hook('pre-edit', edit(project, 'sb', 'b2', '<p>x</p>', '<p>y</p>'))).toMatchObject(
      { stdout: '' }
    );
  });

  test('post-edit checks through the studio and reports the touch; Stop ends the run', async () => {
    writeFileSync(canvasPath(project), CANVAS.replace('Hi', 'Hello'));
    const r = await hook('post-edit', edit(project, 'sa', 'a1', 'Hi', 'Hello'));
    expect(r).toMatchObject({ status: 0, stdout: '' });
    expect(r.ms).toBeLessThan(1500);
    expect(bracket).toContain('touch sa ui/C.tsx');
    expect(
      await hook('stop', { session_id: 'sa', cwd: project, stop_hook_active: false })
    ).toMatchObject({
      stdout: '',
    });
    expect(bracket).toContain('end sa done');
    // sa's claim is released: sb may now edit hero
    expect(await hook('pre-edit', edit(project, 'sb', 'b3', 'Hello', 'Hey'))).toMatchObject({
      stdout: '',
    });
  });

  test("post-bash binds a write verb's writes in the tool window to the run", async () => {
    await hook('prompt', { session_id: 'sc', prompt_id: 'p1', cwd: project, prompt: 'z' });
    const e = bash(project, 'sc', 'c1', 'maude design canvas-edit ui/C.tsx --set y');
    await hook('pre-bash', e);
    writeFileSync(canvasPath(project), CANVAS.replace('<p>x</p>', '<p>w</p>'));
    const r = await hook('post-bash', e);
    expect(r).toMatchObject({ status: 0, stdout: '' });
    expect(r.ms).toBeLessThan(1500);
    expect(bracket).toContain('touch sc ui/C.tsx');
  });
});
