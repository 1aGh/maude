// `maude design ds-upgrade` — the system-file steps of the Bring-up engine (V2-1.13 §5.10).
//   --analyse                 the check + the mechanical plan, as JSON (read-only)
//   --plan-mechanical         the plan JSON alone (read-only)
//   --validate <plan.json>    V3/V4/V8 on a (judged) plan, then V1/V2 on its result (13 on refusal)
//   --stage <plan.json>       write the result to <designRoot>/_state/ds-upgrade/<ds>/<stamp>/
//   --apply <plan.json>       validate, then write the tokens CSS in place (permission card)
// Staging of canvases, the headless visual proof and the one-undo apply action are S10's.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, loadProject, selectSystems, UsageError } from './cli.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { diskFs, loadSystem } from './system.ts';
import {
  applySystemPlan,
  mergeJudged,
  modelWithCss,
  planMechanical,
  type UpgradePlan,
  validatePlan,
  validateResult,
} from './upgrade.ts';

export function runDsUpgrade(
  argv: string[],
  env: Record<string, string | undefined> = process.env
) {
  const out = (code: number, stdout = '', stderr = '') => ({ code, stdout, stderr });
  try {
    let root: string | null = null;
    let step: string | null = null;
    let planPath: string | null = null;
    const names: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i];
      if (t === '--root') root = argv[++i] ?? null;
      else if (t === '--analyse' || t === '--plan-mechanical') step = t.slice(2);
      else if (t === '--validate' || t === '--stage' || t === '--apply') {
        step = t.slice(2);
        planPath = argv[++i] ?? null;
        if (!planPath) throw new UsageError(`${t} needs a plan file`);
      } else if (t === '--json') {
        /* always JSON */
      } else if (t.startsWith('--')) throw new UsageError(`unknown flag ${t}`);
      else names.push(t);
    }
    if (names.length !== 1 || !step)
      throw new UsageError(
        'usage: ds-upgrade <ds> --analyse | --plan-mechanical | --validate|--stage|--apply <plan.json>'
      );
    const project = loadProject(root, env);
    const [cfg] = selectSystems(project, names);
    const idx = indexRegistry(loadRegistry());
    const fs = diskFs(project.designRoot);
    const model = loadSystem(fs, cfg);
    const mech = planMechanical(model, idx);
    if (step === 'plan-mechanical' || step === 'analyse')
      return out(EXIT.ok, `${JSON.stringify(mech, null, 2)}\n`);
    const judged = JSON.parse(readFileSync(planPath as string, 'utf8')) as
      | UpgradePlan
      | UpgradePlan['items'];
    const plan = mergeJudged(mech, Array.isArray(judged) ? judged : judged.items);
    const refusals = validatePlan(model, idx, plan);
    const css = refusals.length ? null : applySystemPlan(model, plan);
    if (css !== null) refusals.push(...validateResult(model, modelWithCss(fs, cfg, css), plan));
    if (refusals.length || css === null) {
      return out(
        EXIT.refused,
        `${JSON.stringify({ refused: refusals }, null, 2)}\n`,
        'ds-upgrade: refused, nothing written\n'
      );
    }
    if (step === 'validate')
      return out(EXIT.ok, `${JSON.stringify({ ok: true, items: plan.items.length }, null, 2)}\n`);
    if (step === 'stage') {
      const dir = join(project.designRoot, '_state', 'ds-upgrade', cfg.name, String(Date.now()));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
      writeFileSync(join(dir, 'colors_and_type.css'), css);
      return out(EXIT.ok, `${JSON.stringify({ staged: dir }, null, 2)}\n`);
    }
    const abs = join(project.designRoot, cfg.tokensCssRel);
    const tmp = `${abs}.tmp-${process.pid}`;
    writeFileSync(tmp, css);
    renameSync(tmp, abs);
    return out(EXIT.ok, `${JSON.stringify({ applied: cfg.tokensCssRel }, null, 2)}\n`);
  } catch (e) {
    if (e instanceof UsageError) return out(EXIT.usage, '', `ds-upgrade: ${e.message}\n`);
    return out(EXIT.error, '', `ds-upgrade: ${(e as Error).stack ?? e}\n`);
  }
}
