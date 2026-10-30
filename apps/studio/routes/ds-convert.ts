// routes/ds-convert.ts — converting `system/<ds>/` folders over `POST /_api/ds/convert` (S10.12; engine
// ds/convert.ts). Kept out of routes/ds.ts so that file's hunk is one `case` and one table row:
// `runDsOp` hands the op here, and the verb (`maude design ds convert …`) and the route both end up in
// this one function.
//
// Body: `{systems?: string[], dryRun?: true}` — convert (or plan) the named systems, default every
// one not yet on a canvas; `{restore: "<ds>"}` — Restore: the system goes back to its folder.
//
// Permissions (S10 Q15, V2-1.6 §5.12, rule 12): convert and Restore need Can edit on the WHOLE
// project; a canvas-scoped grant is refused, the dry run included (it lists every system).

import { createDsConvert, DsConvertError } from '../ds/convert.ts';
import type { DsOpAnswer, DsOpContext } from './ds.ts';

const invalid = (m: string) => new DsConvertError('ds-convert-usage', m);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export async function runConvertOp(
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  if (!c.access.can('edit', null))
    return {
      status: 403,
      body: { error: 'You can’t change this design system.', code: 'forbidden' },
    };
  const cv = createDsConvert(c.engine);
  if (input.restore !== undefined) {
    if (typeof input.restore !== 'string' || !NAME_RE.test(input.restore))
      throw invalid('restore is a design system name');
    if (input.systems !== undefined || input.dryRun !== undefined)
      throw invalid('restore stands alone');
    const r = await cv.restore({ ds: input.restore, by: c.by });
    c.outside?.invalidate(r.system);
    c.emit?.('ds:changed', { system: r.system });
    return { status: 200, body: { format: 'maude.ds-result', v: 1, ...r } };
  }
  let systems: string[] | undefined;
  if (input.systems !== undefined) {
    if (
      !Array.isArray(input.systems) ||
      input.systems.length > 64 ||
      !input.systems.every((n) => typeof n === 'string' && NAME_RE.test(n))
    )
      throw invalid('systems is a list of design system names');
    systems = input.systems as string[];
  }
  if (input.dryRun === true) return { status: 200, body: { ...cv.plan(systems), result: null } };
  const r = await cv.convert({ ...(systems ? { systems } : {}), by: c.by });
  for (const s of r.result.systems) {
    c.outside?.invalidate(s.name);
    c.emit?.('ds:changed', { system: s.name });
  }
  return { status: 200, body: r };
}
