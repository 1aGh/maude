// Round 7b: ad-edge-syntax with the desktop stub still on (the Ask AI to fix it button is a desktop-only action)
import { alligators } from './fx3.mjs';
import { REPO } from './lib.mjs';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const fixture = async () => {
  const d = await alligators();
  writeFileSync(
    join(d, '.design/ui/Broken.tsx'),
    `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";\nexport default function Broken() {\n  return (\n    <DesignCanvas>\n      <DCSection id="s" title="Pricing">\n        <DCArtboard id="a" label="Desktop" width={400} height={300}>\n          <span className="pr-plan">\n            <b>{plan.name}</b>\n            <i>{plan.price}</span>\n          </span>\n        </DCArtboard>\n      </DCSection>\n    </DesignCanvas>\n  );\n}\n`
  );
  return d;
};
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 2500);
  await h.step(`${D}/ad-edge-syntax`, 'Broken canvas code: the card in words', 'open Broken, Show details (desktop stub on)', async () => {
    await page.locator('[data-testid="canvas-row-ui-broken"]').first().click({ timeout: 5000 }).catch((e) => console.log('row', e.message.split('\n')[0]));
    await sleep(3500);
    await page.locator('[data-testid="canvas-error-card"] button[aria-expanded]').first().click({ timeout: 4000 }).catch((e) => console.log('adv', e.message.split(String.fromCharCode(10))[0]));
    await sleep(600);
    await page.locator('[data-testid="panel-icon-left"]').first().click({ timeout: 3000 }).catch(() => {});
    await sleep(900);
  });
}
