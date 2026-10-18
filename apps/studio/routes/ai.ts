// routes/ai.ts — the AI run registry over HTTP (V2-1.15 §5.4), main origin only, plus the v1
// `/_api/ai` banner routes implemented on the same registry.
//
//   GET  /_api/ai/runs                   {seq, mine, others, needsYou, live, diagnostics}
//   POST /_api/ai/runs/:id/stop          Stop (V2-1.5 `stopped`)
//   POST /_api/ai/runs/:id/cancel        remove a waiting ask (no turn ran)
//   POST /_api/ai/runs/:id/keep-going    a new ask `resumeOf` (it waits if the artboard is busy)
//   POST /_api/ai/runs/:id/copy          Run on a copy (§5.7): duplicate the ACCEPTED artboard
//                                        beside it, re-scope the waiting ask to it, start it
//   POST /_api/ai/runs/stop-all          {reason: quit | close-tab} → {stopped, published} ≤ 5 s
//   GET  /_api/ai                        v1 banner entries, DERIVED from the registry (canvas-safe)
//   POST /_api/ai/start|heartbeat|end    v1 `/design:edit`: begin (origin design-edit) / renew / end
//
// `mine` is YOUR runs on this Mac (RunView: never the queued prompt); `others` is RunPublic, which
// never carries prompt, question or doing.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isLive, type RunRecord } from '../ai/run-lifecycle.ts';
import type { RunRegistry } from '../ai/runs.ts';
import { CanvasEditError, copyArtboard } from '../canvas-edit.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import type { RouteSpec } from './table.ts';

export interface AiRouteDeps {
  registry: RunRegistry;
  repoRoot: string;
  /** `.design` */
  designRel: string;
  /** the ACP chat's own banner entries until S5.6 moves the chat onto the registry */
  legacyEntries?: () => Array<{
    file: string;
    author: string;
    startedAt: number;
    lastHeartbeat: number;
  }>;
  /** T16: a v1 edit is ONE project action (sync runtime `beginAiAction` / `endAiAction`) */
  beginAction?: (key: string, name: string) => void;
  endAction?: (key: string, outcome: 'done' | 'failed') => Promise<unknown> | undefined;
  /** `_active.json`'s selected artboard of a canvas, else null (lazy) — injectable for tests */
  selectedArtboard?: (canvasRel: string) => string | null;
  /**
   * S5.11b — the sync runtime, for Run on a copy: the canvas's ACCEPTED source (a staged run's
   * base; null = the disk is accepted) and the waiting run's stage, so the copy is that run's
   * action (one run, one action — Undo of the run removes the copy) and never the busy run's.
   */
  control?: () => {
    acceptedCanvas?(repoRel: string): string | null;
    beginAiAction?(key: string, label: string, meta?: { runId?: string; chatId?: string }): void;
    claimAiWrite?(key: string, repoRel: string, hash?: string | null): void;
  } | null;
  /** the canvas write behind Run on a copy — injectable for the race tests */
  copyOnDisk?: typeof copyArtboard;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = (await req.json()) as unknown;
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const CANVAS_RE = /\.(?:tsx|jsx)$/;

export function createAiRoutes(deps: AiRouteDeps): RouteSpec[] {
  const reg = deps.registry;
  const designRoot = () => path.join(deps.repoRoot, deps.designRel);

  /** v1 `file` (`.design/x.tsx`) → the designRoot-relative canvas, or null when outside it. */
  function canvasOf(file: string): string | null {
    const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const prefix = `${deps.designRel.replace(/\/+$/, '')}/`;
    const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return null;
    return rel;
  }

  function selectedArtboard(canvasRel: string): string | null {
    if (deps.selectedArtboard) return deps.selectedArtboard(canvasRel);
    try {
      const file = path.join(designRoot(), '_active.json');
      if (!existsSync(file)) return null;
      const a = JSON.parse(readFileSync(file, 'utf8')) as { selected?: unknown };
      const sel = Array.isArray(a.selected) ? a.selected[0] : a.selected;
      const s = sel as { file?: unknown; artboard?: unknown } | null;
      if (!s || typeof s.artboard !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.artboard))
        return null;
      const onCanvas = typeof s.file !== 'string' || canvasOf(s.file) === canvasRel;
      return onCanvas ? s.artboard : null;
    } catch {
      return null;
    }
  }

  /** The live v1 edit on a file: a design-edit run whose scope is that canvas. */
  const v1Run = (canvas: string): RunRecord | null =>
    reg.live().find((r) => r.origin === 'design-edit' && r.scope?.canvas === canvas) ?? null;

  const entryOf = (r: RunRecord, file: string) => ({
    file,
    author: r.agent ?? 'Claude',
    startedAt: r.startedAt ?? r.createdAt,
    lastHeartbeat: r.hookAt ?? r.createdAt,
  });

