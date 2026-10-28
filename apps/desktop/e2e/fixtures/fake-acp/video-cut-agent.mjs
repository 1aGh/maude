#!/usr/bin/env bun
// P8 test round (G4 video) — a SCRIPTED fake ACP agent that cuts a video the way the design plugin teaches it
// (skill footage-director, "Place the cut shot by shot"), without a model:
//
//   watch   writes `assets/<sha8>.footage.json` for each clip the ask attached, one by one (the studio derives
//           "Watching 12 clips… N done" and the found lines from those files)
//   plan    writes `<designRoot>/recap.edl.json` — 14 shots from the 9 usable clips, every length a whole number of
//           beats at 120 BPM / 30 fps (15 frames a beat) so every shot starts on a beat
//   place   `maude design reel-place recap --next --canvas ui/VideoAiCut.tsx#recap` x 14, each wrapped in the plugin's
//           REAL pre-bash / post-bash hooks (`runHook`, cli/lib/design-hook.mjs) so the studio attributes each shot to
//           the run: one action, one undo, "Made by AI" at the end
//   say     "Done — Recap · Reels is a 0:30 cut: …"
//
// Picked when the prompt says "30 s recap"; any other prompt answers "ok.". Boot (wdio.video-ai.conf.ts):
//   MAUDE_ACP_ADAPTER_ENTRY=<this file>  MAUDE_ACP_RUNTIME=bun  FAKE_ACP_SDK=<abs sdk path>  MAUDE_E2E_FAKE_AI=1
// Knobs (read from env so the spec decides): VIDEO_CUT_PAUSE_MS (between steps, default 450).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const { runHook } = await import(join(REPO, 'cli/lib/design-hook.mjs'));
const REEL_PLACE = join(REPO, 'apps/studio/bin/_reel-place.mjs');
const PAUSE = Number(process.env.VIDEO_CUT_PAUSE_MS ?? 450);

const acp = await import(process.env.FAKE_ACP_SDK);
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (ctx, u) =>
  ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) =>
  note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const promptText = (ctx) => (ctx.params.prompt || []).map((b) => b.text || '').join('\n');
const cancels = new Map();
let n = 0;

const hookIn = (ctx, extra) =>
  JSON.stringify({ session_id: ctx.params.sessionId, cwd: process.cwd(), ...extra });

/** The assets an ask attached: `- footage “name” (…): /abs/…/assets/<sha8>.<ext>` under the attachments header. */
function attached(text) {
  const at = text.indexOf('[maude-attachments');
  if (at < 0) return [];
  const out = [];
  for (const raw of text.slice(at).split('\n').slice(1)) {
    const m = /^- footage “([^”]*)”(?: \([^)]*\))?: (.+)$/.exec(raw.trimEnd());
    const tail = m && /assets[\\/]([0-9a-f]{8,}[A-Za-z0-9_-]*\.[A-Za-z0-9]{1,5})$/.exec(m[2].trim());
    if (tail) out.push({ asset: `assets/${tail[1]}`, name: m[1].replace(/\.[A-Za-z0-9]{1,5}$/, '') });
  }
  return out;
}

const DESIGN = () => join(process.cwd(), '.design');

/** One clip's analysis: usable moments (the best is AI's pick), or none usable (the reason is the note). */
function analysis(clip, i, total) {
  const base = { version: 1, asset: clip.asset, durationSec: 6, width: 128, height: 72, keyframes: 6 };
  if (i >= total - 3) {
    const why = i === total - 1 ? 'shaky' : 'too dark';
    return {
      ...base,
      summary: `Unusable: ${why}.`,
      shots: [{ start: 0, end: 5, kind: 'action', quality: 0.1, usable: false, note: why }],
    };
  }
  return {
    ...base,
    summary: `${clip.name}: a clean run.`,
    shots: [
      { start: 0.5, end: 3, kind: 'action', subject: 'Touchdown run', quality: 0.6, usable: true },
      { start: 1, end: 3.5, kind: 'action', subject: 'Touchdown run', quality: 0.9, usable: true },
      { start: 3, end: 5.5, kind: 'action', subject: 'Touchdown run', quality: 0.5, usable: true },
    ],
  };
}

