// The cloud-managed posture, widened — feature-cloud-managed-git-posture.
//
// DDR-218 withdrew the working-tree half of the Changes panel when the cell
// commits this project. It withdrew the OFFER and not the machinery: the app
// went on polling `/_api/git/status`, probing the remote, badging the tree, and
// pointing History at the local repo — a repo that, in this posture, has no
// commits at all. The panel therefore said "Cloud is saving" and "No saved
// versions yet" in the same breath.
//
// Source-level, in the `cloud-managed-save-surfaces.test.ts` house style: what
// these pin is exactly what would regress — a poll re-added ungated, the loader
// choice migrating into the panel, or a "tidy-up" disabling the ONE local-git
// mechanism that must stay live.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(import.meta.dir, '..');
const APP = readFileSync(join(STUDIO, 'client', 'app.jsx'), 'utf8');
const PANEL = readFileSync(join(STUDIO, 'client', 'panels', 'GitPanel.jsx'), 'utf8');
const HTTP = readFileSync(join(STUDIO, 'http.ts'), 'utf8');
const ENDPOINTS = readFileSync(join(STUDIO, 'cloud', 'endpoints.ts'), 'utf8');

describe('the loader is chosen ONCE, where the posture is named', () => {
  test('the call site swaps it; the panel never re-derives it', () => {
    // The project's accepted history comes first when the project has one
    // (DDR-241, T27); the Git posture is still chosen at this one place.
    expect(APP).toContain('return (cloudManaged ? gitLoadCloudLog : gitLoadLog)(path);');
    expect(APP).toContain(
      "historySource={projectHistoryOn ? 'project' : cloudManaged ? 'cloud' : 'local'}"
    );
    // The panel may READ the source, never compute it from `cloudManaged` —
    // that would be the second derivation the posture constant exists to stop.
    expect(PANEL).toContain("const cloudHistorySource = historySource === 'cloud';");
    expect(PANEL).not.toMatch(/historySource\s*=\s*cloudManaged/);
  });

  test('the cloud loader talks to the loopback proxy, never to a hub directly', () => {
    expect(APP).toContain("'/_api/cloud/history?limit=40'");
    // No hub URL, and therefore no token, anywhere in the client.
    expect(APP).not.toContain('getHubToken');
  });

  test('a failed load is reported, not rendered as an empty history', () => {
    // Collapsing "could not reach" into "nothing saved yet" IS the bug.
    expect(APP).toMatch(/if \(!r\.ok\) return null;/);
    expect(PANEL).toContain('const [logFailed, setLogFailed] = useState(false);');
    expect(PANEL).toContain('setLogFailed(entries == null);');
    expect(PANEL).toContain('data-testid="git-history-unreachable"');
    expect(PANEL).toContain('data-testid="git-history-retry"');
  });

  test('the cloud empty state never offers the Save this posture withdrew', () => {
    expect(PANEL).toContain('The cloud is saving this project');
    // The old copy must still exist for the LOCAL branch — and only there.
    expect(PANEL).toContain("Save a version and it'll show up here.");
  });

  test('the header names the cloud project, falling back to the hub host', () => {
    expect(PANEL).toContain(
      'const headerProject = cloudHistorySource\n    ? (cloudHistory?.project ?? cloudHistory?.hubHost ?? null)\n    : project;'
    );
  });
});