  // `path` is spelled out per call: the writer-registry and hub-manifest scrapers read literal
  // `path: '…'` strings in routes/*.ts, and a template would be a route nobody classified.
  const runAction = (
    verb: 'stop' | 'cancel' | 'keep-going',
    p: { path: string },
    fn: (id: string) => Promise<RunRecord | null>
  ): RouteSpec => ({
    method: 'POST',
    path: p.path,
    origin: 'main',
    readOnly: 'refused',
    async handle(_req, params) {
      const id = params.id ?? '';
      if (!reg.isRunId(id)) return json(400, { error: 'id is a run id', code: 'invalid' });
      const before = reg.get(id);
      if (!before) return json(404, { error: 'no such run', code: 'not-found' });
      const out = await fn(id);
      if (!out) return json(409, { error: `cannot ${verb} this run now`, code: 'state' });
      return json(200, { run: reg.view().mine.find((m) => m.runId === out.runId) ?? null });
    },
  });

  // ── S5.11b — Run on a copy (V2-1.15 §5.7) ─────────────────────────────────────────────────
  // One copy per ask: the copy id is derived from the ask, a retry of a copied ask answers the
  // same copy, and two concurrent calls share one attempt. The race with the holder finishing
  // first is decided by `copyReserve` (synchronous): before it, a grant wins (409, no copy is
  // written); after it, the copy wins and the old ticket leaves the line.
  type Answer = { status: number; body: Record<string, unknown> };
  const copying = new Map<string, Promise<Answer>>();

  /**
   * The stage the waiting run's own turn writes into. A chat run's stage IS the run (V2-1.5 §5.5:
   * the tracker begins `acp:<chat>` with `{runId}` and the registry ends it — published with the
   * run whether or not the turn edits); a v1 `/design:edit` keeps its `edit:<file>` key.
   */
  const stageOf = (
    r: RunRecord
  ): { key: string; meta: { runId?: string; chatId?: string } } | null =>
    r.origin === 'maude-chat'
      ? { key: r.runId, meta: { runId: r.runId, ...(r.chatId ? { chatId: r.chatId } : {}) } }
      : r.origin === 'design-edit' && r.scope
        ? { key: `edit:${path.posix.join(deps.designRel, r.scope.canvas)}`, meta: {} }
        : null;

  const copyIdFor = (r: RunRecord, artboard: string) =>
    `${artboard.slice(0, 48)}-copy-${r.askId
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(-6)
      .toLowerCase()}`;

  const copied = (r: RunRecord): Answer => ({
    status: 200,
    body: {
      run: reg.view().mine.find((m) => m.runId === r.runId) ?? null,
      copy: {
        canvas: r.scope?.canvas ?? null,
        artboard: r.scope && r.scope.artboards !== '*' ? (r.scope.artboards[0] ?? null) : null,
        of: r.copyOf?.artboard ?? null,
      },
    },
  });
  const refuse = (status: number, code: string, error: string): Answer => ({
    status,
    body: { error, code },
  });

  async function runOnCopy(id: string): Promise<Answer> {
    const rec = reg.get(id);
    if (!rec) return refuse(404, 'not-found', 'no such run');
    if (rec.copyOf) return copied(rec);
    if (!isLive(rec) || rec.state !== 'waiting' || rec.behind)
      return refuse(409, 'state', 'this ask is not waiting for an artboard');
    const canvas = rec.scope?.canvas ?? '';
    const at = rec.waiting.length === 1 ? rec.waiting[0] : undefined;
    if (!at || !CANVAS_RE.test(canvas) || canvasOf(canvas) !== canvas)
      return refuse(409, 'one-artboard', 'a copy is made of the one artboard this ask waits for');
    const copyId = copyIdFor(rec, at.artboard);
    const was = rec;
    if (!reg.copyReserve(id, copyId))
      return refuse(409, 'state', 'this ask is not waiting for an artboard');
    const repoRel = path.posix.join(deps.designRel, canvas);
    const control = deps.control?.() ?? null;
    const stage = stageOf(was);
    try {
      await (deps.copyOnDisk ?? copyArtboard)(
        path.join(designRoot(), canvas),
        at.artboard,
        { id: copyId },
        {
          accepted: control?.acceptedCanvas?.(repoRel) ?? null,
          // the copy is the WAITING run's write: claimed for its stage before it lands
          beforeWrite: (next) => {
            if (!stage || !control) return;
            control.beginAiAction?.(stage.key, `Claude: ${was.label}`, stage.meta);
            control.claimAiWrite?.(stage.key, repoRel, hashBytes(next));
          },
        }
      );
    } catch (err) {
      await reg.copyAbort(id, was);
      return refuse(
        err instanceof CanvasEditError ? 409 : 500,
        'copy-failed',
        err instanceof Error ? err.message : 'could not make the copy'
      );
    }
    const out = (await reg.copyStart(id, was)) ?? reg.get(id);
    return out ? copied(out) : refuse(404, 'not-found', 'no such run');
  }

