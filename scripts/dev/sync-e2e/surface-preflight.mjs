#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
// T1 environment check only. A healthy hub or launchable browser is NOT an
// E2E baseline. Keep this separate from scenarios.mjs's historical pending lane.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const stamp = new Date().toISOString().replaceAll(':', '-');
const out = join(root, '.ai/device/scenario-runs/reliable-project-multiplayer', stamp);
mkdirSync(out, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const relevant =
  /^(apps\/(studio|hub|cells|cloud|desktop)\/|scripts\/dev\/|cli\/|plugins\/design\/templates\/)/;
const denied = /(^|\/)(?:\.env(?:\.[^/]*)?|secrets)(\/|$)|\.(?:key|pem)$/;
const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((path) => relevant.test(path) && !denied.test(path))
  .sort();
const files = paths.map((path) => ({
  path,
  sha256:
    existsSync(join(root, path)) && lstatSync(join(root, path)).isFile()
      ? sha(readFileSync(join(root, path)))
      : null,
}));
const provenance = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceManifestSha256: sha(JSON.stringify(files)),
  files,
  host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length },
  scope: 'prerequisites-only',
  collectedAt: new Date().toISOString(),
};
writeFileSync(join(out, 'source-manifest.json'), `${JSON.stringify(provenance, null, 2)}\n`);

const checks = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, timeout: 20_000 });
  const page = await browser.newPage();
  // No product navigation: isolate browser launch/DOM from sync failures.
  await page.setContent('<main data-testid="preflight">Browser DOM available</main>');
  const text = await page.getByTestId('preflight').innerText();
  if (text !== 'Browser DOM available') throw new Error('DOM round trip failed');
  await page.screenshot({ path: join(out, 'browser-prerequisite.png') });
  checks.push({ id: 'browser-dom', status: 'pass', scope: 'prerequisite' });
} catch (error) {
  writeFileSync(join(out, 'browser-launch.log'), `${error.stack || error}\n`);
  checks.push({ id: 'browser-dom', status: 'fail', evidence: 'browser-launch.log' });
} finally {
  await browser?.close();
}

const app = join(
  root,
  'apps/desktop/src-tauri/target/debug/bundle/macos/Maude.app/Contents/MacOS/maude-desktop'
);
checks.push({
  id: 'bundled-native',
  status: 'not-run',
  reason: existsSync(app)
    ? 'Bundle exists; real WDIO multiplayer participant still required.'
    : 'No bundled debug app at the existing WDIO default path. Run the desktop E2E build.',
});
// Never emit baseline.json here: candidate comparison must not accept this
// environment report as the immutable, measured L01–L24 product baseline.
const result = {
  version: 1,
  scope: 'prerequisites-only',
  baselineComplete: false,
  checks,
  surfaces: Array.from({ length: 24 }, (_, i) => ({
    id: `L${String(i + 1).padStart(2, '0')}`,
    status: 'not-run',
    reason: 'Environment preflight does not execute surface operations.',
  })),
};
writeFileSync(join(out, 'preflight.json'), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(
  join(out, 'report.md'),
  [
    '# Multiplayer baseline prerequisites',
    '',
    '**T1 is incomplete. No UI operation, sync latency, media playback or native multiplayer claim is established.**',
    '',
    ...checks.map(
      (check) => `- ${check.id}: ${check.status}${check.reason ? ` — ${check.reason}` : ''}`
    ),
    '',
    'See preflight.json, source-manifest.json and browser-launch.log (when launch failed).',
    'Complete the operation catalogue and actual browser/native adapters before the baseline run.',
    '',
  ].join('\n')
);
console.log(`T1 prerequisite evidence: ${out}`);
console.log('INCOMPLETE: this command does not certify a surface baseline.');
process.exitCode = 2;
