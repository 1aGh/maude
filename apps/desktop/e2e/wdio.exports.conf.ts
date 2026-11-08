/**
 * WebdriverIO config for the export lanes: export-formats.e2e.ts and exports-panel.e2e.ts.
 *
 * ONE THING MAKES THIS CONFIG NECESSARY: the canvas-origin split must be ON, as it is in every app Maude ships.
 * The base config turns it off so specs can reach into a same-origin canvas iframe. A server the app starts
 * requires its per-spawn key from every main-origin caller (sec-loopback-bearer §7.1), and with the split off an
 * export's headless capture renders on the main origin with no key, so it renders nothing (§7.9, "Desktop with the
 * split off" — accepted because the app never does that). With the split on the server resolves its own capture to
 * the capture origin with a frame capability (`localCaptureUrl`), exactly as in the shipped app.
 *
 * Neither spec reaches into the canvas frame, so the cross-origin iframe costs them nothing.
 *
 * Run: `pnpm test:e2e:desktop:exports`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// The whole reason this config exists — see the header. Runs after the base module body, so it wins.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';

export const config: WebdriverIO.Config = {
  ...base,
  specs: [
    resolve(HERE, 'scenarios', 'export-formats.e2e.ts'),
    resolve(HERE, 'scenarios', 'exports-panel.e2e.ts'),
  ],
};
