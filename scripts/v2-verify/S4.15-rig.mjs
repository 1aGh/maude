#!/usr/bin/env bun
// S4.15 verifier mock ACP agent (the AI loop with annotations). NEVER a real provider. Written, NOT run — the lane
// is shared; run it on the scenario machine. It speaks the same protocol as S5-rig.mjs and boots the same way:
//   MAUDE_ACP_ADAPTER_ENTRY=<this file> MAUDE_ACP_RUNTIME=$(which bun) MAUDE_CLAUDE_BIN=<script printing {"loggedIn":true} for `auth status`>
//   NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_MACHINE_FILE=$(mktemp) bun run apps/studio/server.ts --root <scratch copy of apps/desktop/e2e/fixtures/project
//     + a canvas ui/Site.tsx with a Desktop artboard holding `data-cd-id="hero-picture"` + three stickies on its board>
// Env: S5V_PROJ (scratch project root), S5V_WT (this worktree, for cli/bin/maude.mjs), S415_CANVAS (default ui/Site.tsx).
//
// The loop it plays (contract S4-S5-ai-annotations §4):
//   1. A prompt carrying `[maude-scope annotations: N on <file> — … --selection a,b,c]` and no accept line
//      → it READS (`maude design read-annotations --selection …`, the stickies come back wrapped as untrusted data)
//      and ends with prose + ONE ```maude-offer block (answers = the first two ids, leaves = the rest,
//      one `el:` target). Nothing is changed.
//   2. A prompt carrying `[maude-offer-accepted answers=a,b]` → it edits the design (the hero's width) AND resolves
//      those stickies with `maude design annotate <canvas> --resolve a,b` — MAUDE_CHAT_ID rides the ACP spawn env,
//      so the verb tags its writes `run:<runId>` and they land in the SAME action as the edit.
// Expected on the page: scope chip "3 stickies"; "✦ The hero picture" outline on the canvas while the offer card is
// the latest message; after "Make these changes" the stickies are ticked/struck through and ONE "Undo this chat"
// restores the hero width AND un-resolves them.
import { Readable, Writable } from 'node:stream';
import * as acp from '/Users/iagh/git/personal/maude/apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js';

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
const note = (ctx, u) =>
  ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) =>
  note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

acp
  .agent({ name: 'verifier-mock-s415' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', () => ({
    sessionId: `s415-${++n}`,
    modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Manual' }] },
    configOptions: [],
  }))
  .onRequest('session/load', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const text = (ctx.params.prompt || []).map((p) => p.text || '').join(' ');
    const fs = await import('node:fs');
    const { spawnSync } = await import('node:child_process');
    const canvas = process.env.S415_CANVAS || 'ui/Site.tsx';
    const maude = (...args) =>
      spawnSync(
        'node',
        [
          `${process.env.S5V_WT}/cli/bin/maude.mjs`,
          'design',
          ...args,
          '--root',
          process.env.S5V_PROJ,
        ],
        {
          env: process.env,
          encoding: 'utf8',
        }
      );
    const accepted = text.match(/\[maude-offer-accepted answers=([A-Za-z0-9_.:,-]*)\]/);
    if (accepted) {
      const ids = accepted[1];
      const P = `${process.env.S5V_PROJ}/.design/${canvas}`;
      await note(ctx, {
        sessionUpdate: 'tool_call',
        toolCallId: 'e1',
        title: 'Edit Site.tsx',
        kind: 'edit',
        status: 'in_progress',
        locations: [{ path: P }],
        rawInput: { file_path: P },
      });
      fs.writeFileSync(P, fs.readFileSync(P, 'utf8').replace(/width=\{616\}/, 'width={720}'));
      await note(ctx, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'e1',
        status: 'completed',
        locations: [{ path: P }],
        rawInput: { file_path: P },
      });
      const r = maude('annotate', canvas, '--resolve', ids);
      await say(
        ctx,
        `Done — the hero picture fills the right half. The ${ids.split(',').length} stickies that asked for it are resolved and stay where they were.${r.status ? ` (annotate exit ${r.status})` : ''}`
      );
      return { stopReason: 'end_turn' };
    }
    const scope = text.match(
      /\[maude-scope annotations: (\d+) on (\S+) — [^\]]*--selection ([A-Za-z0-9_.:,-]+)\]/
    );
    if (scope) {
      const ids = scope[3].split(',');
      maude('read-annotations', scope[2], '--selection', scope[3]);
      const offer = {
        v: 1,
        says: 'Hero picture: from 616 to 720 wide, to the right edge; the headline keeps its two lines.',
        answers: ids.slice(0, 2),
        leaves: ids.slice(2),
        targets: [{ ref: 'el:desktop/hero-picture', name: 'The hero picture' }],
      };
      await say(
        ctx,
        `They ask for a bigger hero picture.\n\n\`\`\`maude-offer\n${JSON.stringify(offer)}\n\`\`\``
      );
      return { stopReason: 'end_turn' };
    }
    await say(ctx, 'Nothing to do.');
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
