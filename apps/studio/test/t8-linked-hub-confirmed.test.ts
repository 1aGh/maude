// 2.1.1 T8 (security) — `/_api/cloud/status` tells a link this Mac confirmed from an address the repo
// merely names. `confirmed` comes from this Mac's link verdict (the parked claim on the context), never
// from the committed file, so the page never words an unconfirmed address as a sign-in to repair.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudEndpoints } from '../cloud/endpoints.ts';

const HUB = 'https://team.example.test';
const made: string[] = [];
let prevHubs: string | undefined;
beforeAll(() => {
  prevHubs = process.env.HUBS_CONFIG_PATH;
  const dir = mkdtempSync(join(tmpdir(), 't8-hubs-'));
  made.push(dir);
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json'); // never the real store
});
afterAll(() => {
  if (prevHubs === undefined) delete process.env.HUBS_CONFIG_PATH;
  else process.env.HUBS_CONFIG_PATH = prevHubs;
});
afterEach(() => {
  for (const d of made.splice(1)) rmSync(d, { recursive: true, force: true });
});

function project() {
  const repoRoot = mkdtempSync(join(tmpdir(), 't8-confirmed-'));
  made.push(repoRoot);
  const designRoot = join(repoRoot, '.design');
  mkdirSync(designRoot, { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ linkedHub: { url: HUB, linkedAt: 1 } })
  );
  return { repoRoot, designRoot };
}

type Linked = { url: string; credentialed: boolean; confirmed: boolean } | null;

describe('linkedHub.confirmed', () => {
  test('a committed address this Mac parked answers confirmed: false', () => {
    const paths = project();
    const ep = createCloudEndpoints({ paths, unconfirmedHub: { url: HUB } });
    const linked = (ep.status().json as { linkedHub: Linked }).linkedHub;
    expect(linked).toEqual({ url: HUB, credentialed: false, confirmed: false });
  });

  test('a link this Mac made (not parked) answers confirmed: true, even with no sign-in', () => {
    const paths = project();
    const ep = createCloudEndpoints({ paths });
    const linked = (ep.status().json as { linkedHub: Linked }).linkedHub;
    expect(linked).toEqual({ url: HUB, credentialed: false, confirmed: true });
  });
});
