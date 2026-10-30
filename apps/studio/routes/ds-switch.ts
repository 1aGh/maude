// routes/ds-switch.ts — switching canvases to another design system over `/_api/ds/switch` (S10.14; engine
// ds/switch.ts). Kept out of routes/ds.ts so that file's hunk stays a few lines: `runDsOp` hands the op here, and
// the verb (`maude design ds switch <canvas|folder|--all> --to <ds> [--dry-run]`) and the route both end up in
// this one function.
//
// Permissions (S10 Q15, rule 12 — whatever the UI hides, the server refuses):
//   dryRun (the review)   anyone who can see the target system; a canvas-only session sees only the canvases it
//                         is granted, and a system only through its Design system canvas
//   the switch            Can edit on the WHOLE project (a canvas-scoped grant is refused)

import { createDsSwitch, type DsSwitch, DsSwitchError, type SwitchScope } from '../ds/switch.ts';
import type { DsOpAnswer, DsOpContext } from './ds.ts';

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (m: string) => new DsSwitchError('ds-switch-invalid', m);
const str = (v: unknown, what: string, max = 512): string => {
  if (typeof v !== 'string' || !v || v.length > max) throw invalid(`${what} is a non-empty string`);
  return v;
};

/** Exactly one of `canvas`, `folder`, `all: true`. */
function scopeOf(input: Record<string, unknown>): SwitchScope {
  const given = [input.canvas, input.folder, input.all].filter((v) => v !== undefined);
  if (given.length !== 1) throw invalid('name one of canvas, folder or all');
  if (input.all !== undefined) {
    if (input.all !== true) throw invalid('all is true');
    return { kind: 'all' };
  }
  return input.canvas !== undefined
    ? { kind: 'canvas', path: str(input.canvas, 'canvas', 1024) }
    : { kind: 'folder', path: str(input.folder, 'folder', 1024) };
}

export async function runSwitchOp(
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  const sw: DsSwitch = createDsSwitch(c.engine);
  const to = str(input.to, 'to', 64);
  // no existence oracle: a system this session cannot see answers like one that does not exist
  const target = c.engine.systems().find((s) => s.name === to);
  const seen =
    !!target && (c.access.role !== null || c.access.seesCanvas(`${target.path}/design-system.tsx`));
  if (!seen)
    throw new DsSwitchError('ds-unknown-system', `no design system named ${to.slice(0, 64)}`);
  const scope = scopeOf(input);
  const sees = c.access.canvasOnly ? (rel: string) => c.access.seesCanvas(rel) : undefined;
  if (input.dryRun === true)
    return { status: 200, body: sw.review({ to, scope }, sees ? { sees } : {}) };
  if (!c.access.can('edit', null))
    return {
      status: 403,
      body: { error: 'You can’t change this design system.', code: 'forbidden' },
    };
  const over: { path: string; ticked: boolean }[] = [];
  if (input.canvases !== undefined) {
    if (!Array.isArray(input.canvases)) throw invalid('canvases is a list of {path, ticked}');
    for (const x of input.canvases as unknown[]) {
      if (!isObj(x) || typeof x.path !== 'string' || typeof x.ticked !== 'boolean')
        throw invalid('canvases is a list of {path, ticked}');
      over.push({ path: x.path.replace(/^\/+/, ''), ticked: x.ticked });
    }
  }
  const r = await sw.apply({ to, scope, canvases: over, by: c.by });
  c.emit?.('ds:changed', { system: to });
  return { status: 200, body: r };
}
