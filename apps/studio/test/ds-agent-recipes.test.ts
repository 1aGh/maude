// S12.12 — the shell recipes the DS agents run, executed against the real `--json` the verbs print.
//
// The keeper and the completeness critic are markdown, but their Pass C / determinism steps are
// fixed bash + jq blocks (marked `<!-- recipe:<id> -->` in the agent file). This test pulls each
// block out of the agent file and runs it on a fixture project whose `ds status --json` comes from
// the verb itself (execDsPlan, wrapped in the untrusted envelope the CLI prints). So a renamed
// field in a verb's output, or a recipe that drifts from it, is a red test here.
//
//   keeper-ds-state         a canvas left out at an old revision is "left-out", audited against
//                           that revision's CSS — never drift; a follower is audited against head
//   completeness-determinism tokens.json + the generated CSS are byte-for-byte the head revision's;
//                           a hand edit to either names that file
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { untrustedJson } from '../bin/_studio-verb.mjs';
import { execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const AGENTS = path.join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'agents');

/** The bash block right after `<!-- recipe:<id> -->` in an agent file. */
function recipe(agent: string, id: string): string {
  const text = readFileSync(path.join(AGENTS, `${agent}.md`), 'utf8');
  const at = text.indexOf(`<!-- recipe:${id} -->`);
  if (at < 0) throw new Error(`${agent}.md has no <!-- recipe:${id} --> block`);
  const m = /```bash\n([\s\S]*?)\n```/.exec(text.slice(at));
  if (!m) throw new Error(`${agent}.md: no bash fence after recipe:${id}`);
  return m[1] as string;
}

async function run(script: string, env: Record<string, string>) {
  const p = Bun.spawn(['bash', '-c', `set -euo pipefail\n${script}`], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out: out.trim(), err, code };
}

/** What `maude design ds status <ds> --json` prints: the verb's body in the untrusted envelope. */
async function statusFile(p: Project): Promise<string> {
  const a = await execDsPlan(planDsVerb(['status', DS]), {
    root: p.root,
    studio: null,
    by: PERSON,
  });
  expect(a.status).toBe(200);
  const file = path.join(p.designRoot, '_runs', 'test', 'ds-status.json');
  p.write('_runs/test/ds-status.json', `${JSON.stringify(untrustedJson(a.body), null, 2)}\n`);
  return file;
}

/** head R1 = a new accent; Landing was left out at R0. */
async function publishedWithLandingLeftOut(): Promise<Project & { R1: string }> {
  const p = await makeProject();
  await p.engine.mergePending(DS, {
    tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
    by: PERSON,
  });
  const r = await p.engine.publish(DS, {
    expectHead: p.R0,
    canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
    by: PERSON,
  });
  expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
  return Object.assign(p, { R1: r.rev as string });
}

describe('keeper Pass C — the canvas against its own revision', () => {
  test('a canvas left out at an old dsRev is left-out (its revision CSS), not drift; a follower is head', async () => {
    const p = await publishedWithLandingLeftOut();
    const STATUS = await statusFile(p);
    const script = recipe('design-system-keeper', 'keeper-ds-state');
    const env = (canvas: string) => ({
      DESIGN_ROOT: p.designRoot,
      CANVAS_REL: canvas,
      DS_PATH,
      TOKENS_CSS_REL: `${DS_PATH}/colors_and_type.css`,
      STATUS,
    });

    const landing = await run(script, env('ui/Landing.tsx'));
    expect(landing.err).toBe('');
    expect(landing.code).toBe(0);
    const [state, rev, css] = landing.out.split(' ');
    expect([state, rev]).toEqual(['left-out', p.R0]);
    expect(css).toBe(`${DS_PATH}/revisions/${p.R0}.tokens.css`);
    // the CSS it is audited against is what it renders: the OLD accent, not head's
    const audited = p.read(css as string) as string;
    expect(audited).toContain('--accent: oklch(0.55 0.2 255);');
    expect(audited).not.toContain('oklch(0.5 0.19 255)');

    const home = await run(script, env('ui/Home.tsx'));
    expect(home.out).toBe(`follows ${p.R1} ${DS_PATH}/colors_and_type.css`);

    // a dsRev whose revision has not arrived on this Mac renders head and waits — still not drift
    p.write(
      'ui/Home.meta.json',
      `${JSON.stringify({ title: 'Home', dsRev: 'f'.repeat(64) }, null, 2)}\n`
    );
    const STATUS2 = await statusFile(p);
    const waiting = await run(script, { ...env('ui/Home.tsx'), STATUS: STATUS2 });
    expect(waiting.out).toBe(`waiting ${'f'.repeat(64)} ${DS_PATH}/colors_and_type.css`);
  });
});

describe('completeness — tokens.json ↔ generated CSS', () => {
  test('the working files equal the head revision byte for byte; a hand edit names the file', async () => {
    const p = await publishedWithLandingLeftOut();
    const STATUS = await statusFile(p);
    const script = recipe('design-system-completeness-critic', 'completeness-determinism');
    const env = { DESIGN_ROOT: p.designRoot, DS_PATH, STATUS };

    const clean = await run(script, env);
    expect(clean.err).toBe('');
    expect(clean.out).toBe(`deterministic ${p.R1}`);

    p.write(`${DS_PATH}/tokens.json`, `${p.read(`${DS_PATH}/tokens.json`)}\n`);
    const tokens = await run(script, env);
    expect(tokens.out).toBe(`differs ${p.R1} tokens.json`);

    p.write(`${DS_PATH}/colors_and_type.css`, '/* by hand */\n');
    const both = await run(script, env);
    expect(both.out).toBe(`differs ${p.R1} colors_and_type.css tokens.json`);
  });

  test('an unconverted system has no head to compare: it says so (ds-check judges tokens.json)', async () => {
    const p = await makeProject();
    rmSync(path.join(p.dsAbs, 'revisions', 'head.json'));
    const STATUS = await statusFile(p);
    const out = await run(recipe('design-system-completeness-critic', 'completeness-determinism'), {
      DESIGN_ROOT: p.designRoot,
      DS_PATH,
      STATUS,
    });
    expect(out.out).toBe('unconverted');
  });
});
