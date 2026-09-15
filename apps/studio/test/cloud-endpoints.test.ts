// The dev-server's Maude Cloud lane — Cloud Phase 23 C3 + the maude:// code
// attach (Phase 17). The control plane AND the cell are stubbed on one local
// server; the assertions are about custody and trust posture, not transport:
// the code is exchanged only against the CONFIGURED cloud address, the hub
// token lands in the credential store, and linkedHub is written token-free.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  connectOutcomeNote,
  isDisplayableUrl,
  isLinkedProjectRow,
  localIdentityHint,
  parseDeepLink,
  shareViewUrl,
} from '../client/panels/CloudBar.jsx';

let stub: ReturnType<typeof Bun.serve> | null = null;
let scratch = '';
const seen: string[] = [];

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maude-cloud-test-'));
  stub = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url);
      seen.push(`${req.method} ${url.pathname}`);
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.pathname === '/auth/handoff/exchange') {
        const body: any = await req.json();
        if (body.code === 'mhc_' + 'a'.repeat(64)) {
          return json({
            token: 'x.y',
            role: 'owner',
            project: 'stub-project',
            // The "cell" is this same stub server.
            url: `http://127.0.0.1:${stub!.port}`,
            expiresAt: Date.now() + 3600_000,
          });
        }
        return json({ error: 'that code is not valid or has expired' }, 400);
      }
      if (url.pathname === '/auth/login') {
        const body: any = await req.json();
        return body?.token === 'x.y'
          ? json({ token: 'mau_stub_hub_token', user: { email: 'e@example.com', role: 'owner' } })
          : json({ error: 'no' }, 401);
      }
      return json({ error: 'not stubbed' }, 404);
    },
  });
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${stub.port}`;
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
});

afterAll(() => {
  stub?.stop(true);
  rmSync(scratch, { recursive: true, force: true });
  delete process.env.MAUDE_CLOUD_URL;
  delete process.env.MAUDE_CLOUD_CONFIG;
  delete process.env.HUBS_CONFIG_PATH;
});

describe('parseDeepLink — untrusted input, strict shape', () => {
  test('accepts exactly the minted shape', () => {
    const p = parseDeepLink(
      `maude://open/alligators?code=mhc_${'a'.repeat(64)}&origin=https://cloud.maude.sh`
    );
    expect(p).toEqual({ project: 'alligators', code: `mhc_${'a'.repeat(64)}` });
  });
  test('refuses everything else', () => {
    for (const bad of [
      `maude://open/alligators?open=ui/A.tsx&code=mhc_${'a'.repeat(64)}`,
      'maude://open/alligators', // no code
      'maude://open/Alligators?code=mhc_' + 'a'.repeat(64), // bad slug
      'maude://open/x?code=nothex', // bad code
      'https://evil.example/?code=mhc_' + 'a'.repeat(64), // not maude://
      'maude://join/x/y', // join is not the open shape
      // Over the platform's 40-char project-id cap — a drive-by link never
      // passes through the server-side bound, so arbitrary attacker text would
      // otherwise render in the dialog heading, prose and aria-label.
      `maude://open/${'a'.repeat(41)}?code=mhc_${'a'.repeat(64)}`,
    ]) {
      expect(parseDeepLink(bad)).toBeNull();
    }
    // …and exactly 40 is still a real project id.
    expect(
      parseDeepLink(`maude://open/${'a'.repeat(40)}?code=mhc_${'a'.repeat(64)}`)
    ).not.toBeNull();
  });
});

describe('shareViewUrl — the viewer’s browser home', () => {
  test('is the project’s OWN address — the view- gallery is gone (Phase 25 C5)', () => {
    // `view-*` is hard-refused by tenantFromHostname, so the old derivation
    // produced a guaranteed 404 — invisible only because window.open was a no-op
    // in the shell. Making the opener work would have made it a dead menu item.
    expect(shareViewUrl('https://alligators.cloud.maude.sh', 'alligators')).toBe(
      'https://alligators.cloud.maude.sh'
    );
    expect(shareViewUrl('https://alligators.cloud.maude.sh', 'alligators')).not.toContain('view-');
  });
  test('falls back to the platform zone on garbage', () => {
    expect(shareViewUrl('nonsense', 'p1')).toBe('https://p1.cloud.maude.sh');
  });
});