async function bash(ctx, command, run) {
  const input = {
    hook_event_name: 'PreToolUse',
    tool_use_id: `tu${Math.random().toString(36).slice(2, 8)}`,
    tool_name: 'Bash',
    tool_input: { command },
  };
  const id = `b${Math.random().toString(36).slice(2, 8)}`;
  await note(ctx, {
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: command,
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command },
  });
  await runHook({ event: 'pre-bash', stdinText: hookIn(ctx, input) });
  const r = run();
  await runHook({
    event: 'post-bash',
    stdinText: hookIn(ctx, { ...input, hook_event_name: 'PostToolUse', tool_response: {} }),
  });
  await note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' });
  return r;
}

async function cut(ctx) {
  const text = promptText(ctx);
  const clips = attached(text);
  writeFileSync(join(REPO, '.ai/device/video-cut-agent.prompt.txt'), text);
  await runHook({
    event: 'prompt',
    stdinText: hookIn(ctx, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }),
  });
  let stopped = false;
  cancels.set(ctx.params.sessionId, () => {
    stopped = true;
  });
  await say(ctx, 'Watching the footage first. ');
  for (let i = 0; i < clips.length; i++) {
    if (stopped) return { stopReason: 'cancelled' };
    writeFileSync(
      join(DESIGN(), clips[i].asset.replace(/\.[^./]+$/, '.footage.json')),
      `${JSON.stringify(analysis(clips[i], i, clips.length), null, 2)}\n`
    );
    await sleep(PAUSE);
  }
  const usable = clips.slice(0, Math.max(1, clips.length - 3));
  const lens = [45, 60, 30, 45, 60, 30, 45, 60, 30, 45, 60, 30, 45, 60]; // 3 / 4 / 2 beats of 15 frames
  const beats = lens.map((d, k) => {
    const c = usable[k % usable.length];
    return {
      clip: c.asset,
      startSec: 1,
      durationFrames: d,
      name: `Shot ${k + 1}`,
      transition: null,
    };
  });
  writeFileSync(join(DESIGN(), 'recap.edl.json'), JSON.stringify({ version: 1, fps: 30, beats }));
  await say(ctx, 'Placing the shots on the beat. ');
  for (let k = 0; k < beats.length; k++) {
    if (stopped) return { stopReason: 'cancelled' };
    await bash(ctx, 'maude design reel-place recap --next --canvas ui/VideoAiCut.tsx#recap', () =>
      spawnSync(
        'bun',
        [
          'run',
          REEL_PLACE,
          'recap',
          '--next',
          '--canvas',
          'ui/VideoAiCut.tsx#recap',
          '--root',
          process.cwd(),
        ],
        { encoding: 'utf8', env: { ...process.env, NO_OPEN: '1' } }
      )
    );
    await sleep(PAUSE);
  }
  await say(
    ctx,
    `Done — Recap · Reels is a 0:30 cut: 14 shots from ${usable.length} of your ${clips.length} clips, on the beat of Hype instrumental.`
  );
  return { stopReason: 'end_turn' };
}

acp
  .agent({ name: 'fake-video-cut' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', () => ({
    sessionId: `vc-${process.pid}-${++n}`,
    modes: {
      currentModeId: 'acceptEdits',
      availableModes: [
        { id: 'default', name: 'Ask before' },
        { id: 'acceptEdits', name: 'Accept edits' },
        { id: 'plan', name: 'Plan' },
      ],
    },
    configOptions: [],
  }))
  .onRequest('session/load', () => ({}))
  .onNotification('session/cancel', (ctx) => cancels.get(ctx.params.sessionId)?.())
  .onRequest('session/prompt', async (ctx) => {
    if (/30 s recap/.test(promptText(ctx))) {
      try {
        return await cut(ctx);
      } catch (e) {
        // the agent's stderr is not shown anywhere: leave the reason where a failed run can be read
        writeFileSync(join(REPO, '.ai/device/video-cut-agent.log'), `${e?.stack ?? e}\n`);
        throw e;
      }
    }
    await say(ctx, 'ok.');
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
