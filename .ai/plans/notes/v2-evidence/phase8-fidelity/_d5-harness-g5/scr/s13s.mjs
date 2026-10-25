// 13 · ds-edge-suggest — an off-system colour gets one quiet question. NOT AI-driven: the server finds the hand-picked
// colour on the lines changed since the last commit (a new, untracked canvas counts whole) of a canvas that follows a
// converted system. Fixture: the converted project, `git init`-ed (nothing committed), Pricing with ONE hand-picked blue.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => join(REPO, '.scr/fx-cache/ds-converted');
export const keepState = true;
export const page = { w: 1440, h: 900 };
const D = '13-design-system';
const PRICING = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Pricing() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Pricing">
        <DCArtboard id="desktop" label="Desktop" width={900} height={560}>
          <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 16, background: "var(--bg-1)", color: "var(--fg-0)", height: "100%", fontFamily: "system-ui, sans-serif" }}>
            <h2 style={{ margin: 0, textAlign: "center" }}>Simple pricing</h2>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
              <span style={{ color: "var(--fg-1)" }}>Monthly</span>
              <b style={{ background: "var(--bg-0)", padding: "4px 10px", borderRadius: 6 }}>Yearly</b>
              <span data-cd-id="badge" style={{ background: "#3b6fe0", color: "var(--fg-0)", padding: "4px 10px", borderRadius: 999, fontSize: 12 }}>Save two months</span>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button data-cd-id="buy" style={{ background: "var(--accent)", color: "var(--fg-0)", border: 0, padding: "10px 18px", borderRadius: 8 }}>Buy</button>
              <button data-cd-id="talk" style={{ background: "var(--bg-3)", color: "var(--fg-1)", border: 0, padding: "10px 18px", borderRadius: 8 }}>Talk to us</button>
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
export async function prepare(project) {
  writeFileSync(join(project, '.design/ui/Pricing.tsx'), PRICING);
  writeFileSync(join(project, '.design/ui/Pricing.meta.json'), JSON.stringify({ designSystem: 'maude-v2' }, null, 2));
  spawnSync('git', ['-C', project, 'init', '-q']);
}
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('ui-pricing', 4000);
  await k.ai(false);
  await h.step(`${D}/ds-edge-suggest`, 'AI spots a hand-picked colour not in the system', 'open Pricing (a changed canvas on a converted system), select the badge; the quiet question draws a moment after the canvas opens', async () => {
    await k.deep('[data-dc-screen="desktop"] [data-cd-id="badge"]', 3).catch(() => {});
    await page.locator('[data-testid="ds-off-system"]').first().waitFor({ timeout: 20000 }).catch(() => console.log('no off-system question'));
    if (!(await page.locator('[data-testid="canvases-pinned"], [data-testid="canvas-row-ui-pricing"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    await sleep(1200);
  });
}
