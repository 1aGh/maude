import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => join(REPO, '.scr/fx-cache/ds-converted');
export const keepState = true;
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('system-maude-v2-design-system', 6000);
  const toks = await k.fr.locator('[data-ds-token]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ds-token')));
  console.log('TOKENS', toks.length, toks.slice(0, 12).join(' '));
  const tids = await k.fr.locator('[data-testid]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-testid')))]);
  console.log('TESTIDS', tids.join(' ').slice(0, 1500));
  const b = await k.box('[data-ds-token="--accent"]');
  console.log('BOX', JSON.stringify(b));
}
