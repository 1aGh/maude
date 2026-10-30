import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { type LocalHub, startLocalHub } from '../fixtures/local-hub.mjs';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * P8 G1b-3 — a designer's copy linked to a CELL-shaped hub (workspace mode: it owns a checkout and keeps the
 * file journal), with a teammate's studio as the second person. Only runs under wdio.team-cell.conf.ts.
 *
 *   0. the project opens with the teammate's canvas; a file travels both ways THROUGH the cell's checkout
 *      (the file door accepts writes here — on team-project's plain hub it answers 405)
 *  13. 06 ad-edge-sync: the cell asks to wait (429) — what waits, that it is safe, Try now; the facts one fold
 *      down; the word beside the faces stays Syncing…; when the ceiling lifts everything goes up and it is Saved
 */
const tid = (s: string) => `[data-testid="${s}"]`;

const CELL = process.env.MAUDE_E2E_TEAM_CELL
  ? (JSON.parse(process.env.MAUDE_E2E_TEAM_CELL) as {
      hub: string;
      hubPid: number;
      hubDir: string;
      hubPort: number;
      cellRepo: string;
      teammate: string;
      teammatePort: number;
      teammatePid: number;
      designer: string;
    })
  : null;
type Cell = NonNullable<typeof CELL>;

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 60_000) {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

/** The Share cluster's save word (CONTRACT §6): its kind, its exact words, and whether it is a control. */
async function statusWord(): Promise<{
  status: string | null;
  text: string;
  control: boolean;
} | null> {
  return (await browser.execute(() => {
    const el = document.querySelector('[data-testid="share-cluster-status"]') as HTMLElement | null;
    if (!el) return null;
    const w = el.querySelector('.sh-saved-w') ?? el;
    return {
      status: el.getAttribute('data-status'),
      text: (w.textContent ?? '').trim(),
      control: !!el.closest('button, [role="button"], a[href]'),
    };
  })) as { status: string | null; text: string; control: boolean } | null;
}

async function hubAnswers(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

/** The cell this spec restarted (same dir, port, tokens, checkout); stopped in `after`. */
let restarted: LocalHub | null = null;

async function stopCell(c: Cell): Promise<void> {
  if (restarted) {
    restarted.stop();
    restarted = null;
  } else {
    try {
      process.kill(c.hubPid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await eventually('the cell to stop answering', async () => !(await hubAnswers(c.hub)), 30_000);
}

async function startCell(c: Cell, extraArgs: string[] = []): Promise<void> {
  restarted = await startLocalHub({
    dir: c.hubDir,
    port: c.hubPort,
    workspace: c.cellRepo,
    extraArgs,
  });
  expect(restarted.http).toBe(c.hub);
}

describe('team-cell (native-desktop)', () => {
  before(async function () {
    if (!CELL) this.skip();
    startReport(
      'team-cell (native-desktop) — a linked copy on a cell-shaped hub, a teammate as the second person'
    );
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch((error: unknown) =>
      console.warn(`[team-cell] window pin failed: ${String(error)}`)
    );
  });

  after(() => {
    restarted?.stop();
  });

  it('0 · the copy opens with the teammate’s canvas; a file travels both ways through the cell’s checkout', async () => {
    const c = CELL as Cell;
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-welcome')).waitForDisplayed({ timeout: 120_000 });
    await eventually(
      'the welcome canvas in the designer’s copy',
      () =>
        (read(join(c.designer, '.design', 'ui', 'welcome.tsx')) ?? '').includes('Welcome, team'),
      120_000
    );
    await eventually('Saved', async () => (await statusWord())?.status === 'saved', 120_000);
    await capture('00-cell-copy-open');

    mkdirSync(join(c.teammate, '.design', 'notes'), { recursive: true });
    writeFileSync(join(c.teammate, '.design', 'notes', 'from-alice.md'), '# From Alice\n');
    await eventually(
      'the teammate’s note in the cell’s checkout',
      () => existsSync(join(c.cellRepo, '.design', 'notes', 'from-alice.md')),
      120_000
    );
    await eventually(
      'the teammate’s note in the designer’s copy',
      () => existsSync(join(c.designer, '.design', 'notes', 'from-alice.md')),
      120_000
    );
    mkdirSync(join(c.designer, '.design', 'notes'), { recursive: true });
    writeFileSync(join(c.designer, '.design', 'notes', 'from-bob.md'), '# From Bob\n');
    await eventually(
      'the designer’s note at the teammate',
      () => existsSync(join(c.teammate, '.design', 'notes', 'from-bob.md')),
      120_000
    );
    await capture('01-cell-files-both-ways');
  });

  it('13 · ad-edge-sync: the cell asks to wait (429) — what waits, that it is safe, Try now; the facts one fold down', async () => {
    const c = CELL as Cell;
    await stopCell(c);
    await startCell(c, ['--asset-write-rate-limit', '1']);
    await eventually(
      'Saved on the limited cell',
      async () => (await statusWord())?.status === 'saved',
      180_000
    );
    const notes = join(c.designer, '.design', 'notes');
    mkdirSync(notes, { recursive: true });
    for (let i = 1; i <= 4; i++)
      writeFileSync(
        join(notes, `p8-g1b-${i}.md`),
        `# Note ${i}\n\nWritten while the cell asks to wait.\n`
      );

    const callout = await $(tid('callout-sync-stuck'));
    await callout.waitForDisplayed({ timeout: 180_000 });
    const text = await callout.getText();
    expect(text).toMatch(/[1-9]\d* changes? (is|are) waiting to reach the cloud\./);
    expect(text).toContain(
      "They're safe on this Mac. The cloud is busy and asked to wait — the next try is in"
    );
    expect((await (await $(tid('callout-sync-stuck-action'))).getText()).trim()).toBe('Try now');
    const word = await statusWord();
    await capture('25-sync-stuck-callout');
    await (await $(tid('callout-sync-stuck-fold-toggle'))).click();
    await (await $(tid('callout-sync-stuck-row-reply'))).waitForDisplayed({ timeout: 10_000 });
    expect(await (await $(tid('callout-sync-stuck-row-reply'))).getText()).toContain(
      '429 · rate limited'
    );
    expect(await (await $(tid('callout-sync-stuck-row-hub'))).getText()).toContain(
      new URL(c.hub).host
    );
    expect(await (await $(tid('callout-sync-stuck-row-next'))).isExisting()).toBe(true);
    const files = await browser.execute(() =>
      [...document.querySelectorAll('[data-testid^="callout-sync-stuck-file-"]')].map(
        (e) => e.textContent ?? ''
      )
    );
    expect(files.some((f) => /notes\/p8-g1b-\d\.md/.test(f))).toBe(true);
    await capture('26-sync-stuck-fold');
    // the status beside the faces keeps a CONTRACT §6 word — Syncing… (the board), never Saved while files wait
    if (word?.status !== 'syncing') {
      const st = await browser.execute(() =>
        fetch('/_sync-status')
          .then((r) => r.json())
          .then((j) => {
            const { files, docs, state, queuedOps, assets, conflicts } = j ?? {};
            const f = files ? { ...files, delivery: undefined } : files;
            return JSON.stringify({ state, queuedOps, docs, files: f, assets, conflicts }).slice(
              0,
              3000
            );
          })
      );
      console.log(`[team-cell] sync status while the callout shows: ${st}`);
    }
    expect(word).toEqual({ status: 'syncing', text: 'Syncing…', control: false });
    await (await $(tid('callout-sync-stuck-action'))).click();

    // the ceiling lifts: everything goes up, the callout leaves, the word is Saved
    await stopCell(c);
    await startCell(c);
    await callout.waitForExist({ reverse: true, timeout: 180_000 });
    await eventually(
      'the notes in the cell’s checkout',
      () =>
        [1, 2, 3, 4].every((i) =>
          existsSync(join(c.cellRepo, '.design', 'notes', `p8-g1b-${i}.md`))
        ),
      180_000
    );
    await eventually(
      'the notes at the teammate',
      () => existsSync(join(c.teammate, '.design', 'notes', 'p8-g1b-4.md')),
      120_000
    );
    await eventually('Saved', async () => (await statusWord())?.status === 'saved', 120_000);
    await capture('27-sync-stuck-cleared');
  });
});
