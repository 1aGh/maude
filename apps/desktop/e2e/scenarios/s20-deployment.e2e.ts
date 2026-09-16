import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * S20 — the invited designer, on a deployment that is actually live.
 *
 * The scenario spec keeps one cell that no fixture can answer: "invite → open
 * → edit → undo → quit → reopen on actual upgraded initial deployments", with
 * the exact build and protocol recorded. `team-project.e2e.ts` proves the same
 * door against a hub it starts itself; this one proves it against a hub
 * somebody's team is using, running the release that was just shipped.
 *
 *   1. first run offers the invited-project door — no token, no folder, no Git
 *   2. server + email + password opens the project's own copy, and the
 *      project's real canvases arrive
 *   3. the designer's own work reaches the deployment: a new canvas, then an
 *      edit to it, each accepted as a revision the hub will serve back
 *   4. personal undo takes back the designer's LAST action and leaves the
 *      first one standing — the product's own Undo button, on their own action
 *   5. quit and reopen: the app returns to the project by itself, and what
 *      survived the undo survived the restart
 *   6. the designer removes what they made; the deployment is as it was
 *
 * Only runs under wdio.s20-deployment.conf.ts, which requires an explicit
 * target (MAUDE_S20_HUB / _EMAIL / _PASSWORD). It writes into a real project,
 * so everything it creates lives under one clearly named throwaway path and
 * step 6 removes it.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

const S20 = process.env.MAUDE_E2E_S20
  ? (JSON.parse(process.env.MAUDE_E2E_S20) as {
      hub: string;
      email: string;
      password: string;
      label: string;
      appDir: string;
      scratch: string;
    })
  : null;

/**
 * One throwaway canvas, named so nobody mistakes it for the team's work, and
 * placed INSIDE a declared canvas group — a file at the design root is not a
 * canvas of the project and would never travel.
 */
const REL = 'ui/s20-release-check.tsx';

const canvas = (
  title: string
) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Release check">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 120_000) {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 1_000,
    timeoutMsg: `timed out: ${what}`,
  });
}

/**
 * Settle entry animations — WKWebView does not advance a CSS animation while
 * its window is occluded, so a dialog that fades in stays "not displayed".
 */
async function settleMotion() {
  await browser.execute(() => {
    if (document.getElementById('e2e-settle-motion')) return;
    const s = document.createElement('style');
    s.id = 'e2e-settle-motion';
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.append(s);
  });
}

/**
 * The credential the sign-in minted, read back out of the designer's own
 * (isolated) hub file. Used to ask the deployment what it actually holds —
 * the app's disk is not evidence that the hub accepted anything.
 */
function designerToken(hub: string): string {
  const raw = read(process.env.HUBS_CONFIG_PATH ?? '') ?? '{}';
  const parsed = JSON.parse(raw) as { hubs?: Record<string, { token?: string }> };
  const key = Object.keys(parsed.hubs ?? {}).find((k) => k.replace(/\/$/, '') === hub);
  const token = key ? parsed.hubs?.[key]?.token : '';
  if (!token) throw new Error(`no minted credential for ${hub} in the designer's hub file`);
  return token;
}

