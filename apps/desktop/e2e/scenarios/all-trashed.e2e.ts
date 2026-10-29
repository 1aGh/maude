import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 05 es-all-trashed — "Every artboard moved to the trash". A canvas that holds no artboard and whose Trash holds its
 * artboards shows ONE card: "<canvas> has no artboards left." · who moved them and when · "Restore N artboards".
 * The UI refuses to remove the last artboard, and two people racing do not produce the state either (the later save
 * is held — see team-cell-missing.e2e.ts), so the card is reached the way it really is: some artboards go to the
 * Trash through the edit-op and the last one leaves the file by hand (an editor, a pull, an AI run).
 * Restore puts all of them back (S1.13's splice; with no neighbour left it places them in the canvas's section).
 * A local project, no hub: the sync plane has no say in this one. Only runs under wdio.all-trashed.conf.ts.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const ROOT = process.env.MAUDE_E2E_ALL_TRASHED_ROOT ?? '';
const LETAK = 'ui/LetakA6.tsx';
const CANVAS = join(ROOT, '.design', LETAK);
const ARTBOARDS = [
  ['flag-front', 'A · přední FLAG'],
  ['flag-back', 'B · zadní FLAG'],
  ['tackle-front', 'C · přední TACKLE'],
  ['tackle-back', 'D · zadní TACKLE'],
] as const;

const read = (p: string): string | null => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const ids = (src: string | null) =>
  [...(src ?? '').matchAll(/<DCArtboard\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 60_000) {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

async function api(route: string, body?: unknown): Promise<{ status: number; body: any }> {
  return (await browser.execute(
    (r: string, b: unknown) =>
      fetch(r, {
        method: b === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
        cache: 'no-store',
      }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) })),
    route,
    body
  )) as { status: number; body: any };
}
const bobPost = (route: string, body: unknown) => api(route, body);

async function letakTrash(): Promise<Array<{ artboard: string }>> {
  const r = await api('/_api/trash');
  return ((r.body?.items ?? []) as Array<{ kind?: string; path?: string; artboard?: string }>)
    .filter((i) => i.kind === 'artboard' && i.path === LETAK)
    .map((i) => ({ artboard: String(i.artboard) }));
}

const LETAK_SOURCE = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Leták A6">
${ARTBOARDS.map(
  ([id, label]) => `        <DCArtboard id="${id}" label="${label}" width={180} height={254}>
          <h1 style={{ padding: 16, fontFamily: "system-ui", color: "#111" }}>${label}</h1>
        </DCArtboard>`
).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;
const LETAK_META = `${JSON.stringify(
  {
    title: 'LetakA6',
    sections: [
      {
        id: 'main',
        title: 'Leták A6',
        artboards: ARTBOARDS.map(([id, label]) => ({ id, label, width: 180, height: 254 })),
      },
    ],
    css_mode: 'inline',
    layout: { artboards: ARTBOARDS.map(([id], i) => ({ id, x: i * 210, y: 0 })) },
  },
  null,
  2
)}\n`;

describe('es-all-trashed (native-desktop, local project)', () => {
  before(async () => {
    startReport('es-all-trashed — the card for a canvas with no artboard left');
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch(() => undefined);
  });

  it('05 · es-all-trashed: a canvas with no artboard left shows the card; Restore puts the trashed ones back where they were', async () => {
    // ── board 19: the canvas holds no artboard and the Trash holds its artboards ──
    // Bob moves three of four to the trash (one stays: the guard), then the last one leaves the file by hand — the way
    // an AI run, a text editor or a pull removes it: not an edit-op, so the Trash has no item for it.
    await waitForSidecar();
    // the canvas arrives as a file on this Mac (a pull, a text editor, an AI run): the watcher picks it up
    mkdirSync(dirname(CANVAS), { recursive: true });
    writeFileSync(CANVAS, LETAK_SOURCE);
    writeFileSync(CANVAS.replace(/\.tsx$/, '.meta.json'), LETAK_META);
    const row = await canvasRow('canvas-row-ui-letaka6');
    await row.waitForDisplayed({ timeout: 60_000 });
    await row.click();
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 60_000 });
    await capture('05-letak-open-four-boards');
    const more = await bobPost('/_api/edit-op', {
      file: LETAK,
      op: 'artboard.trash',
      targets: [],
      params: { artboards: ['flag-back', 'tackle-front', 'tackle-back'] },
    });
    expect(more.status).toBe(200);
    await eventually(
      'three artboards of LetakA6 in the Trash',
      async () => (await letakTrash()).length === 3,
      120_000
    );
    writeFileSync(
      CANVAS,
      LETAK_SOURCE.replace(/ {8}<DCArtboard[\s\S]*<\/DCArtboard>\n/, '')
    );
    expect(ids(read(CANVAS))).toEqual([]);
    await browser.pause(2_000); // the watcher takes the file

    const card = await $(tid('all-trashed'));
    await card.waitForDisplayed({ timeout: 90_000 });
    const text = (await card.getText()).replace(/\s+/g, ' ').trim();
    console.log(`[all-trashed] the card: ${text}`);
    expect(await card.getAttribute('data-count')).toBe('3');
    expect(text).toContain('LetakA6 has no artboards left.');
    expect(text).toMatch(/(You|\S+) moved all three to the trash (just now|\d+ min ago)\./);
    expect(text).toContain('every earlier version is in Version history too.');
    const restore = await $(tid('all-trashed-restore'));
    expect((await restore.getText()).trim()).toBe('Restore 3 artboards');
    await browser.pause(1_500); // the outlines (canvas side) follow the card
    await capture('05-es-all-trashed');

    await restore.click();

    await card.waitForExist({ reverse: true, timeout: 60_000 });
    await eventually(
      'the three artboards back in this Mac',
      () => ids(read(CANVAS)).length === 3,
      120_000
    );
    expect((await letakTrash()).length).toBe(0);
    await capture('05-es-all-trashed-restored');
  });
});