describe('while cloud-managed, the desktop runs NO local git of its own', () => {
  test('the mount status fetch is gated, and reacts live', () => {
    // Reactive on the posture, not mount-only: Connect must stop it and
    // Disconnect must resume it, both without a reload.
    expect(APP).toMatch(/if \(savingIsManaged\) \{\n\s*\/\/[\s\S]*?setGitStatus\(null\);/);
    expect(APP).toMatch(/\}, \[savingIsManaged\]\);/);
  });

  test('both refreshers refuse in that posture', () => {
    const refreshers = APP.match(
      /const refresh(GitStatus|RemoteSync) = useCallback\(async \(\) => \{[\s\S]{0,600}?\n {2}\}, \[\]\);/g
    );
    expect(refreshers?.length).toBe(2);
    for (const fn of refreshers ?? []) expect(fn).toContain('savingIsManagedRef.current');
  });

  test('the remote ahead/behind probe stops AND clears its last answer', () => {
    // A stale ahead/behind would otherwise outlive the link and keep the
    // "Get latest" nudge on a remote this project has nothing to do with.
    expect(APP).toMatch(/if \(savingIsManaged\) \{[\s\S]{0,400}?setRemoteSync\(null\);/);
    expect(APP).toContain(
      '}, [savingIsManaged, gitStatus?.repo, changesOpen, refreshRemoteSync]);'
    );
  });

  test('the WS push is gated too — otherwise it re-populates what the polls stopped', () => {
    expect(APP).toContain('if (!savingIsManagedRef.current) setGitStatus(m.payload);');
  });

  test('the tree M/A/D badges are withdrawn — the same claim, one row at a time', () => {
    expect(APP).toMatch(/if \(savingIsManaged\) return m;/);
    expect(APP).toContain('}, [gitStatus, savingIsManaged]);');
  });

  test('the drafts switcher is withdrawn — a branch switch moves a HEAD the cell has never seen', () => {
    // The BRANCH half is withdrawn; the project half stays (plan T22 — a
    // managed project still needs the way to another project).
    expect(APP).toContain('projectOnly={savingIsManaged}');
    const SWITCHER = readFileSync(
      join(STUDIO, 'client', 'panels', 'RepoBranchSwitcher.jsx'),
      'utf8'
    );
    expect(SWITCHER).toContain('if (native && status && (!status.repo || projectOnly)) {');
    expect(SWITCHER).toContain('if (!status?.repo || projectOnly) return null;');
    expect(APP).toContain('savingIsManaged={savingIsManaged}');
  });

  test('the posture is declared above every effect that names it', () => {
    // A dependency array evaluates during render, so a `const` below its first
    // consumer is a temporal-dead-zone ReferenceError at boot, not a warning.
    const declared = APP.indexOf('const savingIsManaged = cellManaged || cloudManaged;');
    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThan(APP.indexOf("fetch('/_api/git/status')"));
    expect(declared).toBeLessThan(APP.indexOf('const dirtyByPath = useMemo'));
  });
});

describe('what must NOT be withdrawn', () => {
  test('the git-lifecycle watcher stays live — it is correctness, not a save surface', () => {
    // DDR-051: a terminal `git checkout` flushes into Yjs and reloads the open
    // canvases. Disabling it would silently desync anyone who uses git in a
    // terminal — precisely the workflow DDR-218 promised would survive. A
    // NEGATIVE assertion, so a future tidy-up cannot quietly add the gate.
    const handler = APP.slice(APP.indexOf("m.type === 'git-lifecycle'"));
    const body = handler.slice(0, handler.indexOf('}\n        } catch {}'));
    expect(body).toContain('setGitLifecycle(m.payload);');
    expect(body).not.toContain('savingIsManaged');
  });

  test('nothing touches .git — no hook, no config write', () => {
    for (const src of [APP, HTTP, ENDPOINTS]) {
      expect(src).not.toMatch(/\.git\/hooks/);
      expect(src).not.toMatch(/core\.hooksPath/);
    }
  });

  test('the local /_api/git/* routes keep exactly their old gates', () => {
    // "Presentation, not a control" (DDR-218) is KEPT, not reversed: what stops
    // is Maude's own polling, not the user's ability to use git.
    expect(HTTP).toContain("'/_api/git/status': async (req: Request) => {");
    expect(HTTP).toContain("'/_api/git/log': async (req: Request) => {");
    expect(HTTP).not.toContain('savingIsManaged');
  });
});