async function hubGet<T>(hub: string, path: string): Promise<T> {
  const r = await fetch(`${hub}/api/projects/current/v1/${path}`, {
    headers: { authorization: `Bearer ${designerToken(hub)}` },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

type Doc = {
  doc?: string;
  path?: string;
  retired?: boolean;
  lanes?: Record<string, { hash?: string }>;
};
type Manifest = { docs?: Doc[] | Record<string, Doc | null>; revision?: number };

function docList(m: Manifest): Doc[] {
  const raw = m.docs;
  const all = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return all.filter((d): d is Doc => !!d && !d.retired);
}

async function hubDocs(hub: string): Promise<string[]> {
  return docList(await hubGet<Manifest>(hub, 'bootstrap'))
    .map((d) => d.path ?? '')
    .filter(Boolean);
}

/**
 * What the deployment would hand a peer for this document's source lane.
 *
 * Addressed by the document's own id and its head hash out of the manifest —
 * `path` is the name a person sees and `doc` is the identity the store keys
 * on, and the first attempt at this scenario asked for a lane by path and got
 * nothing back.
 */
async function hubHtml(hub: string, path: string): Promise<string> {
  const doc = docList(await hubGet<Manifest>(hub, 'bootstrap')).find((d) => d.path === path);
  const hash = doc?.lanes?.html?.hash;
  if (!hash) return '';
  const blob = await hubGet<{ body?: string }>(hub, `blobs/${hash}`);
  return blob.body ?? '';
}

/**
 * The managed copy the app made for THIS project — nobody chose a folder.
 *
 * Keyed by the hub it is linked to, not by being first in the directory: the
 * e2e bundle id accumulates a copy per run, and picking any of them made the
 * first attempt at this scenario assert against a hub that was long gone.
 */
function findManagedCopy(appDir: string, hub: string): string | null {
  const root = join(appDir, 'projects');
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const cfg = join(root, name, '.design', 'config.json');
    if (!existsSync(cfg)) continue;
    try {
      const parsed = JSON.parse(readFileSync(cfg, 'utf8')) as { linkedHub?: { url?: string } };
      if (String(parsed.linkedHub?.url ?? '').replace(/\/$/, '') === hub) return join(root, name);
    } catch {
      /* a copy mid-write is not this one */
    }
  }
  return null;
}

describe('s20-deployment (native-desktop)', () => {
  let copy = '';
  let mine = '';

  before(async function () {
    if (!S20) this.skip();
    startReport(`S20 — an invited designer works on ${S20?.label ?? 'the deployment'}`);
    await browser.setTimeout({ script: 60_000 });
    await (browser as unknown as { tauri?: { switchWindow(label: string): Promise<void> } }).tauri
      ?.switchWindow('main')
      .catch((error: unknown) => console.warn(`[s20] window pin failed: ${String(error)}`));
  });

  it('1 · first run offers the invited-project door', async () => {
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    const door = await $(tid('ob-door-team'));
    await door.waitForDisplayed({ timeout: 180_000 });
    expect(await door.getText()).toContain('invited');
    await capture('01-first-run-team-door');
    await door.click();
    await (await $(tid('team-projects'))).waitForDisplayed({ timeout: 15_000 });
    await capture('02-team-projects');
  });

  it('2 · email + password opens the real project’s own copy', async () => {
    const t = S20 as NonNullable<typeof S20>;
    await (await $(tid('team-hub-url'))).setValue(t.hub);
    await (await $(tid('team-hub-email'))).setValue(t.email);
    await (await $(tid('team-hub-password'))).setValue(t.password);
    await (await $(tid('team-hub-open'))).click();
    // The shell switches the sidecar and the webview reloads onto the project.
    await browser.pause(6_000);
    await waitForSidecar();
    // A real project's checkout takes as long as it takes.
    await (await $(tid('canvas-list'))).waitForDisplayed({ timeout: 300_000 });
    await eventually(
      'the project’s canvases in the list',
      async () => (await $$(`${tid('canvas-list')} [data-testid^="canvas-row-"]`)).length > 0,
      300_000
    );
    await capture('03-project-open-with-canvases');

    await eventually('the managed copy for this deployment on disk', () => {
      copy = findManagedCopy(t.appDir, t.hub) ?? '';
      return copy !== '';
    });
    mine = join(copy, '.design', REL);
    const cfg = JSON.parse(read(join(copy, '.design', 'config.json')) ?? '{}');
    expect(String(cfg.linkedHub?.url ?? '').replace(/\/$/, '')).toBe(t.hub);
    // The password was never written anywhere; only the minted credential.
    const hubs = read(process.env.HUBS_CONFIG_PATH ?? '') ?? '';
    expect(hubs).toContain(t.hub);
    expect(hubs).not.toContain(t.password);

    // Record what this actually ran against — the S20 cell asks for it.
    const boot = await hubGet<{ protocol?: number; projectId?: string; revision?: number }>(
      t.hub,
      'bootstrap'
    );
    const health = (await (await fetch(`${t.hub}/health`)).json()) as {
      version?: string;
      coordinator?: Record<string, unknown>;
    };
    console.log(
      `[s20] deployment=${t.label} version=${health.version} protocol=${boot.protocol} ` +
        `project=${boot.projectId} coordinator=${JSON.stringify(health.coordinator)}`
    );
    expect(boot.protocol).toBe(1);
  });

  it('3 · the designer’s work reaches the deployment', async () => {
    const t = S20 as NonNullable<typeof S20>;
    // Action one: a canvas that did not exist.
    writeFileSync(mine, canvas('Release check — first'));
    await eventually('the new canvas on the deployment', async () =>
      (await hubDocs(t.hub)).includes(REL)
    );
    await capture('04-new-canvas-accepted');

    // Action two: an edit to it, a beat later so the two are separate actions.
    await browser.pause(2_500);
    writeFileSync(mine, canvas('Release check — edited'));
    await eventually('the edit on the deployment', async () =>
      (await hubHtml(t.hub, REL)).includes('Release check — edited')
    );
    await capture('05-edit-accepted');
  });

  it('4 · personal undo takes back the designer’s last action, and only that one', async () => {
    const t = S20 as NonNullable<typeof S20>;
    // History is per active canvas: make the throwaway one active first.
    const row = await $(`[data-testid^="canvas-row-"][data-testid$="s20-release-check"]`);
    await row.waitForDisplayed({ timeout: 60_000 });
    await row.click();
    await settleMotion();
    // ⌘⇧G, not the status-bar chip: that chip renders only when the project is
    // a Git repository, and a managed team copy is not one — so on the very
    // surface S20 is about, the shortcut and the View menu are the way in.
    await browser.keys(['Meta', 'Shift', 'g']);
    await (await $(tid('git-panel'))).waitForDisplayed({ timeout: 30_000 });

    // The designer's own actions carry an Undo button; a teammate's do not.
    // Take the HIGHEST revision: the panel is a list of this canvas's whole
    // history, so "the first Undo button on the page" is whichever action the
    // ordering happens to put first — on a canvas with earlier actions that is
    // not the one just made, and the undo lands somewhere nobody asked for.
    let latest = -1;
    await eventually('an Undo button on the designer’s own action', async () => {
      const buttons = await $$('[data-testid^="project-history-undo-"]');
      for (const b of buttons) {
        const id = (await b.getAttribute('data-testid')) ?? '';
        const rev = Number.parseInt(id.replace('project-history-undo-', ''), 10);
        if (Number.isSafeInteger(rev) && rev > latest) latest = rev;
      }
      return latest >= 0;
    });
    await capture('06-history-with-own-undo');
    await (await $(tid(`project-history-undo-${latest}`))).click();

    // The edit is taken back; the canvas the first action created stays.
    await eventually('the edit undone in the designer’s copy', () => {
      const body = read(mine) ?? '';
      return body.includes('Release check — first') && !body.includes('edited');
    });
    await eventually('the canvas still on the deployment after the undo', async () =>
      (await hubDocs(t.hub)).includes(REL)
    );
    await eventually('the undo on the deployment', async () =>
      (await hubHtml(t.hub, REL)).includes('Release check — first')
    );
    await capture('07-undo-applied');
  });

  it('5 · quit and reopen: the app comes back to the project on its own', async () => {
    const t = S20 as NonNullable<typeof S20>;
    await browser.reloadSession();
    await (browser as unknown as { tauri?: { switchWindow(label: string): Promise<void> } }).tauri
      ?.switchWindow('main')
      .catch(() => {});
    await waitForSidecar();
    // No door, no folder picker: the project is simply there again.
    await (await $(tid('canvas-list'))).waitForDisplayed({ timeout: 300_000 });
    await eventually(
      'the throwaway canvas after the restart',
      async () =>
        (await $$(`[data-testid^="canvas-row-"][data-testid$="s20-release-check"]`)).length > 0,
      120_000
    );
    expect(read(mine) ?? '').toContain('Release check — first');
    expect(read(mine) ?? '').not.toContain('edited');
    await capture('08-reopened-state-survived');
    expect((await hubDocs(t.hub)).includes(REL)).toBe(true);
  });

  it('6 · the designer removes what they made, and the project is as it was', async function () {
    const t = S20 as NonNullable<typeof S20>;
    // Nothing was made if sign-in never got that far — do not report a clean
    // project as evidence of a cleanup that had nothing to clean.
    if (!mine) this.skip();

    // Deleting the FILE is not deleting the canvas: the deployment holds the
    // document and puts the file back, which is what should happen when an
    // editor or a stray `rm` removes one. Removal is a deliberate action, so
    // the designer takes it in the product — the row's own delete control.
    // Its confirmation is a native `window.confirm`, outside the DOM and
    // outside WebDriver's reach in this shell; answering it here is the only
    // accommodation in this scenario.
    await browser.execute(() => {
      window.confirm = () => true;
    });
    const row = await $(`[data-testid^="canvas-row-"][data-testid$="s20-release-check"]`);
    await row.waitForDisplayed({ timeout: 60_000 });
    await row.moveTo();
    // The row IS a <button>, so its delete control cannot be nested inside it —
    // it is a sibling in the row wrapper. Pick it out of the tree's delete
    // controls by the canvas it names.
    let del: WebdriverIO.Element | null = null;
    await eventually(
      'the delete control for the throwaway canvas',
      async () => {
        for (const b of await $$('[aria-label^="Delete canvas"]')) {
          const label = (await b.getAttribute('aria-label')) ?? '';
          if (label.toLowerCase().includes('s20-release-check')) {
            del = b as unknown as WebdriverIO.Element;
            return true;
          }
        }
        return false;
      },
      30_000
    );
    await (del as unknown as WebdriverIO.Element).click();
    await eventually('the throwaway canvas retired on the deployment', async () =>
      (await hubDocs(t.hub)).every((p) => p !== REL)
    );
    expect(existsSync(mine)).toBe(false);
    await capture('09-cleaned-up');
    console.log(`[s20] removed ${REL} from ${t.label}`);
  });
});
