// routes/handoff.ts — Handoff to production ⇧⌘H (S8.10; 09 Export · ex-handoff, ex-handoff-ready,
// ex-handoff-edges).
//
//   GET  /_api/handoff/targets?canvas=<rel>|?ds=<name>
//        200 { subject, targets:[{id, kind, title, sub, outRel, off}], review, connected }
//        Read of the canvas (seen) — Can comment sees it too, but only Can edit may start one.
//   POST /_api/handoff { canvas | ds, target, useDs }
//        202 { status:'running', runId, chatId, outRel, ready }          AI drafts it now
//        202 { status:'queued', intentId, gates, words, outRel, ready }  waits, starts by itself
//        409 { reason:'target-off' | 'no-target' }   403 forbidden        404 no canvas
//        Can edit on the canvas (a design system's tokens: on the project) — the table gate judges
//        `canvas` from the body, and the handler again. It writes code into the project.
//   GET  /_api/handoff/result?canvas=|ds=&target=
//        200 { exists, content, ready }  the file the run wrote (≤ 256 kB) for "Copy code".
//        Only ever the target's own computed path; Can edit, like the handoff itself.
//
// MAIN ORIGIN ONLY: the untrusted canvas iframe must never reach a route that starts an AI run or
// reads a file outside the design root (DDR-054). None of these is in CANVAS_SAFE_API.

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { type LastReview, lastReview } from '../handoff/blockers.ts';
import type { HandoffRequest, Handoffs } from '../handoff/run.ts';
import {
  type HandoffSubject,
  type HandoffTarget,
  hasAnimatedFrame,
  outPathFor,
  readyFacts,
  subjectName,
  targetsFromConfig,
} from '../handoff/targets.ts';
import { resolveCanvasRel } from './edit.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 8 * 1024;
const MAX_RESULT = 256 * 1024;
const DS_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TARGET_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The Lottie option's line when the canvas has nothing that moves (ex-handoff). */
export const NO_ANIMATED_FRAME = (name: string) =>
  `For motion — needs an animated frame; ${name} has none`;

export interface HandoffRouteDeps {
  designRoot: string;
  /** `.design` */
  designRel: string;
  repoRoot: string;
  access(req: Request): Access;
  /** a canvas the request names → designRoot-relative `.tsx` (default routes/edit.ts `resolveCanvasRel`) */
  resolveCanvas?(file: string): string | null;
  /** the canvas's source, or null */
  readCanvas(rel: string): string | null;
  /** the parsed `.design/config.json` (its `handoff.targets[]`) */
  config(): unknown;
  /** the design systems this project has (`system/<name>/`) */
  designSystems(): readonly string[];
  /** a canvas's design system, or null */
  dsOf(canvasRel: string): string | null;
  /** S8 Q12 — the cloud address of a registry item (`…/r/<name>.json`), or null (not linked / not served) */
  registryUrl(name: string): string | null;
  /** is a Claude account connected right now (the outbox's `ai-connected` fact) */
  aiConnected(): boolean;
  handoffs: Handoffs;
}

const canvasOf = (deps: HandoffRouteDeps, file: string) =>
  deps.resolveCanvas
    ? deps.resolveCanvas(file)
    : resolveCanvasRel(deps.designRoot, deps.designRel, file);

type Subject = HandoffSubject & { name: string; ds: string | null };

/** A request's subject, judged for `cap`. A Response is the refusal. */
function subjectOf(
  deps: HandoffRouteDeps,
  req: Request,
  src: { canvas?: unknown; ds?: unknown },
  cap: 'read' | 'edit'
): Subject | Response {
  const access = deps.access(req);
  if (typeof src.canvas === 'string' && src.canvas) {
    const canvas = canvasOf(deps, src.canvas);
    if (!canvas)
      return access.canvasOnly
        ? notInScopeResponse()
        : json(404, { ok: false, reason: 'no-canvas' });
    if (!access.seesCanvas(canvas)) return notInScopeResponse();
    if (!access.can(cap, canvas)) return json(403, { ok: false, reason: 'forbidden' });
    return { canvas, ds: deps.dsOf(canvas), name: subjectName({ canvas }) };
  }
  if (typeof src.ds === 'string' && DS_RE.test(src.ds)) {
    // a design system is the project's: a canvas-only session never names one
    if (access.canvasOnly) return notInScopeResponse();
    if (!access.can(cap, null)) return json(403, { ok: false, reason: 'forbidden' });
    if (!deps.designSystems().includes(src.ds))
      return json(404, { ok: false, reason: 'no-system' });
    return { canvas: null, ds: src.ds, name: src.ds };
  }
  return json(400, { ok: false, reason: 'no-subject' });
}

interface TargetRow extends HandoffTarget {
  outRel: string | null;
  /** why it cannot be picked, in words; null = it can */
  off: string | null;
}

function targetRows(deps: HandoffRouteDeps, subject: Subject): TargetRow[] {
  const source = subject.canvas ? (deps.readCanvas(subject.canvas) ?? '') : '';
  return targetsFromConfig(deps.config(), deps.designRel)
    .filter((t) => (subject.canvas ? true : t.kind === 'tokens'))
    .map((t) => {
      const outRel = outPathFor(t, { canvas: subject.canvas, ds: subject.ds }, deps.designRel);
      let off: string | null = null;
      if (t.kind === 'lottie' && subject.canvas && !hasAnimatedFrame(source))
        off = NO_ANIMATED_FRAME(subject.name);
      else if (t.kind === 'tokens' && !subject.ds) off = 'Needs a design system';
      else if (!outRel) off = 'Its file path in the settings is not one this project can write';
      return { ...t, outRel, off };
    });
}

