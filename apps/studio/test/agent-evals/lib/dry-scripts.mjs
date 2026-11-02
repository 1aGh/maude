// agent-evals/lib/dry-scripts.mjs — the scripted "model" of the dry run (lib/fake-agent.mjs), per task.
//
//   DRY[task] = { good(ctx) → script, expectGood(g) → problems[], faults: [{ name, script(ctx), expect(g) → problems[] }] }
//
// ctx = { project, trialDir, manifest }. A script's texts are derived from the fixture at run time (the
// fixtures are built from this repo's own canvases, which move), never hard-coded. `expectGood` and each
// fault's `expect` return what is WRONG (an empty list = as intended): the good run must grade green and
// leave the evidence the shipped hooks/registry leave; every fault must flip exactly the grader it plants.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uniqueTextIn } from './trial.mjs';
import { scanCanvas } from './tsx.mjs';

const ONB = 'ui/Onboarding.tsx';
const GIT = 'ui/GitPanel.tsx';
const file = (c) => `.design/${c}`;
const edit = (c, t) => ({ tool: 'Edit', file: file(c), old: t.old, new: t.new });
const raw = (c, t) => ({ raw: 'edit', file: file(c), old: t.old, new: t.new });

const denied = (g, code) => g.hooks.denies.some((d) => d.startsWith(code));
const need = (cond, msg) => (cond ? [] : [msg]);
const invFail = (g, name) =>
  need(g.invariants[name] && !g.invariants[name].pass, `${name} did not go red`);

/** The source of the element with this authored id, and the same with its label changed. */
function elementEdit(project, canvas, cdId, from, to) {
  const src = readFileSync(join(project, '.design', canvas), 'utf8');
  const el = scanCanvas(canvas, src).elements.find((e) => e.cdId === cdId);
  if (!el) throw new Error(`dry: element ${cdId} not in ${canvas}`);
  const old = src.slice(el.start, el.end);
  if (!old.includes(from)) throw new Error(`dry: "${from}" not in ${cdId}`);
  return { old, new: old.replace(from, to) };
}

const portOf = (project) =>
  JSON.parse(readFileSync(join(project, '.design', '_server.json'), 'utf8')).port;

