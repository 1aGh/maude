#!/usr/bin/env bun
// S6.16 — the FAKE ACP agent behind first-canvas.e2e.ts. NEVER a real provider: it speaks just enough ACP
// (initialize · session/new · session/load · session/prompt) to be the adapter, and "draws" one fixed first
// draft, the way the design skill's first-draft order says (every artboard added first, words last):
// three web artboards — Desktop 1440, Tablet 834, Mobile 390 — each with a headline and a button.
//
// Which canvas: the one Home's sentence just made — the newest `.tsx` under `<cwd>/.design` (cwd is the project
// root, bridge.ts) that has no `<DCArtboard id=…>` yet. NOTE the fixture project's own canvases (beta-board.tsx)
// are older than the one Home's sentence just made, so "newest" finds the right one. It writes the file straight to disk, the same way the S4.15 /
// S5 verifier rigs do; the studio's file watcher then reloads the canvas. No hook, no maude verb: the e2e only
// needs the draft to land.
//
// Boot (wdio.first-canvas.conf.ts):  MAUDE_ACP_ADAPTER_ENTRY=<this file>  MAUDE_ACP_RUNTIME=$(which bun)
//   MAUDE_CLAUDE_BIN=<claude-stub.sh>  FAKE_ACP_SDK=<abs path of @agentclientprotocol/sdk/dist/acp.js>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

const acp = await import(process.env.FAKE_ACP_SDK);

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
const note = (ctx, u) =>
  ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) =>
  note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

/** Every canvas source under .design, newest first, skipping runtime/system dirs. */
function canvases(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name === 'system' || name === 'node_modules') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.tsx$/.test(name)) out.push({ path: p, mtime: st.mtimeMs });
    }
  };
  walk(join(root, '.design'));
  return out.sort((a, b) => b.mtime - a.mtime);
}

const artboard = (
  id,
  label,
  w,
  h,
  headline
) => `        <DCArtboard id="${id}" label="${label}" kind="web" width={${w}} height={${h}}>
          <div data-cd-id="${id}-page" style={{ padding: 48, fontFamily: "system-ui, sans-serif", background: "#fff", minHeight: ${h} }}>
            <h1 data-cd-id="${id}-headline" style={{ margin: "0 0 12px", fontSize: ${w > 800 ? 56 : 36} }}>${headline}</h1>
            <p data-cd-id="${id}-lede" style={{ margin: "0 0 24px" }}>A small studio for calm, careful software.</p>
            <button data-cd-id="${id}-cta" type="button" style={{ padding: "12px 20px" }}>Book a call</button>
          </div>
        </DCArtboard>`;

const draft = (name) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function ${name}() {
  return (
    <DesignCanvas>
      <DCSection id="landing" title="Landing page" subtitle="First draft">
${artboard('desktop', 'Desktop', 1440, 900, 'Calm software, made in Brno')}
${artboard('tablet', 'Tablet', 834, 900, 'Calm software, made in Brno')}
${artboard('mobile', 'Mobile', 390, 844, 'Calm software, made in Brno')}
      </DCSection>
    </DesignCanvas>
  );
}
`;

acp
  .agent({ name: 'fake-first-canvas' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', () => ({
    sessionId: `fc-${++n}`,
    modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Manual' }] },
    configOptions: [],
  }))
  .onRequest('session/load', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const root = process.cwd();
    // the blank template's comment WORDS mention `<DCArtboard>`: an artboard is the tag with an id
    const target = canvases(root).find(
      (c) => !/<DCArtboard\s+id=/.test(readFileSync(c.path, 'utf8'))
    );
    if (!target) {
      await say(ctx, 'There is no empty canvas to draw on.');
      return { stopReason: 'end_turn' };
    }
    await note(ctx, {
      sessionUpdate: 'tool_call',
      toolCallId: 'e1',
      title: 'Edit the canvas',
      kind: 'edit',
      status: 'in_progress',
      locations: [{ path: target.path }],
      rawInput: { file_path: target.path },
    });
    writeFileSync(target.path, draft('FirstDraft'));
    await note(ctx, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'e1',
      status: 'completed',
      locations: [{ path: target.path }],
      rawInput: { file_path: target.path },
    });
    await say(ctx, 'Done — Desktop, Tablet and Mobile are on the canvas. Pick one to refine.');
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