  return [
    {
      method: 'GET',
      path: '/_api/ai/runs',
      origin: 'main',
      readOnly: 'allowed',
      handle: () => json(200, { ...reg.view(), diagnostics: reg.diagnostics() }),
    },
    {
      method: 'POST',
      path: '/_api/ai/runs/stop-all',
      origin: 'main',
      // quitting must work in a view-only session too: it only ever stops
      readOnly: 'allowed',
      async handle(req) {
        const b = await body(req);
        const reason = b?.reason;
        if (reason !== 'quit' && reason !== 'close-tab')
          return json(400, { error: 'reason is quit | close-tab', code: 'invalid' });
        return json(200, await reg.stopAll(reason));
      },
    },
    runAction('stop', { path: '/_api/ai/runs/:id/stop' }, (id) => reg.stop(id, 'you')),
    runAction('cancel', { path: '/_api/ai/runs/:id/cancel' }, (id) => reg.cancel(id)),
    runAction('keep-going', { path: '/_api/ai/runs/:id/keep-going' }, (id) => reg.keepGoing(id)),
    {
      method: 'POST',
      path: '/_api/ai/runs/:id/copy',
      origin: 'main',
      readOnly: 'refused',
      async handle(_req, params) {
        const id = params.id ?? '';
        if (!reg.isRunId(id)) return json(400, { error: 'id is a run id', code: 'invalid' });
        let p = copying.get(id);
        if (!p) {
          p = runOnCopy(id).finally(() => copying.delete(id));
          copying.set(id, p);
        }
        const a = await p;
        return json(a.status, a.body);
      },
    },

    // ── v1 (Phase 8 Task 4): `/design:edit` curls these; the banner is derived ──────────────
    {
      method: 'GET',
      path: '/_api/ai',
      origin: 'canvas',
      readOnly: 'allowed',
      handle() {
        const derived = reg.bannerEntries();
        const files = new Set(derived.map((e) => e.file));
        const legacy = (deps.legacyEntries?.() ?? []).filter((e) => !files.has(e.file));
        return json(200, { entries: [...derived, ...legacy] });
      },
    },
    {
      method: 'POST',
      path: '/_api/ai/start',
      origin: 'main',
      readOnly: 'refused',
      async handle(req) {
        const b = await body(req);
        const file = typeof b?.file === 'string' ? b.file.trim() : '';
        if (!file) return new Response('body.file required', { status: 400 });
        const canvas = canvasOf(file);
        if (!canvas || !CANVAS_RE.test(canvas))
          return new Response('body.file is a canvas in the design root', { status: 400 });
        const author =
          typeof b?.author === 'string' && b.author.trim()
            ? b.author.trim().slice(0, 120)
            : 'Claude';
        const name = canvas.split('/').pop()?.replace(CANVAS_RE, '') ?? 'canvas';
        let run = v1Run(canvas);
        if (!run) {
          const artboard = selectedArtboard(canvas);
          run = await reg.ask({
            origin: 'design-edit',
            label: `${author} edited ${name}`,
            scope: { canvas, artboards: artboard ? [artboard] : '*' },
            agent: author,
            ...(artboard ? {} : { lazy: true }),
          });
          deps.beginAction?.(`edit:${file}`, `${author} edited ${name}`);
        } else {
          run = reg.hookEvent(run.runId, {}) ?? run;
        }
        return json(200, entryOf(run, path.posix.join(deps.designRel, canvas)));
      },
    },
    {
      method: 'POST',
      path: '/_api/ai/heartbeat',
      origin: 'main',
      readOnly: 'refused',
      async handle(req) {
        const b = await body(req);
        const file = typeof b?.file === 'string' ? b.file.trim() : '';
        if (!file) return new Response('body.file required', { status: 400 });
        const canvas = canvasOf(file);
        const run = canvas ? v1Run(canvas) : null;
        if (!run || !canvas) return new Response('no active entry', { status: 404 });
        const next = reg.hookEvent(run.runId, {}) ?? run;
        void reg.renewNow().catch(() => null);
        return json(200, entryOf(next, path.posix.join(deps.designRel, canvas)));
      },
    },
    {
      method: 'POST',
      path: '/_api/ai/end',
      origin: 'main',
      readOnly: 'refused',
      async handle(req) {
        const b = await body(req);
        const file = typeof b?.file === 'string' ? b.file.trim() : '';
        if (!file) return new Response('body.file required', { status: 400 });
        const failed = b?.outcome === 'failed';
        // T16 — close the action BEFORE the run clears: `done` publishes, `failed` holds
        const action = await Promise.resolve(
          deps.endAction?.(`edit:${file}`, failed ? 'failed' : 'done')
        ).catch(() => null);
        const canvas = canvasOf(file);
        const run = canvas ? v1Run(canvas) : null;
        const cleared = !!run && isLive(run) && !!reg.endNow(run.runId, failed ? 'failed' : 'done');
        return json(cleared ? 200 : 404, { cleared, ...(action ? { action } : {}) });
      },
    },
  ];
}
