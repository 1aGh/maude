import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S6.12 (C5, 01 `cf-render-error`) — a canvas that compiles and then throws while it draws.
 *
 * The code is valid, so no build error and no load-failure card: the canvas document catches the throw in its
 * boundary, keeps holding the last good render, and tells its shell (`render-error`). The shell draws S11.7's
 * one card over the dimmed render: "Smoke can't be drawn right now." with "Go back to HH:MM" (the time this
 * session last saw the canvas draw) and Show details holding the error. Repairing the file draws the canvas
 * again, the canvas says `render-ok`, and the card goes.
 *
 * This is the broken-canvas step of `app-boots-and-renders-canvas.e2e.ts`: same fixture canvas, same top-frame
 * assertions (the canvas iframe is unreachable by DOM once the origin split is on, so everything here is on
 * the shell's own `data-testid`s and on the file on disk).
 *
 * Go back itself (`history.go-back` → a new version) is covered by the history specs and
 * `test/v2-render-error.test.tsx`; the fixture project keeps no accepted history to go back to.
 *
 * Written, not run, by the slice (the lane has no desktop build with this change); run with the
 * `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('render-error-card', [CANVAS]);
const original = () => readFileSync(CANVAS, 'utf8');

/** Valid TSX that throws while it draws (a name that is not defined), not at parse time. */
const BROKEN = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  const plan = undefined as unknown as { price: string };
  return (
    <DesignCanvas>
      <DCSection id="smoke" title="Maude desktop E2E" subtitle="SMOKE">
        <DCArtboard id="smoke" label="SMOKE/01 · RENDER" width={480} height={320}>
          <h1 data-testid="smoke-h1">{plan.price}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

describe('render-error-card (native-desktop)', () => {
  let good = '';
  before(async () => {
    await waitForSidecar();
    good = original();
    await (await canvasRow('canvas-row-ui-smoke')).click();
    const frame = await $('[data-testid="canvas-frame"]');
    await frame.waitForExist({ timeout: 30_000 });
    // the canvas drew once in this session: that is the time the card will name
    await browser.pause(1500);
  });
  after(() => fixtures.restore());

  it('a planted runtime throw shows the card; repairing the file takes it away', async () => {
    startReport('render-error-card');
    expect(await $('[data-testid="render-error-host"]').isExisting()).toBe(false);

    writeFileSync(CANVAS, BROKEN);
    const host = await $('[data-testid="render-error-host"]');
    await host.waitForDisplayed({ timeout: 30_000 });
    await capture('render-error-card');

    expect(await $('[data-testid="canvas-error-card"]').getAttribute('data-kind')).toBe('render');
    expect(await $('[data-testid="canvas-error-title"]').getText()).toBe(
      "Smoke can't be drawn right now."
    );
    // the way back names the time this session last saw it draw; nothing technical up front
    expect(await $('[data-testid="canvas-error-go-back"]').getText()).toMatch(
      /^Go back to \d\d:\d\d$/
    );
    expect(await $('[data-testid="canvas-error-last-good-line"]').getText()).toMatch(
      /^Last good version · \d{1,2} \w{3}, \d\d:\d\d$/
    );
    expect(await $('[data-testid="canvas-error-message"]').isExisting()).toBe(false);

    // Show details holds the error, as text
    await $('[data-testid="fold-canvas-error-toggle"]').click();
    // the fold opens on the next render, not inside the click
    await $('[data-testid="canvas-error-message"]')
      .waitForExist({ timeout: 5000 })
      .catch(() => undefined);
    expect(await $('[data-testid="canvas-error-message"]').getText()).toContain('price');

    // repair it the way a person would: the canvas draws, says render-ok, the card goes
    writeFileSync(CANVAS, good);
    await host.waitForExist({ reverse: true, timeout: 30_000 });
    await capture('render-error-card-gone');
  });
});
