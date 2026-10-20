// /_api/describe — search in pictures (S8.20; 12 · ia-assets-find, 05 · es-search-more; contract V2-1.17 §5.9).
//
//   GET  /_api/describe[?q=words]
//        200 { ok, status, hits?, untrusted?, notice? }
//            status  describe/batch.ts DescribeStatus: consent (asked · on · since · dailyCap · stopped), ai, total, done,
//                    running, paused (off | stopped | no-ai | offline | used-up | daily-cap | null), until
//            hits    with `q` and consent on: the pictures a word was found in ONLY by what AI saw — { rel, caption,
//                    tags, text, marks, close }. Validated words, and marked `untrusted` (the DDR-130 guard): a model's
//                    words, data and never instructions, wherever they go next.
//   POST /_api/describe/consent  { on: boolean }    the person's answer to "Describe the pictures in <project>?"
//   POST /_api/describe/stop     { stopped: boolean }  Stop / Resume in "Describing 12 of 193 pictures"
//        200 { ok: true, status }
//
// MAIN ORIGIN ONLY, never canvas-safe: a canvas can neither read what AI saw nor turn describing on. A project session on
// THIS Mac only — the answer spends the person's own Claude account on their own Mac (A5: no AI on a server), so a cell
// refuses all three (`not-on-mac`), and a canvas-only guest is refused (`project-only`): what pictures a project holds
// is a project-level read. A viewer may answer for themselves (consent and descriptions are per person, per Mac, never
// synced). Every write is a human answer (registry `assets.describe` / `assets.describe-stop`, human reason `consent`):
// the agent path does not exist on purpose — an agent cannot say yes for the person whose account it spends.

import type { Access } from '../access/scope.ts';
import type { DescribeService } from '../describe/batch.ts';
import { DESCRIBE_UNTRUSTED_NOTICE } from '../describe/validate.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 1024;
const Q_MAX = 200;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface DescribeRouteDeps {
  /** the project's describe service (null = none built: answers 503) */
  service: () => DescribeService | null;
  access: (req: Request) => Access;
  /** this studio runs in a workspace cell: no Mac, no account, no describing */
  inCell?: boolean;
}

function refusal(deps: DescribeRouteDeps, req: Request): Response | null {
  if (deps.inCell) return json(409, { ok: false, reason: 'not-on-mac' });
  const a = deps.access(req);
  if (a.role === null) return json(403, { ok: false, reason: 'project-only' });
  return null;
}

async function boolBody(req: Request, key: string): Promise<boolean | Response> {
  if (Number(req.headers.get('content-length')) > MAX_BODY)
    return json(413, { ok: false, reason: 'too-large' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) ?? {};
  } catch {
    return json(400, { ok: false, reason: 'bad-json' });
  }
  const v = body?.[key];
  if (typeof v !== 'boolean') return json(400, { ok: false, reason: `bad-${key}` });
  return v;
}

export function createDescribeRoutes(deps: DescribeRouteDeps): RouteSpec[] {
  const svcOr503 = () => deps.service() ?? null;
  return [
    {
      method: 'GET',
      path: '/_api/describe',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const no = refusal(deps, req);
        if (no) return no;
        const svc = svcOr503();
        if (!svc) return json(503, { ok: false, reason: 'describe-unavailable' });
        const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, Q_MAX).trim();
        const status = svc.status();
        if (!q) return json(200, { ok: true, status });
        const hits = svc.search(q);
        return json(200, {
          ok: true,
          status,
          hits,
          ...(hits.length ? { untrusted: true, notice: DESCRIBE_UNTRUSTED_NOTICE } : {}),
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/describe/consent',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const no = refusal(deps, req);
        if (no) return no;
        const svc = svcOr503();
        if (!svc) return json(503, { ok: false, reason: 'describe-unavailable' });
        const on = await boolBody(req, 'on');
        if (on instanceof Response) return on;
        return json(200, { ok: true, status: svc.setConsent(on) });
      },
    },
    {
      method: 'POST',
      path: '/_api/describe/stop',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const no = refusal(deps, req);
        if (no) return no;
        const svc = svcOr503();
        if (!svc) return json(503, { ok: false, reason: 'describe-unavailable' });
        const stopped = await boolBody(req, 'stopped');
        if (stopped instanceof Response) return stopped;
        if (!svc.status().consent.on) return json(409, { ok: false, reason: 'not-on' });
        return json(200, { ok: true, status: svc.setStopped(stopped) });
      },
    },
  ];
}
