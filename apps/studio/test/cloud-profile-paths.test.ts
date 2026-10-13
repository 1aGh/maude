// V2-3.4 (old T9) — an account profile is nothing but env. The desktop shell spawns a tab's
// server with `MAUDE_CLOUD_CONFIG` + `HUBS_CONFIG_PATH` pointing into
// `~/.config/maude/profiles/<id>/`, and every credential that server reads or writes must land
// there: cloud sign-in (cloud.json), attach + workspace sign-in (hubs.json), the silent renewal
// (reads cloud.json, rewrites hubs.json) and sign-out. One reader that resolves the default path
// on its own would sign tab B in as tab A — silently, because the default file exists.
//
// Every hop is a local stub (the control plane AND the cell); nothing talks to a real host.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

let stub: ReturnType<typeof Bun.serve>;
let scratch = '';
let profileDir = '';
let stubUrl = '';
let cellLogins = 0;
const ENV_KEYS = ['MAUDE_CLOUD_URL', 'MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH'] as const;
const envBackup: Record<string, string | undefined> = {};

/** The places a profile-B credential must NEVER reach: the real person's config and the
 *  default (profile `default`) location under whatever XDG_CONFIG_HOME this run has. */
function defaultLocations(): string[] {
  const xdg = process.env.XDG_CONFIG_HOME;
  const out = [
    join(homedir(), '.config', 'maude', 'cloud.json'),
    join(homedir(), '.config', 'maude', 'hubs.json'),
  ];
  if (xdg) out.push(join(xdg, 'maude', 'cloud.json'), join(xdg, 'maude', 'hubs.json'));
  return out;
}
const fingerprint = (p: string) => {
  try {
    const s = statSync(p);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return 'absent';
  }
};
let before: Record<string, string> = {};

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maude-profile-paths-'));
  profileDir = join(scratch, 'config', 'maude', 'profiles', 'work');
  stub = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url);
      const json = (b: unknown, status = 200) => Response.json(b, { status });
      if (url.pathname === '/health') return json({ ok: true, version: 'stub' });
      if (url.pathname === '/auth/device/token')
        return json({ token: 'mpt_work_account', account: { email: 'work@example.com' } });
      // The control plane answers only the PROFILE's account token: a reader that found some
      // other cloud.json would present another account and be refused here.
      const account = req.headers.get('authorization') === 'Bearer mpt_work_account';
      if (url.pathname === '/api/projects')
        return account
          ? json({ projects: [{ id: 'work-project', url: stubUrl, role: 'owner' }] })
          : json({ error: 'unknown account' }, 401);
      if (url.pathname === '/projects/open' && !account)
        return json({ error: 'unknown account' }, 401);
      if (url.pathname === '/projects/open')
        return json({
          token: 'proj.tok',
          url: stubUrl,
          role: 'owner',
          expiresAt: Date.now() + 1e6,
        });
      if (url.pathname === '/auth/login') {
        cellLogins++;
        return json({
          token: `mau_work_hub_${cellLogins}`,
          expiresAt: Date.now() + 3_600_000,
          user: { email: 'work@example.com', role: 'owner' },
        });
      }
      return json({ error: 'not stubbed' }, 404);
    },
  });
  stubUrl = `http://127.0.0.1:${stub.port}`;
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
  process.env.MAUDE_CLOUD_URL = stubUrl;
  process.env.MAUDE_CLOUD_CONFIG = join(profileDir, 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(profileDir, 'hubs.json');
  before = Object.fromEntries(defaultLocations().map((p) => [p, fingerprint(p)]));
});

afterAll(() => {
  stub.stop(true);
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
  rmSync(scratch, { recursive: true, force: true });
});

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const hubs = () =>
  readJson(join(profileDir, 'hubs.json')).hubs as Record<string, { token?: string }>;

function project(name: string) {
  const repoRoot = join(scratch, name);
  const designRoot = join(repoRoot, '.design');
  mkdirSync(designRoot, { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{}\n');
  return { paths: { repoRoot, designRoot } };
}

describe('a profile env routes every credential into the profile dir', () => {
  test('cloud sign-in writes the profile cloud.json', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const r = await createCloudEndpoints(project('a')).signinPoll('dev_code');
    expect(r.status).toBe(200);
    const file = readJson(join(profileDir, 'cloud.json'));
    expect(file.token).toBe('mpt_work_account');
    expect(createCloudEndpoints(project('a')).status().json).toMatchObject({
      connected: true,
    });
  });

  test('attach stores the hub credential in the profile hubs.json', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const r = await createCloudEndpoints(project('b')).attach('work-project');
    expect(r.status).toBe(200);
    expect(hubs()[stubUrl]?.token).toMatch(/^mau_work_hub_/);
  });

  test('the silent renewal reads the profile cloud.json and rewrites the profile hubs.json', async () => {
    const { renewHubCredential } = await import('../cloud/renew.ts');
    const was = hubs()[stubUrl]?.token;
    const r = await renewHubCredential(stubUrl);
    expect(r.ok).toBe(true);
    expect(hubs()[stubUrl]?.token).not.toBe(was);
  });

  test('workspace sign-in stores its peer token in the profile hubs.json', async () => {
    const { signInToWorkspace } = await import('../sync/workspace-signin.ts');
    const other = stubUrl.replace('127.0.0.1', 'localhost');
    const r = await signInToWorkspace({ url: other, email: 'work@example.com', password: 'pw' });
    expect(r.json.ok).toBe(true);
    expect(hubs()[other]?.token).toMatch(/^mau_work_hub_/);
  });

  test('sign-out removes the profile cloud.json', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    createCloudEndpoints(project('c')).signout();
    expect(existsSync(join(profileDir, 'cloud.json'))).toBe(false);
  });

  test('nothing was written to the default locations', () => {
    const after = Object.fromEntries(defaultLocations().map((p) => [p, fingerprint(p)]));
    expect(after).toEqual(before);
  });
});
