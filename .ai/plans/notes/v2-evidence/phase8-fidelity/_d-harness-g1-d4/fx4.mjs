// G2 fixture 2: "Studio site" — Homepage (desktop/tablet/mobile) with a link to Pricing, Pricing, and Combine-kampan,
// the canvases the 04 Modes boards draw. Reuses fx3's Combine-kampan.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE } from './fx.mjs';
import { REPO } from './lib.mjs';
import { alligators } from './fx3g2.mjs';

const CACHE = join(REPO, '.scr/fxcache');
const F = '"Inter, system-ui, sans-serif"';
const nav = (w) => `
          <nav data-cd-id="${w}-nav" style={{ display: "flex", alignItems: "center", gap: 28, padding: "20px 48px", fontSize: 15 }}>
            <b data-cd-id="${w}-logo" style={{ marginRight: "auto", fontSize: 18 }}>● Studio</b>
            <span data-cd-id="${w}-n1">Work</span><span data-cd-id="${w}-n2">Services</span><span data-cd-id="${w}-n3">Pricing</span><span data-cd-id="${w}-n4">About</span>
            <button data-cd-id="${w}-book" type="button" style={{ background: "#14181f", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px" }}>Book a call</button>
          </nav>`;

const home = (w, px, h, big) => `
          <div data-cd-id="${w}-page" style={{ width: ${px}, height: ${h}, background: "#fff", color: "#14181f", fontFamily: ${F}, position: "relative", overflow: "hidden" }}>${nav(w)}
            <section data-cd-id="${w}-hero" style={{ display: "flex", flexDirection: ${big ? '"row"' : '"column"'}, gap: 32, padding: "40px 48px", alignItems: "center" }}>
              <div data-cd-id="${w}-copy" style={{ flex: 1 }}>
                <h1 data-cd-id="${w}-h1" style={{ fontSize: ${big ? 56 : 38}, lineHeight: 1.05, margin: "0 0 16px" }}>Calm software, made in Brno.</h1>
                <p data-cd-id="${w}-lede" style={{ fontSize: 16, color: "#4b5565", margin: "0 0 24px" }}>A small studio for product and brand. Two designers, one developer, no rush.</p>
                <button data-cd-id="${w}-work" type="button" style={{ background: "#14181f", color: "#fff", border: 0, borderRadius: 12, padding: "12px 18px", marginRight: 12 }}>See the work</button>
                <button data-cd-id="${w}-pricing" data-cd-link="ui/Pricing.tsx#desktop" type="button" style={{ background: "#fff", color: "#14181f", border: "1px solid #14181f", borderRadius: 12, padding: "12px 18px" }}>See pricing →</button>
              </div>
              <div data-cd-id="${w}-art" style={{ flex: 1, height: ${big ? 340 : 220}, borderRadius: 18, background: "linear-gradient(#9fd3f5 55%, #7fd6a8 55%)", width: "100%" }} />
            </section>
            <section data-cd-id="${w}-cards" style={{ display: "flex", gap: 16, padding: "0 48px" }}>
              ${['Product design', 'Brand systems', 'Small apps'].map((t, i) => `<div data-cd-id="${w}-c${i}" style={{ flex: 1, background: "#f1f4f8", borderRadius: 14, padding: 20 }}><b data-cd-id="${w}-c${i}t">${t}</b><p data-cd-id="${w}-c${i}p" style={{ fontSize: 13, color: "#4b5565" }}>Apps and tools people enjoy using.</p></div>`).join('')}
            </section>
          </div>`;

const homepage = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Homepage() {
  return (
    <DesignCanvas>
      <DCSection id="site" title="Studio site" subtitle="Homepage">
        <DCArtboard id="desktop" label="Desktop" kind="web" width={1440} height={900}>${home('desktop', 1440, 900, true)}
        </DCArtboard>
        <DCArtboard id="tablet" label="Tablet" kind="web" width={834} height={1112}>${home('tablet', 834, 1112, false)}
        </DCArtboard>
        <DCArtboard id="mobile" label="Mobile" kind="web" width={390} height={844}>${home('mobile', 390, 844, false)}
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const price = (w) => `
          <div data-cd-id="${w}-page" style={{ width: ${w === 'desktop' ? 1440 : 834}, height: ${w === 'desktop' ? 900 : 1112}, background: "#fff", color: "#14181f", fontFamily: ${F}, padding: 64, boxSizing: "border-box" }}>
            <h1 data-cd-id="${w}-h1" style={{ fontSize: 48, textAlign: "center", margin: "0 0 8px" }}>Simple pricing</h1>
            <p data-cd-id="${w}-sub" style={{ textAlign: "center", color: "#4b5565" }}>Pay monthly, or save 15 % with a year up front.</p>
            <div data-cd-id="${w}-tiers" style={{ display: "flex", gap: 24, marginTop: 40 }}>
              ${['Solo', 'Studio', 'Team'].map((t, i) => `<div data-cd-id="${w}-t${i}" style={{ flex: 1, borderRadius: 18, padding: 28, background: ["#7fd6a8", "#c7b8f5", "#9fd3f5"][${i}] }}><b data-cd-id="${w}-t${i}n">${t}</b><p data-cd-id="${w}-t${i}p" style={{ fontSize: 36, margin: "12px 0" }}>${['12 000', '28 000', '54 000'][i]} Kč</p></div>`).join('')}
            </div>
          </div>`;
const pricing = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Pricing() {
  return (
    <DesignCanvas>
      <DCSection id="p" title="Pricing" subtitle="Studio site">
        <DCArtboard id="desktop" label="Desktop" kind="web" width={1440} height={900}>${price('desktop')}
        </DCArtboard>
        <DCArtboard id="tablet" label="Tablet" kind="web" width={834} height={1112}>${price('tablet')}
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** Studio site: Homepage + Pricing + Combine-kampan; a few photos in Assets. */
export async function studio() {
  const al = await alligators();
  const d = join(CACHE, 'studio');
  rmSync(d, { recursive: true, force: true });
  cpSync(BASE, d, { recursive: true });
  writeFileSync(join(d, '.design/ui/Homepage.tsx'), homepage);
  writeFileSync(join(d, '.design/ui/Pricing.tsx'), pricing);
  cpSync(join(al, '.design/ui/Combine-kampan.tsx'), join(d, '.design/ui/Combine-kampan.tsx'));
  const as = join(d, '.design/assets');
  mkdirSync(as, { recursive: true });
  ['studio-morning', 'team-at-table', 'brno-roofs', 'desk-detail', 'plant-window', 'sketchbook'].forEach((n, i) => {
    execFileSync('convert', ['-size', i % 2 ? '480x640' : '640x480', 'plasma:fractal', join(as, `${n}.jpg`)]);
  });
  const cfgPath = join(d, '.design/config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.name = 'Studio site';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return d;
}