describe('isDisplayableUrl — what may be rendered as a clickable address', () => {
  const CLOUD = 'https://cloud.maude.sh';

  test('the configured origin and the cloud zone’s front doors pass', () => {
    expect(isDisplayableUrl('https://cloud.maude.sh/activate?code=ABCD', CLOUD)).toBe(true);
    expect(isDisplayableUrl('https://alligators.cloud.maude.sh/', CLOUD)).toBe(true);
    // A self-host origin is legitimate for its OWN addresses.
    expect(isDisplayableUrl('http://127.0.0.1:8788/activate', 'http://127.0.0.1:8788')).toBe(true);
  });

  test('an off-zone address is never rendered — a scheme check was not enough', () => {
    // The bug this closes: `https://evil.example/activate?code=…` from a hostile
    // or MITM'd control plane passed a protocol-only check and still rendered as
    // a live href with a Copy button, and middle-click never reaches the click
    // handler, let alone the Rust zone lock.
    for (const bad of [
      'https://evil.example/activate?code=x',
      'https://cloud.maude.sh.attacker.example/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isDisplayableUrl(bad, CLOUD)).toBe(false);
    }
    // Deep paths on a TENANT host are refused here too — same rule as the opener.
    expect(isDisplayableUrl('https://canvas-evil.cloud.maude.sh/stored.svg', CLOUD)).toBe(false);
  });
});

describe('status — names the LOCAL half so a deep link can be read', () => {
  test('reports the open folder and its workspace, and never a credential', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const { mkdirSync } = await import('node:fs');
    const repoRoot = join(scratch, 'alligators-web');
    const designRoot = join(repoRoot, '.design');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({ linkedHub: { url: 'https://alligators.cloud.maude.sh', linkedAt: 1 } })
    );

    const r = createCloudEndpoints({ paths: { repoRoot, designRoot } }).status();
    expect(r.status).toBe(200);
    const json = r.json as Record<string, unknown>;
    expect(json.project).toBe('alligators-web');
    // No hub credential was stored in this scratch dir, so the link is reported
    // but explicitly UNCORROBORATED — the dialog may not vouch for it.
    expect(json.linkedHub).toEqual({
      url: 'https://alligators.cloud.maude.sh',
      credentialed: false,
    });
    // Signed out here — and the payload must stay free of token material
    // whatever the state (this response reaches the browser surface too).
    expect(json.connected).toBe(false);
    expect(JSON.stringify(json)).not.toContain('token');
  });

  test('an unlinked (or malformed-config) folder reports linkedHub: null, not an error', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const { mkdirSync } = await import('node:fs');
    const repoRoot = join(scratch, 'fresh-thing');
    const designRoot = join(repoRoot, '.design');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(join(designRoot, 'config.json'), '{ not json');

    const json = createCloudEndpoints({ paths: { repoRoot, designRoot } }).status().json as Record<
      string,
      unknown
    >;
    expect(json.linkedHub).toBeNull();
    expect(json.project).toBe('fresh-thing');
  });
});

