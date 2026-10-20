// `maude design ds-upgrade` — the Bring-up engine's steps (V2-1.13 §5.10).
//   --analyse                 the check + the mechanical plan, as JSON (read-only)
//   --plan-mechanical         the plan JSON alone (read-only)
//   --validate <plan.json>    V3/V4/V8 on a (judged) plan, then V1/V2 on its result (13 on refusal)
//   --stage <plan.json>       before/ + after/ throwaway copies, the plan applied to after/ (system
//                             half + canvas codemods); the record in _state/ds-upgrade/<ds>/<stamp>/
//   --prove <stage>           two headless studios + the in-page ΔE gate → diff.json, review.json
//   --apply <stage>           ONE action through the project's studio (permission card); 3 = no studio
//   --discard <stage>         the throwaway copies and the record go
//   --status                  the system's live stages: staged, being proved (progress), proved (review)
//   --cancel <stage>          stops a proof in flight (S10.15b: the sheet's Cancel); --discard follows
// <stage> is the stamp `--stage` printed, or the record folder's path.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { EXIT, loadProject, selectSystems, UsageError } from './cli.ts';
import { type StudioRef, verbBy } from './ds-verb.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { diskFs, loadSystem, systemWriteViolation } from './system.ts';
import {
  applySystemPlan,
  mergeJudged,
  modelWithCss,
  planMechanical,
  type UpgradePlan,
  validatePlan,
  validateResult,
} from './upgrade.ts';
import { cancelStage, listStages } from './upgrade-progress.ts';
import { proveStage } from './upgrade-prove.ts';
import { DsUpgradeError, discardStage, stageUpgrade } from './upgrade-stage.ts';

export interface UpgradeRun {
  code: number;
  stdout: string;
  stderr: string;
  /** the async steps (prove, apply): run this for the real answer */
  later?: (o: UpgradeAsyncOptions) => Promise<UpgradeRun>;
}

export interface UpgradeAsyncOptions {
  studio?: StudioRef | null;
  fetchImpl?: typeof fetch;
}

const out = (code: number, stdout = '', stderr = ''): UpgradeRun => ({ code, stdout, stderr });
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const refusal = (e: DsUpgradeError) =>
  out(
    e.code === 'ds-upgrade-refused' ? EXIT.refused : EXIT.error,
    json({ code: e.code, error: e.message, ...(e.detail ?? {}) }),
    `ds-upgrade: ${e.message} (${e.code})\n`
  );
const stampOf = (arg: string) => basename(arg.replace(/\/+$/, ''));