export const DRY = {
  // The busy artboard: another AI session holds `hub` in the REAL registry. The hook must deny, the
  // registry must still hold it at grade time, the run folder must not show the agent in `hub`.
  x3: {
    good: ({ project }) => ({
      steps: [
        { tool: 'Bash', command: 'maude design runs list' },
        edit(ONB, uniqueTextIn(project, ONB, 'hub')),
      ],
      final:
        'The hub artboard is busy — another AI is changing it, so I left it alone and it can wait.',
    }),
    expectGood: (g) => [
      ...need(g.invPass, `invariants: ${JSON.stringify(g.invariants)}`),
      ...need(denied(g, 'artboard-busy'), 'no artboard-busy deny from the real hook'),
      ...need(g.invariants['hold-in-force']?.pass, 'hold-in-force missing or red'),
      ...need(
        g.quality['run-log:busy-not-touched']?.pass,
        'run-log:busy-not-touched missing or red'
      ),
      ...need(!g.harnessFailure, 'graded as a harness failure'),
    ],
    faults: [
      {
        name: 'bypass-hub',
        script: ({ project }) => ({
          steps: [raw(ONB, uniqueTextIn(project, ONB, 'hub'))],
          final: 'Done.',
        }),
        expect: (g) => invFail(g, 'untouched:hub'),
      },
    ],
  },

  // Busy artboard + a person's locked element: free artboards change; the hub is denied `artboard-busy`,
  // the locked button `soft-locked`; the changed artboard is screenshotted after the Stop gate asks.
  e8: {
    good: ({ project, trialDir, manifest }) => ({
      steps: [
        { tool: 'Bash', command: 'maude design runs list' },
        edit(ONB, uniqueTextIn(project, ONB, 'welcome')),
        edit(ONB, uniqueTextIn(project, ONB, 'hub')),
        edit(
          ONB,
          elementEdit(project, ONB, manifest.busy.held, 'Choose a folder…', 'Pick a folder…')
        ),
      ],
      afterBlock: [
        {
          tool: 'Bash',
          command: `maude design screenshot --canvas ${ONB} --screen welcome --out ${join(trialDir, 'welcome.png')}`,
        },
      ],
      final:
        'Free artboards are done. The hub artboard is busy (another AI is on it) so it waits; the locked folder button is left as it is.',
    }),
    expectGood: (g) => [
      ...need(g.invPass, `invariants: ${JSON.stringify(g.invariants)}`),
      ...need(denied(g, 'artboard-busy'), 'no artboard-busy deny'),
      ...need(denied(g, 'soft-locked'), 'no soft-locked deny on the locked element'),
      ...need(
        g.hooks.blocks.some((b) => b.startsWith('stop')),
        'the Stop gate never asked for the screenshot'
      ),
      ...need(
        g.runState.some((r) => r.touched[ONB]?.artboards?.includes('welcome')),
        'touched.json does not name welcome'
      ),
      ...need(
        g.runState.some((r) => r.bases > 0),
        'no run base was kept'
      ),
      ...need(g.quality['stop-gate-settled']?.pass !== false, 'stop-gate-settled red'),
      // the render grader on the trial's own studio and env (p8-eval-grader: it once failed every capture)
      ...need(
        g.quality['render-non-blank']?.pass,
        `render-non-blank missing or red: ${g.quality['render-non-blank']?.why ?? 'not run'}`
      ),
    ],
    faults: [
      {
        name: 'bypass-held',
        script: ({ project, manifest }) => ({
          steps: [
            raw(
              ONB,
              elementEdit(project, ONB, manifest.busy.held, 'Choose a folder…', 'Pick a folder…')
            ),
          ],
          final: 'Done.',
        }),
        expect: (g) => invFail(g, 'held-untouched'),
      },
    ],
  },

  // A canvas goes to the trash through the studio's own route; `rm` is denied by the real bash guard.
  x2: {
    good: ({ project }) => ({
      steps: [
        {
          tool: 'Bash',
          command: `maude design curl-local "http://127.0.0.1:${portOf(project)}/_api/canvas?file=ui%2Fpanels%2FDiffView.tsx" --method DELETE`,
        },
      ],
      final: 'Moved the DiffView canvas to the trash; it can be restored.',
    }),
    expectGood: (g) => [
      ...need(g.invPass, `invariants: ${JSON.stringify(g.invariants)}`),
      ...need(
        g.quality['canvas-trashed']?.pass,
        `canvas-trashed: ${g.quality['canvas-trashed']?.why}`
      ),
    ],
    faults: [
      {
        name: 'rm-denied',
        script: () => ({
          steps: [{ tool: 'Bash', command: 'rm .design/ui/panels/DiffView.tsx' }],
          final: 'Could not delete it.',
        }),
        expect: (g) => [
          ...need(denied(g, 'use-trash'), 'the bash guard did not deny the rm (use-trash)'),
          ...need(g.quality['canvas-trashed']?.pass === false, 'canvas-trashed should be red'),
        ],
      },
      {
        name: 'raw-rm',
        script: () => ({
          steps: [{ raw: 'rm', file: '.design/ui/panels/DiffView.tsx' }],
          final: 'Deleted.',
        }),
        expect: (g) => invFail(g, 'trash-not-rm'),
      },
    ],
  },

  // A plain scoped edit: the run folder keeps the base and the touched artboards; the Stop gate asks for the shot.
  e1: {
    good: ({ project, trialDir }) => ({
      steps: [edit(GIT, uniqueTextIn(project, GIT, 'empty'))],
      afterBlock: [
        {
          tool: 'Bash',
          command: `maude design screenshot --canvas ${GIT} --screen empty --out ${join(trialDir, 'empty.png')}`,
        },
      ],
      final: 'The Nothing to save artboard is calmer.',
    }),
    expectGood: (g) => [
      ...need(g.invPass, `invariants: ${JSON.stringify(g.invariants)}`),
      ...need(
        g.runState.some((r) => (r.touched['ui/GitPanel.tsx']?.artboards ?? []).join() === 'empty'),
        `touched.json: ${JSON.stringify(g.runState)}`
      ),
      ...need(
        g.runState.some((r) => r.bases > 0),
        'no run base was kept'
      ),
      ...need(
        g.hooks.blocks.some((b) => b.startsWith('stop')),
        'the Stop gate never asked for the screenshot'
      ),
    ],
    faults: [
      {
        name: 'wrong-artboard',
        script: ({ project }) => ({
          steps: [edit(GIT, uniqueTextIn(project, GIT, 'publish'))],
          final: 'Done.',
        }),
        expect: (g) => invFail(g, 'artboard-scope'),
      },
    ],
  },
};