describe('isLinkedProjectRow — Connected is a state only a credentialed link earns (fix 7)', () => {
  const CLOUD = 'https://cloud.maude.sh';
  const row = (over = {}) =>
    isLinkedProjectRow({
      projectUrl: 'https://alligators.cloud.maude.sh',
      linkedHubUrl: 'https://alligators.cloud.maude.sh',
      linkedHubCredentialed: true,
      cloudUrl: CLOUD,
      ...over,
    });

  test('linked + credentialed → the row is Connected', () => {
    expect(row()).toBe(true);
  });
  test('linked but UNCREDENTIALED still offers Connect — config.json travels with the repo (B2)', () => {
    expect(row({ linkedHubCredentialed: false })).toBe(false);
  });
  test('an unrelated project keeps its Connect button', () => {
    expect(row({ projectUrl: 'https://dugmate.cloud.maude.sh' })).toBe(false);
  });
  test('unlinked folder: no row is Connected', () => {
    expect(row({ linkedHubUrl: null, linkedHubCredentialed: false })).toBe(false);
  });
  test('self-host addresses carry no project label — exact origin decides', () => {
    expect(
      row({
        projectUrl: 'http://127.0.0.1:8788',
        linkedHubUrl: 'http://127.0.0.1:8788',
        cloudUrl: 'http://127.0.0.1:8788',
      })
    ).toBe(true);
    // Two stubs on different ports are two different workspaces.
    expect(
      row({
        projectUrl: 'http://127.0.0.1:8788',
        linkedHubUrl: 'http://127.0.0.1:9999',
        cloudUrl: 'http://127.0.0.1:8788',
      })
    ).toBe(false);
  });
  test('a label on one side and none on the other never matches', () => {
    expect(row({ projectUrl: 'http://127.0.0.1:8788' })).toBe(false);
  });
});

describe('detach — the in-app unlink (fix 7 Disconnect)', () => {
  test('drops linkedHub + the hub credential, cycles the runtime to solo; idempotent', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const { mkdirSync, existsSync } = await import('node:fs');
    const repoRoot = join(scratch, 'detach-me');
    const designRoot = join(repoRoot, '.design');
    mkdirSync(designRoot, { recursive: true });
    const hubUrl = 'https://alligators.cloud.maude.sh';
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({ designRoot: '.design', linkedHub: { url: hubUrl, linkedAt: 1 } })
    );
    writeFileSync(
      join(scratch, 'hubs.json'),
      JSON.stringify({ hubs: { [hubUrl]: { token: 'mau_x', linkedAt: 1 } }, trusted: [hubUrl] })
    );

    const restarts: unknown[] = [];
    const api = createCloudEndpoints({
      paths: { repoRoot, designRoot },
      syncControl: {
        restart: async (linkedHub) => {
          restarts.push(linkedHub);
          return { syncing: false, canvases: 0, reason: 'unlinked' };
        },
      },
    });

    const r = await api.detach();
    expect(r.status).toBe(200);
    expect((r.json as { detached?: boolean }).detached).toBe(true);
    // The committed half is gone, the rest of config.json survives.
    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    expect(cfg.linkedHub).toBeUndefined();
    expect(cfg.designRoot).toBe('.design');
    // The credential + trust entry are gone too (the CLI unlink default).
    const hubs = JSON.parse(readFileSync(join(scratch, 'hubs.json'), 'utf8'));
    expect(hubs.hubs[hubUrl]).toBeUndefined();
    expect(hubs.trusted).not.toContain(hubUrl);
    // The runtime was cycled with the explicit unlink sentinel, not undefined.
    expect(restarts).toEqual([null]);
    expect(existsSync(join(designRoot, 'config.json'))).toBe(true);

    // Second detach: still ok, nothing to do.
    const again = await api.detach();
    expect(again.status).toBe(200);
    expect((again.json as { detached?: boolean }).detached).toBe(false);
  });
});