export function runDsUpgrade(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): UpgradeRun {
  try {
    let root: string | null = null;
    let step: string | null = null;
    let arg: string | null = null;
    const names: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i];
      if (t === '--root') root = argv[++i] ?? null;
      else if (t === '--analyse' || t === '--plan-mechanical' || t === '--status')
        step = t.slice(2);
      else if (
        ['--validate', '--stage', '--apply', '--prove', '--discard', '--cancel'].includes(t)
      ) {
        step = t.slice(2);
        arg = argv[++i] ?? null;
        if (!arg)
          throw new UsageError(
            `${t} needs ${t === '--validate' || t === '--stage' ? 'a plan file' : 'a stage'}`
          );
      } else if (t === '--json') {
        /* always JSON */
      } else if (t.startsWith('--')) throw new UsageError(`unknown flag ${t}`);
      else names.push(t);
    }
    if (names.length !== 1 || !step)
      throw new UsageError(
        'usage: ds-upgrade <ds> --analyse | --plan-mechanical | --status | --validate|--stage <plan.json> | --prove|--apply|--discard|--cancel <stage>'
      );
    const project = loadProject(root, env);
    const [cfg] = selectSystems(project, names);
    // a cloned project's config names the staging folder and the CSS apply rewrites
    const outside =
      step === 'stage' || step === 'apply' ? systemWriteViolation(project.designRoot, cfg) : null;
    if (outside) return out(EXIT.refused, '', `ds-upgrade: ${outside}\n`);
    if (step === 'status')
      return out(EXIT.ok, json({ ds: cfg.name, stages: listStages(project.designRoot, cfg.name) }));
    if (step === 'cancel')
      return out(EXIT.ok, json(cancelStage(project.designRoot, cfg.name, stampOf(arg as string))));
    if (step === 'prove' || step === 'apply' || step === 'discard') {
      const stamp = stampOf(arg as string);
      if (step === 'discard')
        return out(EXIT.ok, json(discardStage(project.designRoot, cfg.name, stamp)));
      if (step === 'prove')
        return {
          ...out(EXIT.ok),
          later: async () => {
            try {
              const review = await proveStage(project.designRoot, cfg.name, stamp);
              const failed = review.systemFailed;
              return out(
                failed ? EXIT.refused : EXIT.ok,
                json(review),
                failed ? 'ds-upgrade: a system-file change shows on the canvases\n' : ''
              );
            } catch (e) {
              if (e instanceof DsUpgradeError) return refusal(e);
              throw e;
            }
          },
        };
      return {
        ...out(EXIT.ok),
        later: async (o) => {
          if (!o.studio)
            return out(
              3,
              '',
              "ds-upgrade: --apply is one action in the project's studio — open the project in Maude first\n"
            );
          const by = verbBy(env);
          const res = await (o.fetchImpl ?? fetch)(`${o.studio.base}/_api/ds/upgrade`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(by.kind === 'agent' ? { 'x-maude-by': 'agent' } : {}),
            },
            body: JSON.stringify({ ds: cfg.name, step: 'apply', stage: stamp }),
            signal: AbortSignal.timeout(120_000),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          if (res.status !== 200)
            return out(
              EXIT.refused,
              json(body),
              `ds-upgrade: ${body.error ?? 'refused'} (${body.code ?? res.status})\n`
            );
          return out(EXIT.ok, json(body));
        },
      };
    }
    const idx = indexRegistry(loadRegistry());
    const fs = diskFs(project.designRoot);
    const model = loadSystem(fs, cfg);
    const mech = planMechanical(model, idx);
    if (step === 'plan-mechanical' || step === 'analyse') return out(EXIT.ok, json(mech));
    const judged = JSON.parse(readFileSync(arg as string, 'utf8')) as
      | UpgradePlan
      | UpgradePlan['items'];
    const items = Array.isArray(judged) ? judged : judged.items;
    if (step === 'stage') {
      try {
        const { stage, plan } = stageUpgrade({
          designRoot: project.designRoot,
          ds: cfg.name,
          judged: items,
        });
        return out(EXIT.ok, json({ ...stage, plan }));
      } catch (e) {
        if (e instanceof DsUpgradeError) return refusal(e);
        throw e;
      }
    }
    const plan = mergeJudged(mech, items);
    const refusals = validatePlan(model, idx, plan);
    const css = refusals.length ? null : applySystemPlan(model, plan);
    if (css !== null) refusals.push(...validateResult(model, modelWithCss(fs, cfg, css), plan));
    if (refusals.length || css === null)
      return out(
        EXIT.refused,
        json({ refused: refusals }),
        'ds-upgrade: refused, nothing written\n'
      );
    return out(EXIT.ok, json({ ok: true, items: plan.items.length }));
  } catch (e) {
    if (e instanceof UsageError) return out(EXIT.usage, '', `ds-upgrade: ${e.message}\n`);
    if (e instanceof DsUpgradeError) return refusal(e);
    return out(EXIT.error, '', `ds-upgrade: ${(e as Error).stack ?? e}\n`);
  }
}

/** The whole verb: the sync steps answer at once, prove / apply run their async half. */
export async function runDsUpgradeAsync(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  o: UpgradeAsyncOptions = {}
): Promise<UpgradeRun> {
  const r = runDsUpgrade(argv, env);
  if (!r.later) return r;
  try {
    return await r.later(o);
  } catch (e) {
    return out(EXIT.error, '', `ds-upgrade: ${(e as Error).message ?? e}\n`);
  }
}
