// routes/ds-upgrade.ts — "Bring it up to the schema" over `POST /_api/ds/upgrade {ds, step}`
// (V2-1.13 §5.10 / P-8, S10.15a; engine ds/upgrade*.ts). Kept out of routes/ds.ts so that file's
// hunk is one `case` and one table row. Main origin, privileged, never canvas-safe.
//
// Steps: `analyse` / `plan-mechanical` (the mechanical plan) · `validate {plan}` · `stage {plan}`
// · `prove {stage}` · `apply {stage}` (ONE action; the permission card on the agent side) ·
// `discard {stage}`. `plan` is the judged items (or a whole plan); `stage` is the stamp a stage
// answered with.
//
// S10.15b adds the two the sheet in the app needs: `status` (what the system is and every live stage of
// it: staged, being proved with its progress, or proved with its review) and `cancel {stage}` (stops
// a proof in flight; the stage is then `discard`ed). Both are read-and-signal steps — the stage's own
// record folder carries the state, so they work whichever process runs the proof.
//
// Permissions (S10 Q15, rule 12): every step needs Can edit on the WHOLE project — the plan lists
// every canvas of the system, and apply rewrites them.

import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { diskFs, loadSystem } from '../ds/system.ts';
import {
  mergeJudged,
  type PlanItem,
  planMechanical,
  type UpgradePlan,
  validatePlan,
} from '../ds/upgrade.ts';
import { applyStage } from '../ds/upgrade-apply.ts';
import { cancelStage, listStages } from '../ds/upgrade-progress.ts';
import { proveStage } from '../ds/upgrade-prove.ts';
import { DsUpgradeError, discardStage, stageUpgrade, systemOf } from '../ds/upgrade-stage.ts';
import type { DsOpAnswer, DsOpContext } from './ds.ts';

export const UPGRADE_STEPS = [
  'analyse',
  'plan-mechanical',
  'validate',
  'stage',
  'prove',
  'apply',
  'discard',
  'status',
  'cancel',
] as const;
export type UpgradeStep = (typeof UPGRADE_STEPS)[number];

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STAMP_RE = /^[0-9]{1,20}(?:-[0-9]{1,4})?$/;
const MAX_ITEMS = 5000;
const usage = (m: string) => new DsUpgradeError('ds-upgrade-usage', m);

function judgedOf(v: unknown): PlanItem[] {
  const items = Array.isArray(v) ? v : (v as UpgradePlan | null)?.items;
  if (!Array.isArray(items) || items.length > MAX_ITEMS)
    throw usage('plan is a list of plan items (or a plan)');
  for (const it of items)
    if (!it || typeof it !== 'object' || typeof (it as PlanItem).id !== 'string')
      throw usage('every plan item has an id');
  return items as PlanItem[];
}

export async function runUpgradeOp(
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  if (!c.access.can('edit', null))
    return {
      status: 403,
      body: { error: 'You can’t change this design system.', code: 'forbidden' },
    };
  const ds = input.ds;
  const step = input.step;
  if (typeof ds !== 'string' || !NAME_RE.test(ds)) throw usage('ds is a design system name');
  if (typeof step !== 'string' || !(UPGRADE_STEPS as readonly string[]).includes(step))
    throw usage(`step is one of ${UPGRADE_STEPS.join(', ')}`);
  const designRoot = c.engine.designRoot;
  const stamp = () => {
    if (typeof input.stage !== 'string' || !STAMP_RE.test(input.stage))
      throw usage('stage is the stamp the stage step answered with');
    return input.stage;
  };
  switch (step as UpgradeStep) {
    case 'analyse':
    case 'plan-mechanical':
    case 'validate': {
      const cfg = systemOf(designRoot, ds);
      const idx = indexRegistry(loadRegistry());
      const model = loadSystem(diskFs(designRoot), cfg);
      const mech = planMechanical(model, idx);
      if (step !== 'validate') return { status: 200, body: mech };
      const plan = mergeJudged(mech, judgedOf(input.plan));
      const refused = validatePlan(model, idx, plan);
      return { status: 200, body: { ok: refused.length === 0, refused, items: plan.items.length } };
    }
    case 'stage': {
      const { stage, plan } = stageUpgrade({ designRoot, ds, judged: judgedOf(input.plan) });
      return { status: 200, body: { ...stage, dir: undefined, plan } };
    }
    case 'prove':
      return { status: 200, body: await proveStage(designRoot, ds, stamp()) };
    case 'apply': {
      const r = await applyStage({
        designRoot,
        ds,
        stamp: stamp(),
        kernel: () => c.engine.kernel(),
        by: c.by,
      });
      c.outside?.invalidate(ds);
      c.emit?.('ds:changed', { system: ds });
      return { status: 200, body: r };
    }
    case 'discard':
      return { status: 200, body: discardStage(designRoot, ds, stamp()) };
    case 'status': {
      const cfg = systemOf(designRoot, ds);
      const model = loadSystem(diskFs(designRoot), cfg);
      return {
        status: 200,
        body: {
          ds,
          converted: model.converted,
          schema: typeof cfg.schema === 'number' ? cfg.schema : null,
          stages: listStages(designRoot, ds),
        },
      };
    }
    case 'cancel':
      return { status: 200, body: await cancelStage(designRoot, ds, stamp()) };
  }
  return { status: 400, body: { error: 'unknown step', code: 'usage' } };
}