describe('localIdentityHint — only an exact, corroborated agreement is silent', () => {
  const CLOUD = 'https://cloud.maude.sh';

  test('the reported case warns: one project open, the link naming another', () => {
    // StudyFi open, "Open in Maude" pressed on alligators — one click from
    // syncing StudyFi's designs into somebody else's workspace.
    expect(
      localIdentityHint({ localProject: 'AI-StudyMate', cloudUrl: CLOUD, claimed: 'alligators' })
    ).toBe('mismatch');
  });

  test('a name an ATTACKER chose to look like yours does not buy silence', () => {
    // The whole point (attacker pass B1). The cloud project id is registerable by
    // anyone, so treating "contains your folder name" as agreement handed the
    // attacker the off-switch for the warning. And the server's 409 cannot help:
    // the claim and the actual project agree — it IS their project.
    for (const claimed of [
      'alligators-design-sync',
      'alligators-backup',
      'shared-alligators',
      'web-design-studio-app',
    ]) {
      expect(localIdentityHint({ localProject: 'alligators', cloudUrl: CLOUD, claimed })).not.toBe(
        'match'
      );
      expect(
        ['similar', 'mismatch'].includes(
          localIdentityHint({ localProject: 'alligators', cloudUrl: CLOUD, claimed })
        )
      ).toBe(true);
    }
  });

  test('an exact name is the only silent name-based verdict', () => {
    expect(
      localIdentityHint({ localProject: 'alligators', cloudUrl: CLOUD, claimed: 'alligators' })
    ).toBe('match');
    // Normalization still applies — casing and separators are not a difference.
    expect(
      localIdentityHint({ localProject: 'Alligators', cloudUrl: CLOUD, claimed: 'alligators' })
    ).toBe('match');
    // A near-match is its own state: alike, and still NOT the same workspace.
    expect(
      localIdentityHint({ localProject: 'alligators-web', cloudUrl: CLOUD, claimed: 'alligators' })
    ).toBe('similar');
  });

  test('a CREDENTIALED link to that project reads as linked', () => {
    expect(
      localIdentityHint({
        localProject: 'anything',
        linkedHubUrl: 'https://alligators.cloud.maude.sh',
        linkedHubCredentialed: true,
        cloudUrl: CLOUD,
        claimed: 'alligators',
      })
    ).toBe('linked');
  });

  test('an UNCREDENTIALED linkedHub cannot vouch for anyone', () => {
    // config.json is committed and travels with the repo, so a hostile template
    // could otherwise make the dialog say "already linked to <attacker>" — the
    // strongest reassurance it can give (attacker pass B2). Without a stored
    // credential it is ignored and the folder name decides.
    expect(
      localIdentityHint({
        localProject: 'my-thing',
        linkedHubUrl: 'https://attacker.cloud.maude.sh',
        linkedHubCredentialed: false,
        cloudUrl: CLOUD,
        claimed: 'attacker',
      })
    ).toBe('mismatch');
  });

  test('a folder credentialed to a DIFFERENT workspace warns', () => {
    expect(
      localIdentityHint({
        localProject: 'alligators',
        linkedHubUrl: 'https://someone-else.cloud.maude.sh',
        linkedHubCredentialed: true,
        cloudUrl: CLOUD,
        claimed: 'alligators',
      })
    ).toBe('mismatch');
  });

  test('a short generic folder name does not buy agreement by containment', () => {
    for (const localProject of ['web', 'app', 'src']) {
      expect(
        localIdentityHint({ localProject, cloudUrl: CLOUD, claimed: 'webshop-frontend' })
      ).toBe('mismatch');
    }
  });

  test('an accented or over-long folder name still matches its own workspace', () => {
    // The fold must mirror the platform's deriveProjectId (NFKD + strip + 40-cap)
    // or the warning fires on every LEGITIMATE connect for a whole class of
    // names — which is how a consent warning dies (attacker re-review).
    expect(
      localIdentityHint({ localProject: 'Zkušební tým', cloudUrl: CLOUD, claimed: 'zkusebni-tym' })
    ).toBe('match');
    expect(
      localIdentityHint({ localProject: 'Přátelé', cloudUrl: CLOUD, claimed: 'pratele' })
    ).toBe('match');
    // >40 chars: the platform truncates the id, so the fold must truncate too.
    const long = 'a-very-long-project-name-that-the-platform-truncates-at-forty';
    expect(
      localIdentityHint({ localProject: long, cloudUrl: CLOUD, claimed: long.slice(0, 40) })
    ).toBe('match');
  });

  test('no signal is "unknown", which warns — it must never read as agreement', () => {
    // Every stub and self-hoster is http://127.0.0.1:<port>, carrying no project
    // name. Before, that produced a reassuring neutral with a primary Connect;
    // on the launch path an unresolved status did the same (attacker pass B3).
    expect(
      localIdentityHint({
        localProject: '',
        linkedHubUrl: 'http://127.0.0.1:4599',
        cloudUrl: 'http://127.0.0.1:4599',
        claimed: 'stub-project',
      })
    ).toBe('unknown');
    // Status not yet resolved → unknown, whatever else is on hand.
    expect(
      localIdentityHint({
        localProject: 'alligators',
        cloudUrl: CLOUD,
        claimed: 'alligators',
        resolved: false,
      })
    ).toBe('unknown');
  });
});

