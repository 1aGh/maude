// T-S4.5b — run binding for annotation ops (contract S4-S5-ai-annotations §2).
//
// 1. The verb: inside a chat (`MAUDE_CHAT_ID`) `bin/_annotate-post.mjs` tags its batch with that
//    chat's live run (`run:<runId>`); without one, today's `ai-annotate-*`.
// 2. The gate (a real studio): a `run:` tag is accepted ONLY on the main origin and ONLY while that
//    run is open. The canvas listener, a cross-origin post to the main port, a closed run and an
//    unknown run are all refused — and nothing is written.
// 3. The stage: an accepted tagged batch is claimed into ITS run by content hash (two runs open)
//    and published with the run as one `ai` action carrying the run's chat — the action "Undo this
//    chat" reverts. The end-to-end undo on a real hub is in sync-accepted-runtime.test.ts.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { runTagGate, stageRunAnnotations } from '../annotations/run-tag.ts';
import { defaultActionId, postOps, runIdForChat } from '../bin/_annotate-post.mjs';
import { createActionStage, type StageProposal } from '../sync/action-stage.ts';
import { laneValueFromFile } from '../sync/codec.ts';
import type { LaneProposal } from '../sync/projection.ts';
import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { board, elements, sticky } from './fixtures/annotations-v2/boards.ts';

/* ------------------------------------------------------------------ 1. the verb */

describe('the annotate verb names its chat’s run', () => {
  const view = {
    mine: [
      { runId: 'r_ended01', chatId: 'chat-a', state: 'done' },
      { runId: 'r_queue01', chatId: 'chat-a', state: 'waiting', behind: 'r_live0001' },
      { runId: 'r_live0001', chatId: 'chat-a', state: 'running' },
      { runId: 'r_other001', chatId: 'chat-b', state: 'running' },
    ],
    others: [{ runId: 'r_member01', state: 'running' }],
  };

  test('the chat’s own live run, never an ended, queued, other chat’s or member’s run', () => {
    expect(runIdForChat(view, 'chat-a')).toBe('r_live0001');
    expect(runIdForChat(view, 'chat-b')).toBe('r_other001');
    expect(runIdForChat(view, 'chat-c')).toBeNull();
    expect(runIdForChat({ mine: [view.mine[0]] }, 'chat-a')).toBeNull();
    expect(runIdForChat(view, 'bad chat id')).toBeNull();
    expect(runIdForChat(view, undefined)).toBeNull();
  });

  let studio: ReturnType<typeof Bun.serve>;
  let designRoot: string;
  const posted: Array<{ actionId?: string }> = [];
  let runsAsked = 0;
  beforeAll(() => {
    designRoot = mkdtempSync(join(tmpdir(), 'run-binding-verb-'));
    studio = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === '/_api/ai/runs') {
          runsAsked += 1;
          return Response.json({ seq: 1, mine: view.mine, others: view.others });
        }
        if (u.pathname === '/_api/annotations/ops') {
          posted.push((await req.json()) as { actionId?: string });
          return Response.json({ ok: true, changed: true, rejected: [] });
        }
        return new Response('nope', { status: 404 });
      },
    });
    writeFileSync(
      join(designRoot, '_server.json'),
      JSON.stringify({ url: `http://127.0.0.1:${studio.port}` })
    );
  });
  afterAll(() => {
    studio.stop(true);
    rmSync(designRoot, { recursive: true, force: true });
  });

  test('inside a chat with a running run the batch is tagged run:<runId>', async () => {
    const prev = process.env.MAUDE_CHAT_ID;
    process.env.MAUDE_CHAT_ID = 'chat-a';
    try {
      await postOps(designRoot, '.design/ui/x.tsx', []);
    } finally {
      if (prev === undefined) delete process.env.MAUDE_CHAT_ID;
      else process.env.MAUDE_CHAT_ID = prev;
    }
    expect(posted.at(-1)?.actionId).toBe('run:r_live0001');
  });

  test('without a chat, or a chat with no live run, it is today’s ai-annotate-*', async () => {
    const base = `http://127.0.0.1:${studio.port}`;
    const asked = runsAsked;
    expect(await defaultActionId(base, {})).toMatch(/^ai-annotate-[a-z0-9]+$/);
    expect(runsAsked).toBe(asked); // no chat → the runs are not even read
    expect(await defaultActionId(base, { MAUDE_CHAT_ID: 'chat-c' })).toMatch(/^ai-annotate-/);
    // A studio that does not answer the runs read is "not inside a run".
    expect(await defaultActionId('http://127.0.0.1:9', { MAUDE_CHAT_ID: 'chat-a' })).toMatch(
      /^ai-annotate-/
    );
    // An explicit id (figjam import) is kept as is.
    await postOps(designRoot, '.design/ui/x.tsx', [], 'figjam-import-1');
    expect(posted.at(-1)?.actionId).toBe('figjam-import-1');
  });
});