describe('the new network surface', () => {
  test('the studio route carries BOTH mandatory guards', () => {
    const route = HTTP.slice(HTTP.indexOf("'/_api/cloud/history':"));
    const body = route.slice(0, route.indexOf('\n    },'));
    expect(body).toContain("if (!sameOriginRead(req)) return new Response('cross-origin rejected'");
    expect(body).toContain('if (!isTrustedRequestHost(req))');
    expect(body).toContain("if (req.method !== 'GET')");
  });

  test('it is in NEITHER canvas allowlist (DDR-088 — it proxies a credential)', () => {
    const safe = HTTP.slice(HTTP.indexOf('const CANVAS_SAFE_API = new Set(['));
    expect(safe.slice(0, safe.indexOf('])')).includes('/_api/cloud/history')).toBe(false);
    const canvasRoutes = HTTP.slice(HTTP.indexOf('function startCanvasServer'));
    expect(canvasRoutes.includes("'/_api/cloud/history'")).toBe(false);
  });

  test('a hub 401 is a plain read failure — it must never delete the credential', () => {
    // `/_api/cloud/status`'s 401 path calls `signout()` (confused-deputy F6).
    // A History poll is not that authority: a cell restarting mid-renewal would
    // otherwise silently unlink a working project.
    const fetchFn = ENDPOINTS.slice(ENDPOINTS.indexOf('async function hubFetch('));
    const body = fetchFn.slice(0, fetchFn.indexOf('\n  }\n'));
    expect(body).not.toContain('signout');
    expect(body).not.toContain('deleteHubCredential');
  });

  test('the token and the hub error body never leave the server', () => {
    // Assert the PROPERTY, not the line — the re-review's closing note was that
    // these pins caught the letter and not the behaviour, and this one broke on
    // the very fix it should have been indifferent to. A non-2xx must produce
    // no body and no text; a bare status code is fine, the cell's message never is.
    const fn = ENDPOINTS.slice(ENDPOINTS.indexOf('async function hubFetch('));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect(body).toContain('if (!res.ok) return { ok: false');
    expect(body).not.toMatch(/if \(!res\.ok\)[\s\S]{0,120}await res\.(text|json)/);
    // The token reaches exactly one place: the Authorization header.
    expect((ENDPOINTS.match(/hub\.token/g) ?? []).length).toBe(1);
    expect(APP).not.toContain('Bearer');
  });

  test('an uncredentialed link makes no network call at all', () => {
    expect(ENDPOINTS).toContain(
      "if (!hub) return { status: 200, json: { ok: false, reason: 'not-linked' } };"
    );
    expect(ENDPOINTS).toContain('if (!linked?.credentialed) return null;');
  });

  test('the sha is validated on the desktop too, not only on the hub', () => {
    // It reaches the preview route from the UNTRUSTED canvas origin (DDR-054);
    // "the other end checks it" is how a guard ends up on neither end. Pin the
    // GUARD, not the whole statement — the failure branch changed shape once
    // already (it now reports a reason so a caller can tell absence from an
    // outage), and this assertion should survive that.
    const fn = ENDPOINTS.slice(ENDPOINTS.indexOf('async historyFile('));
    const body = fn.slice(0, fn.indexOf('\n    },'));
    expect(body).toContain('[0-9a-f]{7,40}');
    // The guard must come FIRST — before the path, the link, or any fetch.
    expect(body.indexOf('[0-9a-f]{7,40}')).toBeLessThan(body.indexOf('hubFetch'));
  });
});

describe('the version preview resolves a cloud-only sha', () => {
  test('local first, then the cell, with the cache key unchanged', () => {
    const fn = HTTP.slice(HTTP.indexOf('async function serveHistoricalCanvas('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain(': await gitShowFile(ctx.paths.repoRoot, sha, repoRel);');
    expect(body).toContain('await cloudHistoryApi(ctx).historyFile(sha, repoRel);');
    // Historical content is immutable, so a cloud-sourced build must cache
    // under the identical key a local one would have.
    expect(body).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting SOURCE text, not interpolating.
      'const key = `${absPath}\\0${sha}\\0${RUNTIME_BOOT_ID}\\0${CHROME_EPOCH}`;'
    );
  });

  test('the build budget still gates the miss path, and misses are remembered', () => {
    const fn = HTTP.slice(HTTP.indexOf('async function serveHistoricalCanvas('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // The limiter must stay ABOVE the lookups (the recorded DoS invariant) —
    // now guarding a network round trip as well as a git process.
    expect(body.indexOf('historicalBuildAllowed()')).toBeLessThan(body.indexOf('gitShowFile'));
    expect(body).toContain('historicalMissCache.has(key)');
    expect(body).toContain('historicalMissCache.add(key);');
  });

  test('the posture is asked of the module that owns it, not re-derived', () => {
    // `historyFile` already answers null unless the folder is linked AND
    // credentialed — which IS the cloud-managed condition.
    expect(HTTP).not.toMatch(/serveHistoricalCanvas[\s\S]{0,2000}?credentialed/);
  });
});