function readyOf(deps: HandoffRouteDeps, t: HandoffTarget, s: Subject, outRel: string) {
  const name =
    (s.canvas ?? s.ds ?? '')
      .split('/')
      .pop()
      ?.replace(/\.tsx$/, '') ?? '';
  return readyFacts(t, s, {
    designRel: deps.designRel,
    repoRoot: deps.repoRoot,
    outRel,
    registryUrl: t.kind === 'web' ? deps.registryUrl(name) : null,
  });
}

function reviewOf(deps: HandoffRouteDeps, s: Subject): LastReview {
  return s.canvas
    ? lastReview(deps.designRoot, `${deps.designRel}/${s.canvas}`)
    : { reviewed: false, at: null, blockers: [] };
}

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* below */
  }
  return json(400, { ok: false, reason: 'bad-json' });
}

/** The request a body (or a queued intent's payload) stands for, or the reason it cannot be made. */
export function handoffRequestOf(
  deps: HandoffRouteDeps,
  s: Subject,
  targetId: string,
  useDs: boolean
): HandoffRequest | { reason: 'no-target' | 'target-off'; words?: string } {
  const row = targetRows(deps, s).find((t) => t.id === targetId);
  if (!row) return { reason: 'no-target' };
  if (row.off || !row.outRel) return { reason: 'target-off', words: row.off ?? undefined };
  const { outRel, off: _off, ...target } = row;
  return {
    canvas: s.canvas ?? null,
    ds: s.ds,
    target,
    outRel,
    useDs: s.ds ? useDs : false,
    blockers: reviewOf(deps, s).blockers,
    name: s.name,
  };
}

/** The outbox's `resolve`: a queued intent's payload → the request, read again now (null = gone). */
export function resolveQueuedHandoff(
  deps: HandoffRouteDeps,
  payload: { canvas: string; target: string; ds?: string; useDs?: boolean }
): HandoffRequest | null {
  let s: Subject | null = null;
  if (payload.canvas.startsWith('system/') && payload.ds) {
    if (deps.designSystems().includes(payload.ds))
      s = { canvas: null, ds: payload.ds, name: payload.ds };
  } else {
    const canvas = canvasOf(deps, payload.canvas);
    if (canvas) s = { canvas, ds: deps.dsOf(canvas), name: subjectName({ canvas }) };
  }
  if (!s) return null;
  const r = handoffRequestOf(deps, s, payload.target, payload.useDs !== false);
  return 'reason' in r ? null : r;
}

export function createHandoffRoutes(deps: HandoffRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/handoff/targets',
      origin: 'main',
      readOnly: 'allowed',
      handle(req) {
        const u = new URL(req.url);
        const s = subjectOf(
          deps,
          req,
          { canvas: u.searchParams.get('canvas'), ds: u.searchParams.get('ds') },
          'read'
        );
        if (s instanceof Response) return s;
        const access = deps.access(req);
        return json(200, {
          subject: { name: s.name, canvas: s.canvas, ds: s.ds },
          targets: targetRows(deps, s),
          review: reviewOf(deps, s),
          connected: deps.aiConnected(),
          canEdit: access.can('edit', s.canvas ?? null),
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/handoff',
      origin: 'main',
      readOnly: 'refused',
      async handle(req) {
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const s = subjectOf(deps, req, b, 'edit');
        if (s instanceof Response) return s;
        const targetId = typeof b.target === 'string' && TARGET_RE.test(b.target) ? b.target : '';
        const r = handoffRequestOf(deps, s, targetId, b.useDs !== false);
        if ('reason' in r)
          return json(409, { ok: false, reason: r.reason, words: r.words ?? null });
        const started = await deps.handoffs.start(r);
        if (started.status === 'refused')
          return json(503, { ok: false, reason: 'not-kept', words: started.words });
        return json(202, {
          ok: true,
          ...started,
          outRel: r.outRel,
          ready: readyOf(deps, r.target, s, r.outRel),
        });
      },
    },
    {
      method: 'GET',
      path: '/_api/handoff/result',
      origin: 'main',
      readOnly: 'allowed',
      handle(req) {
        const u = new URL(req.url);
        const s = subjectOf(
          deps,
          req,
          { canvas: u.searchParams.get('canvas'), ds: u.searchParams.get('ds') },
          'edit'
        );
        if (s instanceof Response) return s;
        const r = handoffRequestOf(deps, s, u.searchParams.get('target') ?? '', true);
        if ('reason' in r) return json(409, { ok: false, reason: r.reason });
        let content: string | null = null;
        try {
          // the target's own path, and only while it really is a file in this project: a symlink
          // planted at the target (a clone, a peer) never reads something outside the repo
          const abs = path.join(deps.repoRoot, r.outRel);
          const real = realpathSync(abs);
          const root = realpathSync(deps.repoRoot);
          const st = statSync(real);
          if (
            !lstatSync(abs).isSymbolicLink() &&
            real.startsWith(`${root}${path.sep}`) &&
            st.isFile() &&
            st.size <= MAX_RESULT
          )
            content = readFileSync(real, 'utf8');
        } catch {
          /* not written yet */
        }
        return json(200, {
          exists: content !== null,
          content,
          outRel: r.outRel,
          ready: readyOf(deps, r.target, s, r.outRel),
        });
      },
    },
  ];
}
