// routes/ds-make.ts — making a design system over `/_api/ds/make` and `/_api/ds/make-state`
// (S10.16a; engine ds/make.ts). Kept out of routes/ds.ts so that file's hunk is two `case` lines:
// `runDsOp` hands the op here, and the verb (`maude design ds make|draft|use|mix|done`) and the
// route both end up in this one function.
//
// Permissions (S10 Q15, rule 12): make / draft / use / mix / done are Can edit on the WHOLE project
// (a canvas-scoped grant is refused); `make-state` is a read, for anyone who can see the system
// (a canvas-only session sees it through its Design system canvas, like every other ds read).

import { DsEngineError } from '../ds/engine.ts';
import type { MixInput } from '../ds/make.ts';
import { createDsMake } from '../ds/make.ts';
import type { DsOpAnswer, DsOpContext } from './ds.ts';

const FORMATS = { result: 'maude.ds-result', make: 'maude.ds-make' } as const;
const ACTIONS = ['make', 'draft', 'use', 'mix', 'done'] as const;
type MakeAction = (typeof ACTIONS)[number];

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (m: string) => new DsEngineError('ds-make-invalid', m);
const str = (v: unknown, what: string, max = 128): string => {
  if (typeof v !== 'string' || !v || v.length > max) throw invalid(`${what} is a non-empty string`);
  return v;
};

/** The system `raw` names that this session may see, else "no such system" (no existence oracle). */
function visible(c: DsOpContext, raw: unknown): string {
  const ds = str(raw, 'ds', 64);
  const s = c.engine.systems().find((x) => x.name === ds);
  const seen =
    !!s && (c.access.role !== null || c.access.seesCanvas(`${s.path}/design-system.tsx`));
  if (!seen)
    throw new DsEngineError('ds-unknown-system', `no design system named ${ds.slice(0, 64)}`);
  return ds;
}

export async function runMakeOp(
  op: 'make' | 'make-state',
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  const mk = createDsMake(c.engine, c.held ? { held: c.held } : {});
  if (op === 'make-state') {
    const ds = visible(c, input.ds);
    return { status: 200, body: { format: FORMATS.make, v: 1, ...mk.sections(ds) } };
  }
  if (!c.access.can('edit', null))
    return {
      status: 403,
      body: { error: 'You can’t change this design system.', code: 'forbidden' },
    };
  const action = input.action as MakeAction;
  if (!ACTIONS.includes(action)) throw invalid(`action is ${ACTIONS.join(' | ')}`);
  const ds = action === 'make' ? str(input.ds, 'ds', 64) : visible(c, input.ds);
  let r: Awaited<ReturnType<typeof mk.make>>;
  switch (action) {
    case 'make':
      r = await mk.make({
        ds,
        label: typeof input.label === 'string' ? input.label : ds,
        by: c.by,
      });
      break;
    case 'draft':
      r = await mk.draft({
        ds,
        direction: str(input.direction, 'direction', 8),
        tokens: input.tokens,
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
        ...(typeof input.componentsCss === 'string' ? { componentsCss: input.componentsCss } : {}),
        by: c.by,
      });
      break;
    case 'use':
      r = await mk.use({ ds, direction: str(input.direction, 'direction', 8), by: c.by });
      break;
    case 'mix': {
      const take: MixInput['take'] = {};
      if (!isObj(input.take)) throw invalid('take is {group: direction}');
      for (const [k, v] of Object.entries(input.take)) take[k] = str(v, `take.${k}`, 8);
      r = await mk.mix({ ds, base: str(input.base, 'base', 8), take, by: c.by });
      break;
    }
    default:
      r = await mk.done({ ds, by: c.by, setDefault: input.setDefault !== false });
  }
  c.outside?.invalidate(ds);
  c.emit?.('ds:changed', { system: ds });
  return { status: 200, body: { format: FORMATS.result, v: 1, ...r } };
}
