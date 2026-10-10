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
const RECORD_SHOT = join(ROOT, 'apps', 'studio', 'bin', '_record-shot.sh');
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

/** A fake design plugin root: its bundled manifest copy + plugin.json version. */
function makePlugin(manifestVersion, version) {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'maude-hook-plugin-')));
  mkdirSync(join(p, '.claude-plugin'), { recursive: true });
  writeFileSync(join(p, 'actions.manifest.json'), JSON.stringify({ manifestVersion }));
  writeFileSync(
    join(p, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'design', version })
  );
  return p;
}
const sessionStart = (project, pluginRoot) =>
  hook(
    'session-start',
    { session_id: 'ss', cwd: project, hook_event_name: 'SessionStart' },
    {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_ENV_FILE: '',
    }
  );
const contextOf = (r) => r.json?.hookSpecificOutput?.additionalContext ?? '';

function makeProject(prefix) {
  const p = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  mkdirSync(join(p, '.design', 'ui'), { recursive: true });
  writeFileSync(join(p, '.design', 'config.json'), '{}');
  writeFileSync(join(p, '.design', 'ui', 'C.tsx'), CANVAS);
  return p;
}

async function hook(event, input, env = {}) {
  const t0 = performance.now();
  const { MAUDE_AGENT_ACTOR: _unset, ...base } = process.env;
  const p = Bun.spawn(['node', MAUDE, 'design', 'hook', event], {
    stdin: new Blob([typeof input === 'string' ? input : JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...base, MAUDE_NO_UPDATE_CHECK: '1', CLAUDE_PROJECT_DIR: '', ...env },
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
const BOARD = '{"format":"maude.annotations","v":2,"elements":[]}\n';
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
    ['SubagentStart', undefined, 'subagent-start', 3],
    ['SessionStart', '', 'session-start', 8],
    ['SubagentStop', undefined, 'stop', 60],
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

  test('post-edit on a synced board: one hint to prefer `annotate --ops`', async () => {
    const boardP = join(project, '.design', 'ui', 'C.annotations.json');
    const editBoard = (id) => ({
      session_id: 's8',
      tool_use_id: id,
      cwd: project,
      tool_name: 'Write',
      tool_input: { file_path: boardP, content: BOARD },
    });
    writeFileSync(boardP, BOARD);
    // not synced → silent
    await hook('pre-edit', editBoard('h0'));
    const quiet = await hook('post-edit', editBoard('h0'));
    expect(quiet.stdout).not.toContain('maude design annotate');
    writeFileSync(
      join(project, '.design', 'config.json'),
      JSON.stringify({ linkedHub: { url: 'https://hub.example' } })
    );
    try {
      await hook('pre-edit', editBoard('h1'));
      const r = await hook('post-edit', editBoard('h1'));
      expect(r.json?.decision).toBeUndefined(); // an empty v2 board passes the check
      expect(r.json.hookSpecificOutput).toMatchObject({ hookEventName: 'PostToolUse' });
      expect(r.json.hookSpecificOutput.additionalContext).toContain('maude design annotate');
      // once a run
      await hook('pre-edit', editBoard('h2'));
      expect((await hook('post-edit', editBoard('h2'))).stdout).not.toContain(
        'maude design annotate'
      );
      expect(r.stdout).not.toMatch(/"(ask|allow)"/);
    } finally {
      writeFileSync(join(project, '.design', 'config.json'), '{}');
      rmSync(boardP, { force: true });
      rmSync(join(project, '.design', '_runs', 's8'), { recursive: true, force: true });
    }
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
          begin: (r) => bracket.push(`begin ${r.session}`, `actor ${r.session} ${r.actor}`),
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
          return Response.json({
            app: 'design',
            rootId: rootIdentity(project),
            manifestVersion: 'bbbbbbbbbbbb',
            version: '2.4.0',
          });
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
    const first = await hook('prompt', {
      session_id: 'sa',
      prompt_id: 'p1',
      cwd: project,
      prompt: 'x',
    });
    expect(first.status).toBe(0);
    expect(first.json.hookSpecificOutput.additionalContext).toContain('.design/_runs/sa/');
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
    // Stop's screenshot gate (§5.4 step 2): hero changed, nothing captured it yet → block once
    const stop = { session_id: 'sa', cwd: project, stop_hook_active: false };
    const blocked = await hook('stop', stop);
    expect(blocked.json.decision).toBe('block');
    expect(blocked.json.reason).toContain('ui/C.tsx › hero');
    expect(blocked.json.reason).toContain('maude design screenshot');
    expect(bracket).not.toContain('end sa done');
    // `maude design screenshot --screen hero` under this session records the capture
    const rec = Bun.spawnSync(
      [
        'bash',
        RECORD_SHOT,
        '--root',
        project,
        '--canvas',
        '.design/ui/C.tsx',
        '--artboard',
        'hero',
      ],
      { env: { ...process.env, MAUDE_HOOK_SESSION: 'sa' } }
    );
    expect(rec.exitCode).toBe(0);
    expect(await hook('stop', stop)).toMatchObject({ stdout: '' });
    expect(bracket).toContain('end sa done');
    // sa's claim is released: sb may now edit hero
    expect(await hook('pre-edit', edit(project, 'sb', 'b3', 'Hello', 'Hey'))).toMatchObject({
      stdout: '',
    });
  });

  test('session-start (§5.6): warns once when the plugin is older than the app, names the active canvas', async () => {
    const older = makePlugin('aaaaaaaaaaaa', '2.3.0');
    const newer = makePlugin('aaaaaaaaaaaa', '2.5.0');
    const same = makePlugin('bbbbbbbbbbbb', '2.4.0');
    try {
      const warn = await sessionStart(project, older);
      expect(warn.status).toBe(0);
      expect(warn.json.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(contextOf(warn)).toMatch(
        /design plugin \(2\.3\.0\) is older than Maude \(2\.4\.0\).*update/i
      );
      expect(contextOf(warn).length).toBeLessThanOrEqual(400);
      expect(warn.stdout).not.toMatch(/"(ask|allow|block|deny)"/);
      // a newer plugin, or the same manifest → no warning
      for (const root of [newer, same])
        expect(contextOf(await sessionStart(project, root))).not.toMatch(/older/);
      // the studio is up: one line naming the active canvas
      writeFileSync(
        join(project, '.design', '_active.json'),
        JSON.stringify({ active: '.design/ui/C.tsx' })
      );
      expect(contextOf(await sessionStart(project, same))).toMatch(/ui\/C\.tsx/);
    } finally {
      for (const d of [older, newer, same]) rmSync(d, { recursive: true, force: true });
      rmSync(join(project, '.design', '_active.json'), { force: true });
    }
  });

  test('actor: a Maude chat session (MAUDE_AGENT_ACTOR from the ACP bridge) vs a terminal', async () => {
    expect(bracket).toContain('actor sa claude-code');
    await hook(
      'prompt',
      { session_id: 'sm', cwd: project, prompt: 'x' },
      { MAUDE_AGENT_ACTOR: 'maude-chat' }
    );
    expect(bracket).toContain('actor sm maude-chat');
    // any other value is a terminal session
    await hook(
      'prompt',
      { session_id: 'sn', cwd: project, prompt: 'x' },
      { MAUDE_AGENT_ACTOR: 'robot' }
    );
    expect(bracket).toContain('actor sn claude-code');
    await hook('stop', { session_id: 'sm', cwd: project, stop_hook_active: false });
    await hook('stop', { session_id: 'sn', cwd: project, stop_hook_active: false });
  });

  test('pre-edit denies an edit of a locked element (soft-locked, A10)', async () => {
    const lockedPath = join(project, '.design', 'ui', 'L.tsx');
    writeFileSync(
      lockedPath,
      CANVAS.replace('<p>x</p>', '<p data-cd-id="lead" data-cd-locked>x</p>')
    );
    const r = await hook('pre-edit', {
      session_id: 'sd',
      tool_use_id: 'd1',
      cwd: project,
      tool_name: 'Edit',
      tool_input: {
        file_path: lockedPath,
        old_string: 'data-cd-locked>x',
        new_string: 'data-cd-locked>y',
      },
    });
    expect(isDeny(r, 'soft-locked')).toBe(true);
    expect(readFileSync(lockedPath, 'utf8')).toContain('data-cd-locked>x');
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

describe('sub-agents — SubagentStart / pre-edit `owns` / SubagentStop (V2-1.18 §5.4)', () => {
  let project;
  const run = () => join(project, '.design', '_runs', 's6');
  const IN = {
    contract: 'maude.agent-handoff/1',
    role: 'in',
    runId: 'r_s6s6',
    agent: 'board-reader',
    task: 'Read the board.',
    owns: ['.design/_runs/s6/brief.json', '.design/ui/Draft-*.tsx'],
    output: '.design/_runs/s6/handoff/board-reader-0.out.json',
  };
  const OUT = {
    contract: 'maude.agent-handoff/1',
    role: 'out',
    agent: 'board-reader',
    status: 'done',
    summary: 'Read it.',
    changed: [],
    decisions: [],
    findings: [],
    open_questions: [],
  };
  const sub = { session_id: 's6', agent_id: 'a1', agent_type: 'design:board-reader' };
  const subStop = (extra = {}) =>
    hook('stop', {
      ...sub,
      cwd: project,
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      ...extra,
    });
  beforeAll(() => {
    project = makeProject('maude-hook-sub-');
    mkdirSync(join(run(), 'handoff'), { recursive: true });
    writeFileSync(join(run(), 'handoff', 'board-reader-0.in.json'), JSON.stringify(IN));
    writeFileSync(
      join(run(), 'touched.json'),
      JSON.stringify({ 'ui/C.tsx': { at: 1, by: 'main' } })
    );
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  test('the first prompt of a session names its run folder once', async () => {
    const a = await hook('prompt', {
      session_id: 's7',
      prompt_id: 'p1',
      cwd: project,
      prompt: 'x',
    });
    expect(a.json.hookSpecificOutput).toMatchObject({ hookEventName: 'UserPromptSubmit' });
    expect(a.json.hookSpecificOutput.additionalContext).toMatch(
      /\.design\/_runs\/s7\/ \(run id r_[0-9a-f]{16}; .*handoff\//
    );
    expect(a.json.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(200);
    expect(
      await hook('prompt', { session_id: 's7', prompt_id: 'p2', cwd: project, prompt: 'y' })
    ).toMatchObject({
      status: 0,
      stdout: '',
    });
  });

  test('SubagentStart records the agent; outside its hand-off `owns` → deny out-of-scope', async () => {
    expect(
      await hook('subagent-start', { ...sub, cwd: project, hook_event_name: 'SubagentStart' })
    ).toMatchObject({
      status: 0,
      stdout: '',
    });
    expect(JSON.parse(readFileSync(join(run(), 'agents.json'), 'utf8')).a1).toMatchObject({
      type: 'design:board-reader',
    });
    const r = await hook('pre-edit', { ...edit(project, 's6', 'x1', 'Hi', 'Yo'), ...sub });
    expect(isDeny(r, 'out-of-scope')).toBe(true);
    expect(r.json.hookSpecificOutput.permissionDecisionReason).toContain('.design/ui/Draft-*.tsx');
    // what it owns (and any runtime path) is free
    const own = await hook('pre-edit', {
      ...sub,
      session_id: 's6',
      tool_use_id: 'x2',
      cwd: project,
      tool_name: 'Write',
      tool_input: { file_path: join(project, '.design', 'ui', 'Draft-1.tsx'), content: 'x' },
    });
    expect(own).toMatchObject({ status: 0, stdout: '' });
    // the main agent (no agent_id) is not scoped
    expect(await hook('pre-edit', edit(project, 's6', 'x3', 'Hi', 'Yo'))).toMatchObject({
      stdout: '',
    });
  });

  test('a sub-agent with no hand-off is not scoped (V2-1.18 Q6 is a lead question)', async () => {
    const r = await hook('pre-edit', {
      ...edit(project, 's6', 'x4', 'Hi', 'Yo'),
      agent_id: 'g1',
      agent_type: 'general-purpose',
    });
    expect(r).toMatchObject({ status: 0, stdout: '' });
  });

  test('SubagentStop blocks once without a valid hand-off result, never ends the run', async () => {
    const r1 = await subStop();
    expect(r1.json.decision).toBe('block');
    expect(r1.json.reason).toContain('board-reader-0.out.json');
    expect(await subStop({ stop_hook_active: true })).toMatchObject({ status: 0, stdout: '' });
    // an invalid result → blocked with the schema problem
    const outP = join(run(), 'handoff', 'board-reader-0.out.json');
    writeFileSync(outP, JSON.stringify({ ...OUT, summary: undefined, status: 'meh' }));
    const r2 = await subStop();
    expect(r2.json.decision).toBe('block');
    expect(r2.json.reason).toMatch(/summary/);
    expect(r2.json.reason).toMatch(/status/);
    writeFileSync(outP, JSON.stringify(OUT));
    expect(await subStop()).toMatchObject({ status: 0, stdout: '' });
    // the main agent's run is untouched by a sub-agent's stop
    expect(existsSync(join(run(), 'touched.json'))).toBe(true);
  });
});

describe('session-start + the screenshot record (§5.4 step 2 evidence)', () => {
  let project;
  beforeAll(() => {
    project = makeProject('maude-hook-shots-');
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  test('session-start exports the hook session to Bash through CLAUDE_ENV_FILE', async () => {
    const envFile = join(project, 'claude-env.sh');
    writeFileSync(envFile, '');
    const r = await hook(
      'session-start',
      { session_id: 'se', cwd: project, hook_event_name: 'SessionStart' },
      {
        CLAUDE_ENV_FILE: envFile,
      }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/"(ask|allow)"/);
    expect(readFileSync(envFile, 'utf8')).toContain('export MAUDE_HOOK_SESSION=se\n');
    // no env file (an older Claude Code) → still silent and fine
    expect((await hook('session-start', { session_id: 'se', cwd: project })).status).toBe(0);
  });

  test("session-start without a studio compares the plugin with this CLI's own manifest", async () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const cli = JSON.parse(
      readFileSync(join(ROOT, 'apps', 'studio', 'actions.manifest.json'), 'utf8')
    );
    const older = makePlugin('000000000000', '0.0.1');
    const current = makePlugin(cli.manifestVersion, pkg.version);
    try {
      expect(contextOf(await sessionStart(project, older))).toContain(
        `older than Maude (${pkg.version})`
      );
      expect(await sessionStart(project, current)).toMatchObject({ status: 0, stdout: '' });
      // no plugin root (a plugin that isn't installed through Claude Code) → silent
      expect(await sessionStart(project, '')).toMatchObject({ status: 0, stdout: '' });
    } finally {
      rmSync(older, { recursive: true, force: true });
      rmSync(current, { recursive: true, force: true });
    }
  });

  test('_record-shot.sh appends {at, canvas, artboard, all, session}; no session → _runs/shots.jsonl', () => {
    const run = (args, env = {}) =>
      Bun.spawnSync(['bash', RECORD_SHOT, '--root', project, ...args], {
        env: { ...process.env, MAUDE_HOOK_SESSION: '', ...env },
      });
    const t0 = Date.now();
    expect(
      run(['--canvas', '.design/ui/C.tsx', '--artboard', 'hero'], { MAUDE_HOOK_SESSION: 'sx' })
        .exitCode
    ).toBe(0);
    expect(run(['--canvas', 'ui/C.tsx', '--all']).exitCode).toBe(0);
    const mine = readFileSync(join(project, '.design', '_runs', 'sx', 'shots.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      canvas: 'ui/C.tsx',
      artboard: 'hero',
      all: false,
      session: 'sx',
    });
    expect(mine[0].at).toBeGreaterThanOrEqual(t0 - 1);
    const loose = JSON.parse(
      readFileSync(join(project, '.design', '_runs', 'shots.jsonl'), 'utf8').trim()
    );
    expect(loose).toMatchObject({ canvas: 'ui/C.tsx', artboard: null, all: true, session: null });
    // a session id that is not a hook key is not used as a path
    expect(run(['--canvas', 'ui/C.tsx', '--all'], { MAUDE_HOOK_SESSION: '../x' }).exitCode).toBe(0);
    expect(existsSync(join(project, '.design', 'x'))).toBe(false);
  });
});
