// 2.0.4 (task A) — a Maude Cloud project the desktop app itself opened accepts its shared code
// modules with no prompt (Michal, 2026-11-04: "automaticky pro Maude Cloud").
//
// Measured on Michal's second Mac: a managed copy opened from Home held 12 file-ledger rows `stuck`
// with "code modules replicate only from an owner-vouched or loopback hub" — among them
// `ui/2026/dresy/_uniform-template.ts` — because the only writer of `codeModulesAllowed` is the CLI
// `maude design link` prompt, which a managed copy never runs. Every other DDR-054 protection stays:
// a self-hosted hub still needs the explicit consent, a committed `linkedHub` is never trusted, and
// nothing a sign-in response says can turn it on.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { codeModuleConsent, isMaudeCloudCell } from '../sync/code-module-consent.ts';
import { saveHubCredential } from '../sync/hub-link.ts';
import { getHubRecord } from '../sync/hubs-config.ts';

const CLOUD = 'https://alligators.cloud.maude.sh';
const SELF_HOSTED = 'https://hub.example.com';

describe('who counts as Maude Cloud', () => {
  test('a project cell under the compiled-in zone', () => {
    expect(isMaudeCloudCell(CLOUD)).toBe(true);
    expect(isMaudeCloudCell(`${CLOUD}/`)).toBe(true);
    expect(isMaudeCloudCell('https://ALLIGATORS.cloud.maude.sh')).toBe(true);
  });

  test('nothing that only looks like one', () => {
    for (const url of [
      SELF_HOSTED,
      'http://alligators.cloud.maude.sh', // not https
      'https://alligators.cloud.maude.sh:8443', // a port
      'https://u:p@alligators.cloud.maude.sh', // userinfo
      'https://alligators.cloud.maude.sh/x', // a path: not a hub front door
      'https://alligators.cloud.maude.sh.evil.com',
      'https://evilcloud.maude.sh',
      'https://cloud.maude.sh', // the control plane, not a cell
      'https://canvas.cloud.maude.sh', // the zone's own non-cell hosts
      'https://view-abc.cloud.maude.sh',
      'https://canvas-abc.cloud.maude.sh',
      'https://a.b.cloud.maude.sh', // two labels
      'http://127.0.0.1:6666',
      '',
      null,
    ]) {
      expect([url, isMaudeCloudCell(url)]).toEqual([url, false]);
    }
  });
});

describe('codeModuleConsent', () => {
  test('the app-bound Maude Cloud hub may deliver code modules', () => {
    expect(
      codeModuleConsent({
        cellPairing: false,
        hubUrl: CLOUD,
        storedRecord: { role: 'viewer' } as { codeModulesAllowed?: boolean },
        env: { MAUDE_APP_BOUND_HUB: `${CLOUD}/` },
      })
    ).toBe('cloud');
  });

  test('the same hub NOT bound by the app (a committed linkedHub) still may not', () => {
    expect(codeModuleConsent({ cellPairing: false, hubUrl: CLOUD, env: {} })).toBeNull();
    // the app bound THIS folder to another cell: the claim it carries is not that one
    expect(
      codeModuleConsent({
        cellPairing: false,
        hubUrl: CLOUD,
        env: { MAUDE_APP_BOUND_HUB: 'https://other.cloud.maude.sh' },
      })
    ).toBeNull();
  });

  test('a self-hosted hub the app bound still needs the explicit consent', () => {
    const env = { MAUDE_APP_BOUND_HUB: SELF_HOSTED };
    expect(codeModuleConsent({ cellPairing: false, hubUrl: SELF_HOSTED, env })).toBeNull();
    // MAUDE_CLOUD_URL names a control plane, never which hubs count as Maude Cloud
    expect(
      codeModuleConsent({
        cellPairing: false,
        hubUrl: SELF_HOSTED,
        env: { ...env, MAUDE_CLOUD_URL: SELF_HOSTED },
      })
    ).toBeNull();
    expect(
      codeModuleConsent({
        cellPairing: false,
        hubUrl: SELF_HOSTED,
        storedRecord: { codeModulesAllowed: true },
        env,
      })
    ).toBe('recorded');
  });

  test('a recorded no on this Mac keeps its no, even for the app-bound cloud hub', () => {
    expect(
      codeModuleConsent({
        cellPairing: false,
        hubUrl: CLOUD,
        storedRecord: { codeModulesAllowed: false },
        env: { MAUDE_APP_BOUND_HUB: CLOUD },
      })
    ).toBeNull();
  });

  test("a cell's own loopback pairing is vouched, as before", () => {
    expect(codeModuleConsent({ cellPairing: true, hubUrl: 'http://127.0.0.1:1', env: {} })).toBe(
      'cell'
    );
  });
});

describe('a sign-in response cannot turn it on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-consent-'));
  const file = join(dir, 'hubs.json');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('an owner role from the hub is not consent — for a self-hosted hub or an unbound cell', () => {
    for (const hub of [SELF_HOSTED, CLOUD]) {
      // a hostile hub answers user.role "owner" on every login
      saveHubCredential(hub, 'tok', 'owner', undefined, file, 'mallory@example.com');
      saveHubCredential(hub, 'tok2', 'owner', undefined, file);
      const stored = JSON.parse(readFileSync(file, 'utf8')).hubs[hub];
      expect(stored.role).toBe('owner');
      expect(stored.codeModulesAllowed).toBeUndefined();
      expect(
        codeModuleConsent({ cellPairing: false, hubUrl: hub, storedRecord: stored, env: {} })
      ).toBeNull();
    }
  });

  test("a recorded no survives a re-login that says 'owner'", () => {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.hubs[CLOUD].codeModulesAllowed = false;
    writeFileSync(file, JSON.stringify(raw));
    saveHubCredential(CLOUD, 'tok3', 'owner', undefined, file);
    const stored = JSON.parse(readFileSync(file, 'utf8')).hubs[CLOUD];
    expect(stored.codeModulesAllowed).toBe(false);
    expect(
      codeModuleConsent({
        cellPairing: false,
        hubUrl: CLOUD,
        storedRecord: stored,
        env: { MAUDE_APP_BOUND_HUB: CLOUD },
      })
    ).toBeNull();
  });

  test('the stored record is the only hubs.json input the gate reads', () => {
    const prev = process.env.HUBS_CONFIG_PATH;
    process.env.HUBS_CONFIG_PATH = file;
    try {
      const rec = getHubRecord(SELF_HOSTED);
      expect(rec?.role).toBe('owner');
      expect(
        codeModuleConsent({
          cellPairing: false,
          hubUrl: SELF_HOSTED,
          storedRecord: rec,
          env: { MAUDE_APP_BOUND_HUB: SELF_HOSTED },
        })
      ).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.HUBS_CONFIG_PATH;
      else process.env.HUBS_CONFIG_PATH = prev;
    }
  });
});

describe('the sync runtime reads the gate from here', () => {
  test('allowCodeModules comes from codeModuleConsent, not a hub-written field', async () => {
    const src = await Bun.file(join(import.meta.dir, '..', 'sync', 'index.ts')).text();
    const at = src.search(/const allowCodeModules\s*=/);
    expect(at).toBeGreaterThan(-1);
    const stmt = src.slice(at, src.indexOf(';', at));
    expect(stmt).toMatch(/^const allowCodeModules\s*=\s*codeModuleConsent\(\{/);
    expect(stmt).toContain('hubUrl: linkedHub.url');
    expect(stmt).toContain('env: process.env');
    expect(stmt).not.toContain('role');
  });
});