describe('connectOutcomeNote — what the rail says after Connect', () => {
  test('no live payload yet: an in-flight state, not a claimed result', () => {
    // This used to assert "Syncing with alligators — 12 canvases." and a hover
    // pointing at the status bar. Both were wrong: the attach response reports
    // that `runtime.start()` did not throw, which is an INTENTION, and the slot
    // it sent people to was itself keying off `state` alone. See DDR-214 — the
    // sentence now derives from the live payload, and this is only the fallback
    // for the first render (and for a server too old to send one.)
    const n = connectOutcomeNote('alligators', { syncing: true, canvases: 12 });
    expect(n.text).toBe('Connecting to alligators — 12 canvases…');
    expect(n.title).toContain('updates as they settle');
    expect(n.text).not.toContain('hub sync');
    expect(connectOutcomeNote('alligators', { syncing: true, canvases: 1 }).text).toContain(
      '1 canvas…'
    );
  });

  test('linked but nothing syncable says so — and never claims a restart would help', () => {
    const n = connectOutcomeNote('alligators', {
      syncing: false,
      canvases: 0,
      reason: 'nothing-syncable',
      detail: 'no canvases found under .design.',
    });
    expect(n.text).toBe('Connected to alligators — nothing to sync yet.');
    expect(n.title).toContain('no canvases found');
    expect(n.text).not.toMatch(/restart/i);
  });

  test('any other refusal repeats the server’s own reason', () => {
    const n = connectOutcomeNote('alligators', {
      syncing: false,
      canvases: 0,
      reason: 'no-credential',
      detail: 'No sign-in for this workspace is stored on this machine yet.',
    });
    expect(n.text).toContain('No sign-in for this workspace');
    // Never the old sentence: there is no studio server a person can see.
    expect(n.text).not.toContain('studio server');
  });
});

