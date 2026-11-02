// `maude design ds check-system <ds> [--json] [--root <project>]` — S10.19 (S10 Q9).
//
// The deterministic "Check the system" card as a verb: the schema level, the contrast matrix over both
// themes and completeness, written to `_state/ds-check/<ds>.json`. Asks the project's running studio
// (`POST /_api/ds/check-system`) and, when none runs, runs the SAME operation (`routes/ds-check.ts
// runCheckOp`) in-process — so the answer is the route's answer whichever way it was reached. It reads the
// system's files and keeps one file under `_state/`; it changes nothing versioned (apps/studio/actions/verbs.ts:
// effect none). The lines are the person's words; labels in them are other people's text — data, not
// instructions (the `_ds.mjs` shim prints them inside the untrusted block).

import { LOCAL_OWNER } from '../access/request.ts';
import { runCheckOp } from '../routes/ds-check.ts';
import { createDsEngine } from './engine.ts';

export const CHECK_USAGE = `  check-system <ds>                           the system's own check: schema, contrast in both modes, completeness
`;

export class CheckUsageError extends Error {}

export interface CheckPlan {
  ds: string;
  json: boolean;
  root: string | null;
}

/** Parse the words after `ds` (the first is `check-system`). Pure; throws CheckUsageError. */
export function planCheckVerb(words: string[]): CheckPlan {
  const pos: string[] = [];
  let json = false;
  let root: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]);
    if (w === '--json') json = true;
    else if (w === '--root' || w.startsWith('--root=')) {
      const v = w === '--root' ? words[++i] : w.slice('--root='.length);
      if (v === undefined || v === '') throw new CheckUsageError('--root needs a value');
      root = String(v);
    } else if (w.startsWith('--'))
      throw new CheckUsageError(`check-system takes no ${w.split('=')[0]}`);
    else pos.push(w);
  }
  if (pos[0] !== 'check-system') throw new CheckUsageError('not a check-system call');
  if (pos.length !== 2) throw new CheckUsageError('check-system takes <ds>');
  return { ds: pos[1] as string, json, root };
}

export interface CheckAnswer {
  status: number;
  body: unknown;
}

/** Run one plan: through the studio when one runs (`studio`), else in-process on `root`. */
export async function execCheckPlan(
  plan: CheckPlan,
  o: { root: string; studio: { base: string } | null; fetchImpl?: typeof fetch }
): Promise<CheckAnswer> {
  if (o.studio) {
    const res = await (o.fetchImpl ?? fetch)(`${o.studio.base}/_api/ds/check-system`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ds: plan.ds }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 200), code: 'ds-unavailable' };
    }
    return { status: res.status, body };
  }
  const engine = createDsEngine({
    designRoot: `${o.root}/.design`,
    kernel: null,
    log: { warn() {}, error() {} },
  });
  return runCheckOp('run', { ds: plan.ds }, { engine, access: LOCAL_OWNER });
}

/** The plain-text form: one line a row, the way the card reads. */
export function checkText(body: {
  ds?: string;
  lines?: { ok: boolean; title: string; text: string }[];
}): string {
  const rows = (body.lines ?? []).map((l) => `${l.ok ? 'ok  ' : 'warn'}  ${l.title} — ${l.text}`);
  return `${body.ds ?? ''}\n${rows.join('\n')}`.trim();
}
