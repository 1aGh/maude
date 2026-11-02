// routes/ds-edges.ts — the edges of the Design system canvas over `/_api/ds/{fix-contrast,add-colour,nearest,off-system}`
// (S10.17; engine ds/edges.ts). Kept out of routes/ds.ts so that file's hunk stays a few lines: `runDsOp` resolves the
// system (the same "no such system" for one this session cannot see) and hands the op here; the verb and the route
// end up in this one function.
//
// Permissions (S10 Q15, rule 12 — whatever the UI hides, the server refuses):
//   nearest, off-system, fix-contrast --dry-run   anyone who can see the system / the canvas (reads)
//   fix-contrast, add-colour                      Can edit on the DS canvas (they are waiting edits, like `pending`)
//   the trash itself                              routes/ds.ts `trash` (Can edit on the whole project)

import { createDsEdges, DsEdgeError, EDGE_FORMAT } from '../ds/edges.ts';
import type { DsOpAnswer, DsOpContext } from './ds.ts';

const invalid = (m: string) => new DsEdgeError('ds-edge-invalid', m);
const str = (v: unknown, what: string, max = 512): string => {
  if (typeof v !== 'string' || !v || v.length > max) throw invalid(`${what} is a non-empty string`);
  return v;
};
const forbidden = (): DsOpAnswer => ({
  status: 403,
  body: { error: 'You can’t change this design system.', code: 'forbidden' },
});

/** The system's Design system canvas, the object `pending`-class writes are judged against. */
const dsCanvasOf = (c: DsOpContext, ds: string): string | null => {
  const s = c.engine.systems().find((x) => x.name === ds);
  return s ? `${s.path}/design-system.tsx` : null;
};

export type EdgeOp = 'fix-contrast' | 'add-colour' | 'nearest' | 'off-system';

const written = (r: { action: string; rev: string | null; actionId: string | null }) => ({
  action: r.action,
  rev: r.rev,
  actionId: r.actionId,
});

/** `ds` is already resolved by `runDsOp` (null for `off-system`, which names a canvas, not a system). */
export async function runEdgeOp(
  op: EdgeOp,
  ds: string | null,
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  const edges = createDsEdges(c.engine);
  const emit = (system: string) => {
    c.outside?.invalidate(system);
    c.emit?.('ds:changed', { system });
  };
  switch (op) {
    case 'nearest': {
      const system = ds as string;
      const css = input.css === undefined ? null : str(input.css, 'css', 130);
      const value = input.value === undefined ? null : str(input.value, 'value', 240);
      if ((css === null) === (value === null)) throw invalid('name one of css or value');
      if (value !== null) return { status: 200, body: edges.suggestFor(system, value) };
      let used: number | null = null;
      if (c.usage) {
        const q = c.usage.query(system, { css: css as string });
        used = (
          c.access.canvasOnly ? q.canvases.filter((x) => c.access.seesCanvas(x.rel)) : q.canvases
        ).length;
      }
      return { status: 200, body: edges.replacementFor(system, css as string, used) };
    }
    case 'off-system': {
      const canvas = str(input.canvas, 'canvas', 1024)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/^\.design\//, '');
      if (canvas.split('/').some((s) => s === '..' || s === '.' || s === ''))
        throw invalid('canvas is a design-root-relative .tsx path');
      if (c.access.canvasOnly && !c.access.seesCanvas(canvas))
        throw new DsEdgeError('ds-not-in-system', 'no such canvas');
      return { status: 200, body: edges.offSystem(canvas) };
    }
    case 'fix-contrast': {
      const system = ds as string;
      const css = str(input.css, 'css', 130);
      const theme = input.theme === undefined ? undefined : str(input.theme, 'theme', 40);
      if (input.dryRun === true) {
        const plan = edges.planFix(system, css, theme);
        return {
          status: 200,
          body: {
            format: EDGE_FORMAT,
            v: 1,
            edge: 'fix-contrast',
            css,
            label: plan.label,
            fixes: plan.fixes,
          },
        };
      }
      if (!c.access.can('edit', dsCanvasOf(c, system))) return forbidden();
      const r = await edges.fixContrast({ ds: system, css, ...(theme ? { theme } : {}), by: c.by });
      emit(system);
      return {
        status: 200,
        body: {
          format: EDGE_FORMAT,
          v: 1,
          edge: 'fix-contrast',
          css,
          label: r.label,
          fixes: r.fixes,
          ...written(r.result),
        },
      };
    }
    case 'add-colour': {
      const system = ds as string;
      if (!c.access.can('edit', dsCanvasOf(c, system))) return forbidden();
      const r = await edges.addColour({
        ds: system,
        value: str(input.value, 'value', 240),
        ...(input.label !== undefined ? { label: str(input.label, 'label', 64) } : {}),
        ...(input.css !== undefined ? { css: str(input.css, 'css', 130) } : {}),
        by: c.by,
      });
      emit(system);
      return {
        status: 200,
        body: {
          format: EDGE_FORMAT,
          v: 1,
          edge: 'add-colour',
          css: r.css,
          label: r.label,
          value: r.value,
          ...written(r.result),
        },
      };
    }
  }
}