describe('attachCode — the maude:// lane end to end (stubbed)', () => {
  test('a valid code links: hub credential stored, linkedHub written token-free', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const designRoot = join(scratch, '.design');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(join(designRoot, 'config.json'), '{}\n');

    const apiEndpoints = createCloudEndpoints({ paths: { repoRoot: scratch, designRoot } });
    const r = await apiEndpoints.attachCode(`mhc_${'a'.repeat(64)}`);
    expect(r.status).toBe(200);
    expect((r.json as any).ok).toBe(true);
    expect((r.json as any).project).toBe('stub-project');

    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    expect(cfg.linkedHub?.url).toContain('127.0.0.1');
    expect(JSON.stringify(cfg)).not.toContain('mau_stub_hub_token');

    // The exchange went to the CONFIGURED cloud address (this stub) — the
    // only /auth/handoff/exchange call seen is ours.
    expect(seen.filter((s) => s.includes('/auth/handoff/exchange')).length).toBe(1);
  });

  test('F2 — a link that names one project but opens another is refused, nothing linked', async () => {
    // The person confirmed a FAMILIAR name. If the exchange opens something
    // else, that consent was borrowed — refuse rather than point linkedHub at
    // whoever minted the code (validate 2026-07-30, defender F2).
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const designRoot = join(scratch, '.design-f2');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(join(designRoot, 'config.json'), '{}\n');

    const apiEndpoints = createCloudEndpoints({ paths: { repoRoot: scratch, designRoot } });
    const r = await apiEndpoints.attachCode(`mhc_${'a'.repeat(64)}`, 'a-project-i-trust');
    expect(r.status).toBe(409);
    expect((r.json as { error: string }).error).toContain('stub-project');

    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    expect(cfg.linkedHub).toBeUndefined();
  });

  test('F2 — a matching claim still links', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const designRoot = join(scratch, '.design-f2-ok');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(join(designRoot, 'config.json'), '{}\n');
    const apiEndpoints = createCloudEndpoints({ paths: { repoRoot: scratch, designRoot } });
    const r = await apiEndpoints.attachCode(`mhc_${'a'.repeat(64)}`, 'stub-project');
    expect(r.status).toBe(200);
  });

  test('linking STARTS syncing — the outcome is reported, not homework', async () => {
    // The bug this closes: the panel used to answer a successful Connect with
    // "restart the studio server to start syncing" — a task, naming a thing
    // the desktop user cannot see. The attach lane now cycles the runtime and
    // reports what happened.
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const designRoot = join(scratch, '.design-sync');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(join(designRoot, 'config.json'), '{}\n');

    const handed: unknown[] = [];
    const apiEndpoints = createCloudEndpoints({
      paths: { repoRoot: scratch, designRoot },
      syncControl: {
        restart: async (linkedHub) => {
          handed.push(linkedHub);
          return { syncing: true, canvases: 4 };
        },
      },
    });
    const r = await apiEndpoints.attachCode(`mhc_${'a'.repeat(64)}`);
    expect(r.status).toBe(200);
    expect((r.json as any).sync).toEqual({ syncing: true, canvases: 4 });
    expect((r.json as any).note).toBe('Linked — syncing 4 canvases.');

    // The supervisor is handed the value BY VALUE — the same object written to
    // config.json — so nothing that touches that committed file in between can
    // steer the socket.
    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    expect(handed).toEqual([cfg.linkedHub]);
  });

  test('a TSX opt-out survives a re-link — only the restrictive direction carries', async () => {
    // `syncTsx: false` means "do not upload canvas bodies to this hub"
    // (DDR-072/DDR-079). Re-linking used to overwrite linkedHub wholesale,
    // which silently re-enabled it — harmless while nothing synced until a
    // restart, a real disclosure now that Connect starts syncing immediately.
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const designRoot = join(scratch, '.design-opt-out');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({ linkedHub: { url: 'https://old.example', linkedAt: 1, syncTsx: false } })
    );

    const apiEndpoints = createCloudEndpoints({ paths: { repoRoot: scratch, designRoot } });
    const r = await apiEndpoints.attachCode(`mhc_${'a'.repeat(64)}`);
    expect(r.status).toBe(200);
    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    expect(cfg.linkedHub.syncTsx).toBe(false);
    expect(cfg.linkedHub.url).toContain('127.0.0.1');
    // No supervisor wired (a plain embedder): still linked, and the note says
    // what is left to do instead of claiming success.
    expect((r.json as any).sync.syncing).toBe(false);
    expect((r.json as any).note).toMatch(/Restart Maude/);
  });

  test('a malformed or dead code never reaches the network', async () => {
    const { createCloudEndpoints } = await import('../cloud/endpoints.ts');
    const apiEndpoints = createCloudEndpoints({
      paths: { repoRoot: scratch, designRoot: join(scratch, '.design') },
    });
    const before = seen.length;
    const r = await apiEndpoints.attachCode('not-a-code');
    expect(r.status).toBe(400);
    expect(seen.length).toBe(before);

    const dead = await apiEndpoints.attachCode(`mhc_${'b'.repeat(64)}`);
    expect(dead.status).toBe(410);
    expect((dead.json as any).error).toMatch(/works once/);
  });
});
