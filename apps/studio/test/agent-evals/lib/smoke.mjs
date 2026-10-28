// agent-evals/lib/smoke.mjs — the harness's own no-model self-test: fixtures build, graders catch
// planted faults (red-first: every fault below must flip its grader) and read the state the SHIPPED hooks
// and run registry leave (the run folder `_runs/<session>/`, the registry's `runs list`, the error results the
// model saw). The end-to-end half — a scripted agent through the real hooks and a real studio — is
// `run.mjs dry` (lib/dry.mjs). No `claude`, no network.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixtures.mjs';
import { cssReaches, gradeCode, headOf } from './grade.mjs';
import { holdInForce, hookDecisions, readRunState, runBase } from './runstate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EMPTY_TR = {
  ok: true,
  toolUses: [],
  agents: [],
  finalText: '',
  metrics: { subtype: 'success' },
};

export async function runSmoke({ out, log = console.log } = {}) {
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
  // The studio's trash is `_trash/<stamp>__<slug>/<file>` + a `_trash-manifest.json` that names the canvas
  // (found by running the real route in the dry run: the prototype grader looked for a nested path).
  const tdir = join(app.d, '_trash', '2026-10-25T22-20-49-836Z__ui-gitpanel');
  mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, 'GitPanel.tsx'), src0);
  g = grade(app.dir, { trash: { canvas: 'ui/GitPanel.tsx' } });
  expect(
    'a trash folder whose manifest does not name the canvas does not count (trash-not-rm red)',
    !g.invariants['trash-not-rm'].pass
  );
  writeFileSync(
    join(tdir, '_trash-manifest.json'),
    JSON.stringify({ canvas: 'ui/GitPanel.tsx', slug: 'ui-gitpanel', trashed: ['ui/GitPanel.tsx'] })
  );
  g = grade(app.dir, { trash: { canvas: 'ui/GitPanel.tsx' } });
  expect(
    "a canvas in the studio's trash (manifest names it) passes trash-not-rm",
    g.invariants['trash-not-rm'].pass && g.quality['canvas-trashed'].pass,
    g.invariants['trash-not-rm'].why
  );
  rmSync(join(app.d, '_trash'), { recursive: true, force: true });
  writeFileSync(canvas, src0);
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

  // 4. The shipped hooks' and registry's state, read by the graders (the old path read a prototype
  //    hook's `hooklog.jsonl` and `_state/eval-runs.json`, which the released plugin never writes).
  const busy = fresh('busy');
  const ONB = 'ui/Onboarding.tsx';
  const session = '0b3f2c1e-aaaa-4bbb-8ccc-123456789abc';
  const runDir = join(busy.d, '_runs', session);
  mkdirSync(runDir, { recursive: true });
  const denyTr = {
    ...EMPTY_TR,
    toolUses: [
      { name: 'Edit', id: 'toolu_1', input: { file_path: join(busy.d, ONB) }, parent: null },
    ],
    toolResults: [
      {
        id: 'toolu_1',
        isError: true,
        text: 'artboard-busy: hub is busy — a Claude Code session is changing it.',
      },
    ],
  };
  const dec = hookDecisions(denyTr, readRunState(busy.dir));
  expect(
    'an error result that starts with a deny code is a hook deny',
    dec.length === 1 && dec[0].code === 'artboard-busy' && dec[0].decision === 'deny',
    JSON.stringify(dec)
  );
  expect(
    'an ordinary tool error is not a hook decision',
    hookDecisions(
      { ...denyTr, toolResults: [{ id: 'toolu_1', isError: true, text: 'old_string not found' }] },
      readRunState(busy.dir)
    ).length === 0
  );
  writeFileSync(join(runDir, 'stop-last.json'), '{"sig":"x","at":1}');
  expect(
    'a stop-last.json in the run folder is one Stop-gate block',
    hookDecisions(EMPTY_TR, readRunState(busy.dir)).filter((x) => x.decision === 'block').length ===
      1
  );
  rmSync(join(runDir, 'stop-last.json'));

  const manifest = { busy: busy.m.busy };
  const view = (artboard) => ({
    runs: [{ state: 'running', artboards: [{ canvas: ONB, artboard }] }],
  });
  expect('the registry answer names the held artboard', holdInForce(view('hub'), ONB, 'hub'));
  expect('…and not another one', !holdInForce(view('welcome'), ONB, 'hub'));
  expect(
    '…and a waiting run holds nothing',
    !holdInForce(
      { runs: [{ state: 'waiting', artboards: [{ canvas: ONB, artboard: 'hub' }] }] },
      ONB,
      'hub'
    )
  );
  const bg = (registry, tr = EMPTY_TR) =>
    gradeCode({
      task: task({ readOnly: true }),
      project: busy.dir,
      transcript: tr,
      manifest,
      registry,
    });
  g = bg({ view: view('hub') });
  expect(
    'hold-in-force is green while the registry holds the artboard',
    g.invariants['hold-in-force']?.pass
  );
  g = bg({ view: { runs: [] } });
  expect(
    'hold-in-force goes red when the hold vanished from the registry',
    g.invariants['hold-in-force']?.pass === false,
    JSON.stringify(g.invariants['hold-in-force'])
  );
  g = bg(null);
  expect(
    'no registry, no hold-in-force verdict (a re-grade)',
    g.invariants['hold-in-force'] === undefined
  );
  expect(
    'run-log: nothing touched → busy-not-touched green',
    g.quality['run-log:busy-not-touched']?.pass
  );
  writeFileSync(
    join(runDir, 'touched.json'),
    JSON.stringify({ [ONB]: { at: 1, by: 'Edit', via: 'hook', artboards: ['hub'] } })
  );
  g = bg(null);
  expect(
    'a run folder that names the busy artboard fails run-log:busy-not-touched',
    g.quality['run-log:busy-not-touched']?.pass === false,
    JSON.stringify(g.quality['run-log:busy-not-touched'])
  );
  writeFileSync(
    join(runDir, 'touched.json'),
    JSON.stringify({ [ONB]: { at: 1, by: 'Edit', via: 'hook', artboards: null } })
  );
  g = bg(null);
  expect(
    '…and so does an unknown artboard set (the hook could not tell)',
    g.quality['run-log:busy-not-touched']?.pass === false
  );
  rmSync(join(runDir, 'touched.json'));

  // run base: the bytes before the run first touched the file, keyed like the hook keys them
  const key = createHash('sha256').update(ONB, 'utf8').digest('hex').slice(0, 16);
  mkdirSync(join(runDir, 'base'), { recursive: true });
  writeFileSync(join(runDir, 'base', key), 'BEFORE');
  expect(
    "runBase finds the hook's base copy by the hook's key",
    runBase(busy.dir, ONB) === 'BEFORE'
  );
  expect('…and has none for another file', runBase(busy.dir, 'ui/Other.tsx') === undefined);
  rmSync(join(runDir, 'base'), { recursive: true, force: true });
  writeFileSync(join(runDir, 'stop-last.json'), '{"sig":"x","at":1}');
  const ob = join(busy.d, ONB);
  const obSrc = readFileSync(ob, 'utf8');
  writeFileSync(ob, obSrc.replace(/ data-cd-id="choose-a-folder"/, ''));
  g = gradeCode({
    task: task({ allow: [ONB] }),
    project: busy.dir,
    transcript: EMPTY_TR,
    manifest: {},
  });
  expect(
    'the Stop gate blocked and the run ended with a failing check → stop-gate-settled red',
    g.quality['stop-gate-settled']?.pass === false,
    JSON.stringify([g.invariants.check, g.quality['stop-gate-settled']])
  );
  writeFileSync(ob, obSrc);
  // The released Stop hook deletes `_runs/<session>/` when the run ends (design-hook.mjs `stop`): what the
  // harness archived while the run was alive is the only record left, and the graders read it.
  const archive = join(out, 'runlog');
  mkdirSync(join(archive, session), { recursive: true });
  writeFileSync(
    join(archive, session, 'touched.json'),
    JSON.stringify({ [ONB]: { at: 1, by: 'Edit', via: 'hook', artboards: ['hub'] } })
  );
  rmSync(runDir, { recursive: true, force: true });
  expect(
    'a run folder the Stop hook deleted is still read from the harness archive',
    readRunState(busy.dir, archive).sessions.length === 1 &&
      readRunState(busy.dir).sessions.length === 0
  );
  g = gradeCode({
    task: task({ readOnly: true }),
    project: busy.dir,
    transcript: EMPTY_TR,
    manifest,
    runlog: archive,
  });
  expect(
    '…so run-log:busy-not-touched still catches a touch of the busy artboard',
    g.quality['run-log:busy-not-touched']?.pass === false
  );

  // p8-eval-grader: a DS switch's proposals live in the run folder, which the Stop hook deletes — the grader
  // must find them in the run log, and a sheet addition that no busy-artboard markup uses must not read as a touch.
  const ds = fresh('multids');
  const dsRun = join(out, 'ds-runlog', 'sess-ds', 'ds-switch');
  mkdirSync(dsRun, { recursive: true });
  writeFileSync(
    join(dsRun, 'ui-panels-gitpanel.json'),
    JSON.stringify({ canvas: '.design/ui/panels/GitPanel.tsx', edits: [] })
  );
  writeFileSync(join(dsRun, 'review.md'), '# review\n');
  const dsTask = {
    id: 'smoke',
    expect: {
      readOnlyVersioned: true,
      dsReview: { canvases: ['ui/panels/GitPanel.tsx'], to: 'maude-v2' },
    },
  };
  g = gradeCode({ task: dsTask, project: ds.dir, transcript: EMPTY_TR, manifest: {} });
  expect(
    'ds-switch proposals gone from _runs/ (the Stop hook deleted them) → graded missing without a run log',
    g.quality['ds-review-summary']?.pass === false && g.quality['ds-proposals']?.pass === false
  );
  g = gradeCode({
    task: dsTask,
    project: ds.dir,
    transcript: EMPTY_TR,
    manifest: {},
    runlog: join(out, 'ds-runlog'),
  });
  expect(
    '…and found in the run log when one is given',
    g.quality['ds-review-summary']?.pass === true && g.quality['ds-proposals']?.pass === true,
    JSON.stringify([g.quality['ds-review-summary'], g.quality['ds-proposals']])
  );
  const cssRel = '.design/ui/Onboarding.css';
  const cssBefore = headOf(busy.dir, cssRel);
  const onbSrc = readFileSync(join(busy.d, ONB), 'utf8');
  expect(
    'a stylesheet addition for a class the busy artboard does not render does not reach it',
    cssBefore != null &&
      cssReaches(cssBefore, `${cssBefore}\n.ob-smoke-only { color: red; }\n`, onbSrc, ONB, 'hub') ===
        false
  );
  expect(
    '…an addition on a class the artboard renders, or a changed old line, does',
    cssReaches(cssBefore, `${cssBefore}\n.ob-head { color: red; }\n`, onbSrc, ONB, 'hub') === true &&
      cssReaches(
        cssBefore,
        cssBefore.replace('letter-spacing', 'letter-spacing-x'),
        onbSrc,
        ONB,
        'hub'
      ) === true
  );

  // the deleted stand-ins stay deleted
  const gone = ['harness/verbs.mjs', 'harness/hook.mjs', 'harness/plugin', 'lib/check.mjs'];
  expect(
    'the prototype hook, plugin and verb stand-ins are gone',
    gone.every((f) => !existsSync(join(HERE, '..', f))),
    gone.filter((f) => existsSync(join(HERE, '..', f))).join(', ')
  );
  expect(
    'the PATH shim execs the shipped CLI and nothing else',
    !/harness\/|bun /.test(
      readFileSync(join(HERE, '..', 'shim', 'maude'), 'utf8').replace(/^#.*$/gm, '')
    )
  );

  const failed = results.filter((r) => !r.pass);
  log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  writeFileSync(join(out, 'smoke.json'), `${JSON.stringify(results, null, 2)}\n`);
  return failed.length === 0;
}
