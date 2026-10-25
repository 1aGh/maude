// Round 7 (p8-c7-ai): the 03 frames the board draws with state the earlier scripts did not set up:
//  ai-open / ai-suggest  — Tereza's three open comments (the lead strip), Canvases + Inspector as the board
//  ai-attach             — photo + footage + PDF chips inside the prompt (overlay shot separately as ai-attach-drop)
//  ai-same-artboard / ai-copy — the second ask on POST 1:1 (the board's), then Run on a copy
//  ai-permission         — Uniformy-2027, the four photo artboards picked, the ask on them
//  ai-question           — an element picked: AI answers and points at it (point ring)
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
export const page = { w: 1440, h: 900, channel: true };
export const env = {
  MAUDE_ACP_ADAPTER_ENTRY: join(REPO, '.scr/impl/fake-agent.mjs'),
  MAUDE_ACP_RUNTIME: (process.env.D5_BUN || '/Users/iagh/.bun/bin/bun'),
  MAUDE_CLAUDE_BIN: join(REPO, 'apps/desktop/e2e/fixtures/fake-acp/claude-stub.sh'),
  FAKE_ACP_SDK: join(REPO, 'apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'),
};
const D = '03-ai-chat';
const UNI = [
  ['Dres doma', 'jersey', 'Domácí dres 2027'], ['Dres venku', 'jersey', 'Venkovní dres 2027'],
  ['Helma z boku', 'jersey', 'Helma · zelená/zlatá'], ['Kalhoty doma', 'jersey', 'Kalhoty doma'],
  ['Foto · obrana', 'photo'], ['Foto · útok', 'photo'], ['Foto · speciální týmy', 'photo'], ['Foto · trenéři', 'photo'],
];
const uniformy = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Uniformy() {
  return (
    <DesignCanvas>
      <DCSection id="uniformy" title="Uniformy 2027" subtitle="Dresy a týmové fotky">
${UNI.map(([label, v, cap], i) => `        <DCArtboard id="u${i}" label="${label}" kind="${v === 'photo' ? 'digital' : 'print'}" width={170} height={240}>
          ${v === 'jersey'
            ? `<div data-cd-id="u${i}-page" style={{ width: 170, height: 240, background: "#dfe3e8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "system-ui, sans-serif" }}><div style={{ width: 75, height: 120, borderRadius: 12, background: "#86dc9d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 800, color: "#10241a" }}>27</div><div style={{ fontSize: 8, color: "#10241a" }}>${cap}</div></div>`
            : `<div data-cd-id="u${i}-page" style={{ width: 170, height: 240, background: "#9fd6f2", position: "relative", fontFamily: "system-ui, sans-serif" }}><div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 95, background: "#86dc9d" }} /><div style={{ position: "absolute", left: 8, top: 8, padding: "2px 4px", background: "#f6d860", color: "#10241a", fontSize: 8, borderRadius: 2 }}>2025</div></div>`}
        </DCArtboard>`).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;
const comment = (id, text, y) => ({
  id, file: '.design/ui/Combine-kampan.tsx', selector: '[data-cd-id="post-page"]', index: 0,
  dom_path: ['div'], tag: 'div', classes: '', bounds: { x: 40 + y, y: 60 + y * 2, width: 28, height: 28 },
  html_excerpt: '', text, status: 'open', created: '2026-10-25T08:00:00.000Z', resolved_at: null,
  author: 'Tereza', thread: [], mentions: [],
});
export const fixture = async () => {
  const d = await alligators();
  writeFileSync(join(d, '.design/ui/Uniformy-2027.tsx'), uniformy);
  mkdirSync(join(d, '.design/_comments'), { recursive: true });
  writeFileSync(
    join(d, '.design/_comments/ui-combine-kampan.json'),
    JSON.stringify([comment('c_t1', 'Date line is too small', 0), comment('c_t2', 'Logo a bit left', 40), comment('c_t3', 'English version?', 80)], null, 2)
  );
  return d;
};

export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (re, mod) => {
    const loc = f.getByText(re).first();
    const b = await loc.boundingBox({ timeout: 6000 });
    if (mod) await page.keyboard.down(mod);
    await page.mouse.click(b.x + Math.min(14, b.width / 2), b.y + b.height / 2);
    if (mod) await page.keyboard.up(mod);
    await sleep(450);
  };
  const POST = /^Post 1:1/;
  const send = async (text, wait = 2500, mode) => {
    if (mode) h.mode(mode);
    const input = page.locator('[data-testid="chat-composer"] .chat-input:visible').last();
    await input.click({ timeout: 6000 });
    await page.keyboard.type(text);
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  const newChat = async (re) => {
    await h.click('ai-chat-new').catch(() => {});
    await sleep(500);
    if (re) await pick(re);
  };
  await h.open('ui-combine-kampan', 3500);
  // ai-open / ai-suggest: Post picked FIRST, then the panel (the board shows Canvases + Inspector around it)
  await pick(POST);
  await h.click('panel-icon-assistant');
  await sleep(900);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(900);
  await h.step(`${D}/ai-open`, 'Post 1:1 picked, the panel opened: the comments strip leads', 'pick Post, open the AI panel; Tereza has 3 open comments', async () => {});
  await h.step(`${D}/ai-suggest`, 'the same strip (comments context)', 'same frame', async () => {});
  rmSync(join(h.project, '.design/_comments'), { recursive: true, force: true });
  await sleep(1500);
  // ai-attach: chips inside the prompt, no overlay
  await h.esc(1);
  await h.step(`${D}/ai-attach`, 'photo + footage + PDF chips in the prompt', 'set three files on the attach input', async () => {
    const files = [
      join(REPO, '.scr/attach/Combine-foto.png'),
      join(REPO, '.scr/attach/trenink-0412.mov'),
      join(REPO, '.scr/attach/Combine-brief-2026.pdf'),
    ];
    await page.locator('[data-testid="ai-attach-input"]').first().setInputFiles(files);
    await sleep(1600);
  });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'trenink-0412.mov', { type: 'video/quicktime' }));
    document.querySelector('[data-testid="chat-composer"]')?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await sleep(500);
  await h.step(`${D}/ai-attach-drop`, 'drop overlay over the panel', 'dragenter with Files', async () => {});
  await page.evaluate(() => {
    document.querySelector('[data-testid="chat-composer"]')?.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
  });
  // same artboard: chat 1 works on Post, chat 2 asks on Post and waits its turn
  await newChat(POST);
  await send('Make it greener, keep the logo white', 2600, { mode: 'hang', text: 'Making it greener — ' });
  await newChat(POST);
  await send('Headline in one word', 2600, { mode: 'hang' });
  await h.step(`${D}/ai-same-artboard`, 'second ask on Post 1:1 waits', 'second chat on the same artboard', async () => {});
  await h.step(`${D}/ai-copy`, 'run on a copy of Post 1:1', 'click "Run on a copy"', async () => {
    h.mode({ mode: 'done', text: 'Done — Post 1:1 · copy says COMBINE. It started from Post 1:1 before “Make it greener”, so each shows one idea.' });
    await page.locator('[data-testid="ai-waiting-copy"]').first().click({ timeout: 4000 });
  }, { fresh: true });
  await sleep(2500);
  // permission on Uniformy-2027
  await h.open('ui-uniformy-2027', 3500);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(500);
  await newChat();
  await pick(/^Foto · obrana/);
  for (const n of ['Foto · útok', 'Foto · speciální týmy', 'Foto · trenéři']) await pick(new RegExp(`^${n}`), 'Shift');
  await send('Swap the 2025 team photos for the new ones in Assets › Foto 2026', 2800, { mode: 'permission' });
  await page.mouse.click(1000, 200); // the run holds the four artboards; nothing stays picked (no align bar, as the board)
  await sleep(700);
  await h.step(`${D}/ai-permission`, 'the four photo artboards ringed, the question open', 'four artboards picked, the ask', async () => {});
}
