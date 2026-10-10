// agent-evals/lib/smoke.mjs — the harness's own no-model self-test: fixtures build, graders catch
// planted faults (red-first: every fault below must flip its grader), and the prototype hooks
// deny / block / restore / fail open exactly as V2-1.11 §5.4 says. No `claude`, no network.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runKey } from '../harness/common.mjs';
import { primeRegistry } from './check.mjs';
import { buildFixture } from './fixtures.mjs';
import { gradeCode } from './grade.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'harness', 'hook.mjs');
const VERBS = join(HERE, '..', 'harness', 'verbs.mjs');
const EMPTY_TR = {
  ok: true,
  toolUses: [],
  agents: [],
  finalText: '',
  metrics: { subtype: 'success' },
};

function hook(event, input) {
  const t0 = performance.now();
  const r = spawnSync('bun', [HOOK, event], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    code: r.status,
    out: r.stdout ? JSON.parse(r.stdout) : null,
    raw: r.stdout,
    ms: performance.now() - t0,
  };
}

export async function runSmoke({ out, log = console.log } = {}) {
  await primeRegistry();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const results = [];
  const expect = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${detail}`}`);
  };
  const fresh = (name) => {
    const dir = join(out, name, 'project');
    const m = buildFixture(name, dir);
    return { dir, m, d: join(dir, '.design') };
  };
  const task = (expect) => ({ id: 'smoke', expect });
  const grade = (dir, exp, tr = EMPTY_TR) =>
    gradeCode({ task: task(exp), project: dir, transcript: tr, manifest: {} });

  // 1. Fixtures build and are clean.
  const app = fresh('app5');
  expect(
    'fixture app5: 5 artboards + stamped ids + one lock',
    app.m.ids['ui/GitPanel.tsx'].length >= 20 && app.m.ids['ui/GitPanel.tsx'].some((x) => x.locked)
  );
  let g = grade(app.dir, { readOnly: true });
  expect(
    'clean fixture passes every invariant',
    Object.values(g.invariants).every((x) => x.pass),
    JSON.stringify(g.invariants)
  );

  // 2. Planted faults flip their graders.
  const canvas = join(app.d, 'ui', 'GitPanel.tsx');
  const src0 = readFileSync(canvas, 'utf8');
  const victim = app.m.ids['ui/GitPanel.tsx'].find((x) => !x.locked && x.text);
  writeFileSync(canvas, src0.replace(` data-cd-id="${victim.id}"`, ''));
  g = grade(app.dir, { allow: ['ui/GitPanel.tsx'] });
  expect(
    'a dropped data-cd-id fails ids-kept',
    !g.invariants['ids-kept'].pass,
    g.invariants['ids-kept'].why
  );
  expect('a dropped data-cd-id fails check', !g.invariants.check.pass);
  writeFileSync(canvas, src0.replace('>Changes</button>', '>Edits</button>'));
  g = grade(app.dir, { allow: ['ui/GitPanel.tsx'] });
  expect(
    'editing the locked tab fails locked-kept',
    !g.invariants['locked-kept'].pass,
    g.invariants['locked-kept'].why
  );
  writeFileSync(canvas, src0.replace('>Nothing to save</h3>', '>Nothing to save yet</h3>'));
  g = grade(app.dir, { allow: ['ui/GitPanel.tsx'], artboards: { 'ui/GitPanel.tsx': ['publish'] } });
  expect(
    'an edit outside the allowed artboard fails artboard-scope',
    !g.invariants['artboard-scope'].pass,
    g.invariants['artboard-scope']?.why
  );
  g = grade(app.dir, { allow: ['ui/GitPanel.tsx'], artboards: { 'ui/GitPanel.tsx': ['empty'] } });
  expect(
    '…and passes when that artboard is allowed',
    g.invariants['artboard-scope'].pass,
    g.invariants['artboard-scope'].why
  );
  writeFileSync(canvas, src0);
  unlinkSync(canvas);
  g = grade(app.dir, { trash: { canvas: 'ui/GitPanel.tsx' } });
  expect('rm of a canvas fails trash-not-rm', !g.invariants['trash-not-rm'].pass);
  writeFileSync(canvas, src0);
  const trs = spawnSync('bun', [VERBS, 'trash', 'move', 'ui/GitPanel.tsx'], {
    cwd: app.dir,
    encoding: 'utf8',
  });
  g = grade(app.dir, { trash: { canvas: 'ui/GitPanel.tsx' } });
  expect(
    '`maude design trash move` passes trash-not-rm',
    trs.status === 0 && g.invariants['trash-not-rm'].pass && g.quality['canvas-trashed'].pass,
    trs.stderr + g.invariants['trash-not-rm'].why
  );
  g = grade(
    app.dir,
    { readOnly: true },
    {
      ...EMPTY_TR,
      toolUses: [
        { name: 'Bash', input: { command: 'rm ".design/ui/GitPanel.tsx"' }, parent: null },
      ],
    }
  );
  expect(
    'an attempted `rm` into .design fails no-bash-writes',
    !g.invariants['no-bash-writes'].pass
  );
  g = grade(
    app.dir,
    { readOnly: true },
    {
      ...EMPTY_TR,
      toolUses: [
        {
          name: 'Bash',
          input: {
            command: "sed -i '' 's/a/b/' .design/_runs/r_x/handoff/board-reader-0.out.json",
          },
          parent: 'toolu_x',
        },
      ],
    }
  );
  expect(
    '…but a helper editing its own runtime hand-off is not a design write',
    g.invariants['no-bash-writes'].pass,
    g.invariants['no-bash-writes'].why
  );

  // 3. Board graders.
  const board = fresh('board300');
  expect(
    'fixture board300 has 300 elements, 3 locked, a hidden vote',
    board.m.elements === 300 && board.m.locked.length === 3 && board.m.counts.vote === 1,
    JSON.stringify(board.m.counts)
  );
  const bf = join(board.d, board.m.board);
  const b0 = readFileSync(bf, 'utf8');
  const lines = b0.split('\n');
  const li = lines.findIndex((l) => l.includes(`"id":"${board.m.locked[0]}"`));
  lines[li] = lines[li].replace('student tier', 'STUDENT TIER');
  writeFileSync(bf, lines.join('\n'));
  g = grade(board.dir, { allow: [board.m.board], board: { file: board.m.board } });
  expect(
    'changing a locked sticky fails board-locked-kept',
    !g.invariants['board-locked-kept'].pass
  );
  const doc = JSON.parse(b0);
  doc.elements.push({
    id: 'stk-new',
    type: 'sticky',
    index: 'zz',
    x: 0,
    y: 0,
    w: 200,
    h: 140,
    text: 'new',
  });
  writeFileSync(bf, JSON.stringify(doc));
  g = grade(board.dir, { allow: [board.m.board], board: { file: board.m.board } });
  expect(
    'a new element without an AI author fails board-ai-author',
    !g.invariants['board-ai-author'].pass
  );
  writeFileSync(bf, b0);
  g = grade(
    board.dir,
    {
      readOnly: true,
      noLeak: { voters: ['Jonas'], options: ['Usage based'], file: '_state/votes/' },
    },
    { ...EMPTY_TR, finalText: 'Jonas voted for Usage based.' }
  );
  expect(
    'naming a voter with their option fails ballots-not-disclosed',
    !g.invariants['ballots-not-disclosed'].pass
  );

  // 4. Hooks (no studio anywhere: everything below is the offline path).
  const busy = fresh('busy');
  const ob = join(busy.d, 'ui', 'Onboarding.tsx');
  const obSrc = readFileSync(ob, 'utf8');
  const base = { session_id: 'smoke-session-0001', cwd: busy.dir, hook_event_name: 'PreToolUse' };
  let h = hook('pre-edit', {
    ...base,
    tool_name: 'Write',
    tool_use_id: 't1',
    tool_input: { file_path: ob, content: 'x' },
  });
  expect(
    'pre-edit denies a whole-file Write over a canvas',
    h.out?.hookSpecificOutput?.permissionDecision === 'deny' && /whole-file-rewrite/.test(h.raw),
    h.raw
  );
  h = hook('pre-edit', {
    ...base,
    tool_name: 'Edit',
    tool_use_id: 't2',
    tool_input: {
      file_path: ob,
      old_string: '>Connect to a team hub</h1>',
      new_string: '>Connect to a team server</h1>',
    },
  });
  expect(
    'pre-edit denies an edit in the artboard another AI holds (artboard-busy)',
    /artboard-busy/.test(h.raw) && /Tereza/.test(h.raw),
    h.raw
  );
  h = hook('pre-edit', {
    ...base,
    tool_name: 'Edit',
    tool_use_id: 't3',
    tool_input: {
      file_path: ob,
      old_string: '>Open a project folder</h1>',
      new_string: '>Open a folder</h1>',
    },
  });
  expect('pre-edit allows an edit in a free artboard (no output)', h.code === 0 && !h.raw, h.raw);
  const css = join(busy.d, 'ui', 'Onboarding.css');
  const cssSrc = readFileSync(css, 'utf8');
  const firstRule = cssSrc.match(/\.[a-z][^{]+\{[^}]*\}/)[0];
  h = hook('pre-edit', {
    ...base,
    tool_name: 'Edit',
    tool_use_id: 't4',
    tool_input: {
      file_path: css,
      old_string: firstRule,
      new_string: firstRule.replace('{', '{ /* x */'),
    },
  });
  expect(
    'pre-edit denies the canvas stylesheet while an artboard is busy (module scope)',
    /artboard-busy/.test(h.raw),
    h.raw
  );
  const held = busy.m.busy.held;
  const heldLine = obSrc.split('\n').find((l) => l.includes(`data-cd-id="${held}"`));
  h = hook('pre-edit', {
    ...base,
    tool_name: 'Edit',
    tool_use_id: 't5',
    tool_input: {
      file_path: ob,
      old_string: heldLine,
      new_string: heldLine.replace('Choose a folder…', 'Pick a folder…'),
    },
  });
  expect(
    'pre-edit denies an edit of an object a person holds (soft-locked)',
    /soft-locked/.test(h.raw) && /Jonas/.test(h.raw),
    h.raw
  );
  h = hook('pre-edit', {
    ...base,
    agent_id: 'a1',
    agent_type: 'maude-b:board-reader',
    tool_name: 'Edit',
    tool_use_id: 't6',
    tool_input: { file_path: ob, old_string: '>Open a project folder</h1>', new_string: '>x</h1>' },
  });
  expect(
    'pre-edit denies a helper sub-agent writing a canvas (out-of-scope)',
    /out-of-scope/.test(h.raw),
    h.raw
  );
  h = hook('pre-edit', {
    ...base,
    agent_id: 'a1',
    agent_type: 'maude-b:board-reader',
    tool_name: 'Write',
    tool_use_id: 't7',
    tool_input: {
      file_path: join(busy.d, '_runs', 'r_smokesession', 'brief.out.json'),
      content: '{}',
    },
  });
  expect('pre-edit allows a helper writing under _runs/', h.code === 0 && !h.raw, h.raw);
  h = hook('pre-bash', {
    ...base,
    tool_name: 'Bash',
    tool_input: { command: 'rm ".design/ui/Onboarding.tsx"' },
  });
  expect('pre-bash denies rm of a canvas (use-trash)', /use-trash/.test(h.raw), h.raw);
  h = hook('pre-bash', {
    ...base,
    tool_name: 'Bash',
    tool_input: { command: "sed -i '' 's/a/b/' .design/ui/Onboarding.tsx" },
  });
  expect('pre-bash denies sed -i into .design (not-a-writer)', /not-a-writer/.test(h.raw), h.raw);
  h = hook('pre-bash', {
    ...base,
    tool_name: 'Bash',
    tool_input: {
      command:
        'maude design screenshot --canvas "ui/Onboarding.tsx" --screen welcome --out /tmp/x.png',
    },
  });
  expect('pre-bash leaves maude verbs alone', h.code === 0 && !h.raw, h.raw);

  // post-edit: a tool already wrote a bad file → blocked and restored.
  const prev = readFileSync(ob, 'utf8');
  hook('pre-edit', {
    ...base,
    tool_name: 'Edit',
    tool_use_id: 't8',
    tool_input: {
      file_path: ob,
      old_string: '>Open a project folder</h1>',
      new_string: '>Open a project folder</h1>',
    },
  });
  const someId = busy.m.ids['ui/Onboarding.tsx'].find((x) => x.text && x.id !== held);
  writeFileSync(ob, prev.replace(` data-cd-id="${someId.id}"`, ''));
  h = hook('post-edit', {
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: 't8',
    tool_input: { file_path: ob },
  });
  expect(
    'post-edit blocks a write that lost an element id',
    h.out?.decision === 'block' && /id-lost/.test(h.out?.reason ?? ''),
    h.raw
  );
  expect('…and restores the file to before the edit', readFileSync(ob, 'utf8') === prev);
  hook('pre-edit', {
    ...base,
    tool_name: 'Edit',
    tool_use_id: 't9',
    tool_input: {
      file_path: ob,
      old_string: '>Open a project folder</h1>',
      new_string: '>Open a folder</h1>',
    },
  });
  writeFileSync(ob, prev.replace('>Open a project folder</h1>', '>Open a folder</h1>'));
  h = hook('post-edit', {
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: 't9',
    tool_input: { file_path: ob },
  });
  expect('post-edit passes a clean edit silently', h.code === 0 && !h.raw, h.raw);
  h = hook('stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false });
  expect(
    'stop blocks while a changed artboard has no screenshot',
    h.out?.decision === 'block' && /local/.test(h.out?.reason ?? ''),
    h.raw
  );
  h = hook('stop', { ...base, hook_event_name: 'Stop', stop_hook_active: true });
  expect('stop lets go on the second identical block (loop guard)', h.code === 0 && !h.raw, h.raw);
  spawnSync(
    'bun',
    [
      VERBS,
      'shot-log',
      '0',
      '--canvas',
      'ui/Onboarding.tsx',
      '--screen',
      'local',
      '--out',
      '/tmp/x.png',
    ],
    { cwd: busy.dir }
  );
  writeFileSync(join(busy.d, '_runs', runKey('smoke-session-0001'), 'stop-last.json'), '{}');
  h = hook('stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false });
  expect('stop passes once the changed artboard was screenshotted', h.code === 0 && !h.raw, h.raw);

  // fail-open + deny-only.
  h = hook('pre-edit', {
    ...base,
    cwd: out,
    tool_name: 'Write',
    tool_use_id: 't10',
    tool_input: { file_path: join(out, 'outside.tsx'), content: 'x' },
  });
  expect('hooks exit 0 silently outside a design root', h.code === 0 && !h.raw);
  const bogus = spawnSync('bun', [HOOK, 'pre-edit'], { input: '{not json', encoding: 'utf8' });
  expect('hooks fail open on garbage input', bogus.status === 0 && !bogus.stdout);
  const logs = readFileSync(
    join(busy.d, '_runs', runKey('smoke-session-0001'), 'hooklog.jsonl'),
    'utf8'
  );
  expect(
    'no hook output ever says ask or allow',
    !/"permissionDecision":"(ask|allow)"/.test(logs + JSON.stringify(results))
  );
  const ms = logs
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((x) => typeof x.ms === 'number');
  const worst = Math.max(...ms.map((x) => x.ms));
  expect(
    `in-process hook work stays far under budget (worst ${worst.toFixed(0)} ms)`,
    worst < 1500,
    String(worst)
  );

  // hand-off schema: the error list names the role's own branch only (the pilot's first validator didn't).
  const { validateHandoff } = await import('../harness/handoff.mjs');
  const goodOut = {
    contract: 'maude.agent-handoff/1',
    role: 'out',
    agent: 'board-reader',
    runId: 'r_smoke0001',
    status: 'done',
    summary: 's',
    changed: [{ file: '.design/_runs/r_smoke0001/handoff/board-reader-0.out.json', kind: 'brief' }],
    decisions: [{ decision: 'd', why: 'w' }],
    findings: [],
    open_questions: [],
  };
  expect(
    'a valid hand-off out validates',
    validateHandoff(goodOut).length === 0,
    validateHandoff(goodOut).join('; ')
  );
  const badOut = validateHandoff({ ...goodOut, findings: ['a plain string'] });
  expect(
    'a string finding is reported at /findings/0, never as a missing "task"',
    badOut.some((m) => m.startsWith('/findings/0')) && !badOut.some((m) => /task|owns/.test(m)),
    badOut.join('; ')
  );
  const goodIn = {
    contract: 'maude.agent-handoff/1',
    role: 'in',
    runId: 'r_smoke0001',
    agent: 'ds-switcher',
    task: 't',
    owns: ['.design/_runs/r_smoke0001/ds-switch/x.json'],
    output: '.design/_runs/r_smoke0001/handoff/ds-switcher-0.out.json',
  };
  expect(
    'a valid hand-off in validates',
    validateHandoff(goodIn).length === 0,
    validateHandoff(goodIn).join('; ')
  );

  // stub verbs.
  const runs = spawnSync('bun', [VERBS, 'runs', 'list'], { cwd: busy.dir, encoding: 'utf8' });
  expect(
    '`maude design runs list` names the busy artboard and the hold',
    /Tereza/.test(runs.stdout) && /Jonas/.test(runs.stdout),
    runs.stdout + runs.stderr
  );
  const chk = spawnSync('bun', [VERBS, 'check', 'ui/Onboarding.tsx'], {
    cwd: busy.dir,
    encoding: 'utf8',
  });
  expect('`maude design check` runs', chk.status === 0 || chk.status === 1, chk.stderr);

  try {
    execFileSync('git', ['--version']);
  } catch {}
  const failed = results.filter((r) => !r.pass);
  log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  writeFileSync(join(out, 'smoke.json'), `${JSON.stringify(results, null, 2)}\n`);
  return failed.length === 0;
}

export const _exists = existsSync;
