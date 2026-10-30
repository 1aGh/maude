#!/usr/bin/env bun
// G1 evidence agent — a FAKE ACP agent (never a provider). Derived from apps/desktop/e2e/fixtures/fake-acp/first-canvas-agent.mjs,
// slowed down in steps so a screenshot can catch "drafting":
//   first draft  : newest canvas with no artboard → Desktop (t0) → wait STEP ms → Tablet → wait STEP ms → Mobile → done
//   "dark hero"  : the newest canvas WITH artboards → the Desktop page turns dark → done
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

const acp = await import(process.env.FAKE_ACP_SDK);
const STEP = Number(process.env.G1_AGENT_STEP_MS || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
const note = (ctx, u) => ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) => note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

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

const board = (id, label, w, h, headline, dark = false) => `        <DCArtboard id="${id}" label="${label}" kind="web" width={${w}} height={${h}}>
          <div data-cd-id="${id}-page" style={{ padding: 48, fontFamily: "system-ui, sans-serif", background: "${dark ? '#14181d' : '#fff'}", color: "${dark ? '#f2efe6' : '#111'}", minHeight: ${h} }}>
            <h1 data-cd-id="${id}-headline" style={{ margin: "0 0 12px", fontSize: ${w > 800 ? 56 : 36} }}>${headline}</h1>
            <p data-cd-id="${id}-lede" style={{ margin: "0 0 24px" }}>A small studio for calm, careful software.</p>
            <button data-cd-id="${id}-cta" type="button" style={{ padding: "12px 20px" }}>Book a call</button>
          </div>
        </DCArtboard>`;
const H1 = 'Calm software, made in Brno';
const draft = (name, parts, darkDesktop = false) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function ${name}() {
  return (
    <DesignCanvas>
      <DCSection id="landing" title="Landing page" subtitle="First draft">
${[board('desktop', 'Desktop', 1440, 900, H1, darkDesktop), parts >= 2 ? board('tablet', 'Tablet', 834, 900, H1) : '', parts >= 3 ? board('mobile', 'Mobile', 390, 844, H1) : ''].filter(Boolean).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;

acp
  .agent({ name: 'g1-fake' })
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: true } }))
  .onRequest('session/new', () => ({ sessionId: `g1-${++n}`, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Manual' }] }, configOptions: [] }))
  .onRequest('session/load', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const text = JSON.stringify(ctx.params.prompt || '').toLowerCase();
    const root = process.cwd();
    const all = canvases(root);
    const edit = async (target, status) => {
      await note(ctx, { sessionUpdate: 'tool_call', toolCallId: 'e' + status, title: 'Edit the canvas', kind: 'edit', status, locations: [{ path: target.path }], rawInput: { file_path: target.path } });
    };
    if (text.includes('dark hero')) {
      const target = all.find((c) => /<DCArtboard\s+id="desktop"/.test(readFileSync(c.path, 'utf8')));
      if (!target) { await say(ctx, 'There is no landing canvas to change.'); return { stopReason: 'end_turn' }; }
      await edit(target, 'in_progress');
      await sleep(1500);
      writeFileSync(target.path, draft('FirstDraft', 3, true));
      await note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: 'ein_progress', status: 'completed', locations: [{ path: target.path }], rawInput: { file_path: target.path } });
      await say(ctx, 'Done — the hero on Desktop is dark now, with the sun kept warm.');
      return { stopReason: 'end_turn' };
    }
    const target = all.find((c) => !/<DCArtboard\s+id=/.test(readFileSync(c.path, 'utf8')));
    if (!target) { await say(ctx, 'There is no empty canvas to draw on.'); return { stopReason: 'end_turn' }; }
    await say(ctx, 'Drafting the landing page — Desktop first, then Tablet and Mobile.');
    await edit(target, 'in_progress');
    writeFileSync(target.path, draft('FirstDraft', 1));
    await sleep(STEP);
    writeFileSync(target.path, draft('FirstDraft', 2));
    await sleep(STEP);
    writeFileSync(target.path, draft('FirstDraft', 3));
    await note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: 'ein_progress', status: 'completed', locations: [{ path: target.path }], rawInput: { file_path: target.path } });
    await say(ctx, 'Done — Desktop, Tablet and Mobile are on the canvas. Pick one to refine.');
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
