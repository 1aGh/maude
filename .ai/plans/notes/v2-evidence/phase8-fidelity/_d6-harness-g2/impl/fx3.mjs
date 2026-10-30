// G2 fixture: "Alligators brand" with the Combine-kampan canvas (web · post · story · teaser · poster), the way the 03/04 boards draw it.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE } from './fx.mjs';
import { REPO } from './lib.mjs';

const CACHE = join(REPO, '.scr/fxcache');
const mock = (id, head, sub, w, h, acc = '#2e7d4e') => `
          <div data-cd-id="${id}-page" style={{ width: ${w}, height: ${h}, background: "#10241a", color: "#e8fff0", fontFamily: "system-ui, sans-serif", padding: ${Math.round(w / 14)}, boxSizing: "border-box", position: "relative", overflow: "hidden" }}>
            <div data-cd-id="${id}-logo" style={{ width: ${Math.round(w / 9)}, height: ${Math.round(w / 9)}, borderRadius: "70% 0 70% 0", background: "#fff" }} />
            <div data-cd-id="${id}-arch" style={{ position: "absolute", right: 0, bottom: 0, width: "46%", height: "62%", borderRadius: "999px 999px 0 0", background: "#245c3a" }} />
            <h1 data-cd-id="${id}-headline" style={{ margin: "${Math.round(h / 8)}px 0 8px", fontSize: ${Math.round(w / 11)}, letterSpacing: 1, color: "${acc}" }}>${head}</h1>
            <p data-cd-id="${id}-sub" style={{ margin: 0, fontSize: ${Math.round(w / 34)} }}>${sub}</p>
            <button data-cd-id="${id}-cta" type="button" style={{ marginTop: ${Math.round(h / 22)}, padding: "10px 18px", background: "${acc}", color: "#10241a", border: 0, fontWeight: 700 }}>ZAPIŠ SE</button>
          </div>`;

const canvas = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function CombineKampan() {
  return (
    <DesignCanvas>
      <DCSection id="combine" title="Combine 2026" subtitle="Nábor pro sezónu 2026">
        <DCArtboard id="web" label="Web · STAŇ SE GATOREM" kind="web" width={1440} height={900}>${mock('web', 'STAŇ SE GATOREM', 'Combine 2026 · nábor pro sezónu 2026', 1440, 900)}
        </DCArtboard>
        <DCArtboard id="post" label="Post 1:1 · Combine 2026" kind="social" width={1080} height={1080}>${mock('post', 'COMBINE 2026', 'So 14. 3. · Kraví hora', 1080, 1080, '#2f7d4f')}
        </DCArtboard>
        <DCArtboard id="story" label="Story 9:16 · Zapiš se" kind="social" width={1080} height={1920}>${mock('story', 'ZAPIŠ SE', 'do 10. 3.', 1080, 1920)}
        </DCArtboard>
        <DCArtboard id="teaser" label="16:9 · teaser" width={1920} height={1080}>${mock('teaser', 'Combine 2026', '0:12 / 0:30', 1920, 1080)}
        </DCArtboard>
        <DCArtboard id="poster" label="A4 · plakát" kind="print" width={794} height={1123}>${mock('poster', 'COMBINE 2026', 'So 14. 3. · Kraví hora', 794, 1123, '#2c7a4c')}
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** Base fixture + Combine-kampan, project named Alligators brand. */
export async function alligators() {
  const d = join(CACHE, 'alligators');
  rmSync(d, { recursive: true, force: true });
  cpSync(BASE, d, { recursive: true });
  writeFileSync(join(d, '.design/ui/Combine-kampan.tsx'), canvas);
  const cfgPath = join(d, '.design/config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.name = 'Alligators brand';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return d;
}
