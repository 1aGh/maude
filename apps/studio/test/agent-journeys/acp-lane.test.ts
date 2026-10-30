// S12.16 fix — the AI chat lane is the AI chat panel's client: it drives the trial studio's own
// `/_ws/acp` socket (acp/index.ts: the run registry's ask, the run's stage), never a bridge of its
// own. A bridge the harness hosts opens no studio run, so every chat edit read as `outside` in
// Version history (S2/S7/S9 acp, live run 1). This pins the panel's frames against a stand-in
// studio socket; acp-panel-ai-attribution.test.ts pins that the studio side lands as `ai`.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHAT_ID, runAcp } from './lanes/acp.mjs';

// a lane that still hosted its own bridge would fail here at once instead of spawning an agent
process.env.MAUDE_ACP_ADAPTER_ENTRY = '/nonexistent/maude-journey-adapter';

// biome-ignore lint/suspicious/noExplicitAny: frames are free-form JSON
type Frame = Record<string, any>;
let server: ReturnType<typeof Bun.serve>;
let trialDir = '';
const got: Frame[] = [];
let endRunAfterMs = 400;

beforeAll(() => {
  trialDir = mkdtempSync(join(tmpdir(), 'maude-acp-lane-'));
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/_ws/acp' && srv.upgrade(req)) return undefined;
      return new Response('no', { status: 404 });
    },
    websocket: {
      message(ws, raw) {
        const f = JSON.parse(String(raw));
        got.push(f);
        const out = (v: Frame) => ws.send(JSON.stringify(v));
        if (f.t === 'attach') out({ t: 'attached', chat: f.chat, running: false });
        if (f.t === 'prompt') {
          out({ t: 'run', run: { runId: 'r_lane1', chatId: f.chat, state: 'starting' } });
          out({
            t: 'update',
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tc1',
              kind: 'edit',
              rawInput: {},
              _meta: { claudeCode: { toolName: 'Edit' } },
            },
          });
          out({
            t: 'update',
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tc1',
              rawInput: { file_path: '.design/ui/A.tsx', old_string: 'a', new_string: 'b' },
            },
          });
          out({
            t: 'permission-request',
            id: 'p1',
            chat: f.chat,
            toolCall: {
              toolCallId: 'tc2',
              title: 'maude design ds publish acme',
              rawInput: { command: 'maude design ds publish acme' },
            },
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'no', kind: 'reject_once', name: 'Deny' },
            ],
          });
          out({ t: 'elicitation-request', id: 'e1', chat: f.chat });
        }
        if (f.t === 'elicitation-response') {
          out({ t: 'run', run: { runId: 'r_lane1', chatId: f.chat, state: 'running' } });
          out({ t: 'turn-end', stopReason: 'end_turn' });
          setTimeout(
            () => out({ t: 'run', run: { runId: 'r_lane1', chatId: f.chat, state: 'ended' } }),
            endRunAfterMs
          );
        }
      },
    },
  });
});
afterAll(() => {
  server?.stop(true);
  rmSync(trialDir, { recursive: true, force: true });
});

const plan = (allow: string[]) => ({
  lane: 'acp',
  chatId: CHAT_ID,
  allow,
  turns: [{ say: 'Make the heading bold.' }],
});

test('the lane sends the panel’s frames for one chat and waits for the run to end', async () => {
  got.length = 0;
  endRunAfterMs = 400;
  const t0 = Date.now();
  const turns = await runAcp(plan([]), '/unused', trialDir, { port: server.port, timeoutMin: 1 });
  expect(turns).toEqual([{ turn: 1, ok: true, stopReason: 'end_turn' }]);
  // the run's stage is published after turn-end: the lane did not leave before the run ended
  expect(Date.now() - t0).toBeGreaterThanOrEqual(400);
  expect(got.map((f) => f.t)).toEqual([
    'attach',
    'prompt',
    'permission-response',
    'elicitation-response',
  ]);
  for (const f of got) expect(f.chat).toBe(CHAT_ID);
  expect(got[1].text).toBe('Make the heading bold.');
  // a card for a verb the journey does not name is refused; a question is declined at once
  expect(got[2]).toMatchObject({ id: 'p1', decision: 'no' });
  expect(got[3]).toMatchObject({ id: 'e1', action: 'decline' });
  // the tool log carries the call's input (it arrives after the announcement)
  const tools = readFileSync(join(trialDir, 'tools.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  expect(tools).toContainEqual({
    lane: 'acp',
    name: 'Edit',
    input: { file_path: '.design/ui/A.tsx', old_string: 'a', new_string: 'b' },
  });
});

test('a verb the journey names in `allow` gets the one-time allow option', async () => {
  got.length = 0;
  endRunAfterMs = 0;
  const turns = await runAcp(plan(['maude design ds publish']), '/unused', trialDir, {
    port: server.port,
    timeoutMin: 1,
  });
  expect(turns[0].ok).toBe(true);
  expect(got.find((f) => f.t === 'permission-response')).toMatchObject({ decision: 'once' });
});