/* ------------------------------------------------------------------ 2. the gate */

describe('a run tag is main-origin only, and only while the run is open', () => {
  let proc: Subprocess;
  let port: number;
  let designRoot: string;
  let canvasOrigin: string;
  const file = '.design/ui/RunTag.tsx';
  let written: string;
  beforeAll(async () => {
    const sb = makeSandbox();
    designRoot = sb.designRoot;
    writeFileSync(join(designRoot, 'ui', 'RunTag.tsx'), 'export default () => null;\n');
    written = join(designRoot, 'ui-runtag.annotations.json');
    port = nextPort();
    proc = await bootServer(sb.root, port, { MAUDE_NO_AUTOBUILD: '1' });
    canvasOrigin = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')).canvasOrigin;
  });
  afterAll(async () => {
    await killProc(proc);
  });

  const main = () => `http://localhost:${port}`;
  const ops = (
    base: string,
    actionId: unknown,
    id: string,
    headers: Record<string, string> = {},
    fc: string | null = null
  ) =>
    fetch(fc ? withFc(`${base}/_api/annotations/ops`, fc) : `${base}/_api/annotations/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        file,
        actionId,
        ops: [{ op: 'put', el: elements(sticky(id, `by ${id}`))[0] }],
      }),
    });
  const boardText = () => (existsSync(written) ? readFileSync(written, 'utf8') : null);
  const hook = async (path: string, body: Record<string, unknown>) =>
    (await (
      await fetch(`${main()}/_api/agent/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json()) as { run?: string; state?: string };

  test('refused from the canvas origin and cross-origin to the main port; accepted while open; refused once closed', async () => {
    const begun = await hook('run/begin', {
      session: 'sess-runtag',
      actor: 'claude-code',
      label: 'Resolve stickies',
    });
    const runId = begun.run as string;
    expect(runId).toMatch(/^r_/);

    // gate-b-c4: every canvas-listener request answers as a frame narrowed to its canvas, so the canvas
    // posts below carry the frame capability the shell would append (`?fc=`). Without one the listener
    // answers 403 before the run-tag gate is reached (access/frame.ts frameRefusal).
    const fc = await frameCap({ base: main() }, {}, 'ui/RunTag.tsx');
    const canvasOps = (actionId: unknown, id: string) => ops(canvasOrigin, actionId, id, {}, fc);
    // The canvas listener: an OPEN run's tag is still refused, nothing written.
    const fromCanvas = await canvasOps(`run:${runId}`, 'c1');
    expect(fromCanvas.status).toBe(400);
    expect((await fromCanvas.json()).error).toBe('run-tag-main-origin-only');
    // A planted canvas posting straight to the main port carries its own Origin.
    const crossOrigin = await ops(main(), `run:${runId}`, 'c2', { Origin: canvasOrigin });
    expect(crossOrigin.status).toBe(400);
    expect((await crossOrigin.json()).error).toBe('run-tag-main-origin-only');
    expect(boardText()).toBeNull();
    // An untagged batch from the canvas origin still works (today's canvas write path).
    expect((await canvasOps('canvas-1', 'u1')).status).toBe(200);
    const afterCanvas = boardText();
    expect(afterCanvas).toContain('"u1"');

    // Unknown run → 409, nothing written.
    const unknown = await ops(main(), 'run:r_nosuchrun', 'x1');
    expect(unknown.status).toBe(409);
    expect((await unknown.json()).error).toBe('run-not-open');
    expect(boardText()).toBe(afterCanvas);

    // The open run, from the main origin → applied.
    const ok = await ops(main(), `run:${runId}`, 'k1');
    expect(ok.status).toBe(200);
    expect(boardText()).toContain('"k1"');
    const afterOpen = boardText();

    // The run ends → its tag is refused; never written "anyway" as a person's edit.
    await hook('run/end', { session: 'sess-runtag', outcome: 'done' });
    const closed = await ops(main(), `run:${runId}`, 'z1');
    expect(closed.status).toBe(409);
    expect((await closed.json()).error).toBe('run-not-open');
    expect(boardText()).toBe(afterOpen);

    // The whole-board PUT does not take a run tag at all.
    const put = await fetch(`${main()}/_api/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, board: board(sticky('p1', 'put')), writeId: `run:${runId}` }),
    });
    expect(put.status).toBe(400);
    expect(boardText()).toBe(afterOpen);
  }, 60_000);
});

describe('runTagGate (unit)', () => {
  test('a waiting run queued behind another of its chat is not open; same-origin is required', async () => {
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
    });
    const first = await reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'x', lazy: true });
    const queued = await reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'y', lazy: true });
    const runId = first.runId;
    expect(queued.behind).toBe(runId);
    const req = new Request('http://127.0.0.1:4399/_api/annotations/ops', { method: 'POST' });
    const yes = () => true;
    expect(runTagGate(req, 'act-1', { listener: 'canvas', runs: reg, sameOrigin: yes })).toEqual({
      runId: null,
    });
    expect(
      runTagGate(req, `run:${runId}`, { listener: 'main', runs: reg, sameOrigin: yes })
    ).toMatchObject({ runId });
    expect(
      runTagGate(req, `run:${runId}`, { listener: 'main', runs: reg, sameOrigin: () => false })
    ).toEqual({ refusal: { status: 400, error: 'run-tag-main-origin-only' } });
    expect(
      runTagGate(req, `run:${queued.runId}`, { listener: 'main', runs: reg, sameOrigin: yes })
    ).toEqual({ refusal: { status: 409, error: 'run-not-open' } });
    expect(
      runTagGate(req, `run:${runId}`, { listener: 'main', runs: null, sameOrigin: yes })
    ).toEqual({ refusal: { status: 409, error: 'run-not-open' } });
    reg.close();
  });
});

/* ------------------------------------------------------------------ 3. the stage */

describe('an accepted tagged batch joins ITS run and is published with it', () => {
  test('two runs open: the claim by hash picks the tagged run; its action carries the chat', async () => {
    const root = mkdtempSync(join(tmpdir(), 'run-binding-stage-'));
    const proposals: StageProposal[] = [];
    const direct: string[] = [];
    let tx = 0;
    const stage = createActionStage({
      designRoot: root,
      propose: async (a) => {
        proposals.push(a);
        return { status: 'accepted', actionId: `a_${proposals.length}` } as never;
      },
      newTransactionId: () => `tx_${++tx}`,
      log: { log() {}, warn() {} },
    });
    // The hub runtime's slice, routed exactly like accepted-link's laneLink.propose.
    const slugOf = (rel: string) => (rel.includes('ui/home') ? 'ui-home' : null);
    const runtime = {
      beginAiAction: (k: string, l: string, m?: { runId?: string; chatId?: string }) =>
        stage.begin(k, l, m),
      claimAiWrite: (k: string, rel: string, h?: string | null) => {
        const slug = slugOf(rel);
        if (slug) stage.claim(k, slug, h ?? null);
      },
      proposeLane: (
        slug: string,
        lane: 'annotations',
        text: string,
        o?: { baseText?: string; writeId?: string; stageable?: boolean }
      ) => {
        const p: LaneProposal = {
          lane,
          content: laneValueFromFile(lane, text) as string,
          baseContent: o?.baseText ? (laneValueFromFile(lane, o.baseText) as string) : '',
          transactionId: `tx_${++tx}`,
          ...(o?.writeId ? { writeId: o.writeId } : {}),
          ...(o?.stageable ? { stageable: true } : {}),
        };
        if (stage.captures(slug, p.stageable === true, p.content))
          return stage.capture(slug, `doc:${slug}`, p) as never;
        direct.push(p.content);
        return Promise.resolve({ status: 'accepted' as const });
      },
    };
    // Two of your chats are running; the other one already touched this canvas's board.
    stage.begin('acp:chat-a', 'Chat A', { runId: 'r_aaaaaa01', chatId: 'chat-a' });
    stage.begin('acp:chat-b', 'Chat B', { runId: 'r_bbbbbb01', chatId: 'chat-b' });
    stage.claim('r_aaaaaa01', 'ui-home', null);

    const before = board(sticky('s1', 'make it warmer'));
    const after = board(sticky('s1', 'make it warmer'), sticky('s2', 'Done ✓'));
    const staged = stageRunAnnotations(runtime, {
      runId: 'r_bbbbbb01',
      open: true,
      chatId: 'chat-b',
      label: 'Chat B',
      slug: 'ui-home',
      canvasRel: '.design/ui/home.tsx',
      text: after,
      base: before,
      writeId: 'run:r_bbbbbb01',
    });
    expect(staged).not.toBeNull();
    // Staged, not proposed on its own (a person's edit would have gone straight out).
    expect(direct).toEqual([]);
    expect(proposals).toEqual([]);

    await stage.end('r_aaaaaa01', 'done');
    expect(proposals.flatMap((p) => p.operations)).toEqual([]); // chat A never got the board

    await stage.end('r_bbbbbb01', 'done');
    const published = proposals.find((p) => p.operations.length > 0);
    expect(published).toMatchObject({
      kind: 'ai',
      origin: { runId: 'r_bbbbbb01', chatId: 'chat-b' },
    });
    expect(published?.operations).toEqual([
      expect.objectContaining({
        op: 'lane.replace',
        doc: 'doc:ui-home',
        lane: 'annotations',
        content: laneValueFromFile('annotations', after),
      }),
    ]);
    expect((await staged)?.status).toBe('accepted');
    rmSync(root, { recursive: true, force: true });
  });
});
