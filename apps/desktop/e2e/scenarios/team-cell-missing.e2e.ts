import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { $, browser, expect } from '@wdio/globals';

import { type LocalHub, startLocalHub } from '../fixtures/local-hub.mjs';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * P8 test round "missing-a" — three boards that need a SECOND person (or a cell that goes away), on the team-cell
 * lane: a cell-shaped local hub that owns a checkout, alice's studio at work, the designer's copy linked as bob.
 * Only runs under wdio.team-cell-missing.conf.ts.
 *
 *  05 · es-all-trashed   The Trash can't be emptied by one person ("A canvas keeps at least one artboard"), so two
 *      people race: the cell is away, alice moves three artboards to the trash and bob the fourth, bob's lands
 *      first (alice's studio is held until his is accepted). The canvas then has no artboard left on bob's Mac and
 *      the card says so: "LetakA6 has no artboards left." · "<who> moved all four to the trash <ago>." ·
 *      "Restore 4 artboards". Restore puts all four back.
 *
 *  12 · ia-missing       A picture alice holds and the cell does not: bob's Mac asks the cell and is told it is
 *      waiting for alice's device. The hub names the holder by the e-mail's local part and reports no Mac/PC kind
 *      yet (apps/hub asset-presence.mjs `presenceDeviceFor`), so the words are "Waiting for Alice's device".
 *      Alice's studio is held (SIGSTOP) so her own sweep cannot prune the report she made.
 *
 *  12 · ia-edges D       A photo dropped on the Assets tab while the cell is away is kept on this Mac ("Kept on this
 *      Mac — goes up by itself once it’s online."); when the cell is back it goes up by itself.
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

const LETAK = 'ui/LetakA6.tsx';
const ARTBOARDS = [
  ['flag-front', 'A · přední FLAG'],
  ['flag-back', 'B · zadní FLAG'],
  ['tackle-front', 'C · přední TACKLE'],
  ['tackle-back', 'D · zadní TACKLE'],
] as const;
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

const PICTURE = 'assets/7f3e21c4.png';
const GALLERY_SOURCE = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Gallery">
        <DCArtboard id="post" label="Post 4:5 · MVP" width={480} height={600}>
          <img src="${PICTURE}" alt="" style={{ width: 480, height: 432, objectFit: "cover" }} />
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

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 60_000) {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

async function statusWord(): Promise<{ status: string | null; text: string } | null> {
  return (await browser.execute(() => {
    const el = document.querySelector('[data-testid="share-cluster-status"]') as HTMLElement | null;
    if (!el) return null;
    const w = el.querySelector('.sh-saved-w') ?? el;
    return { status: el.getAttribute('data-status'), text: (w.textContent ?? '').trim() };
  })) as { status: string | null; text: string } | null;
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

async function startCell(c: Cell): Promise<void> {
  restarted = await startLocalHub({ dir: c.hubDir, port: c.hubPort, workspace: c.cellRepo });
  expect(restarted.http).toBe(c.hub);
}

/** A POST to bob's own studio, from the shell (same origin — what the app's own buttons do). */
async function bobPost(route: string, body: unknown): Promise<{ status: number; body: any }> {
  return (await browser.execute(
    (r: string, b: unknown) =>
      fetch(r, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      }).then(async (res) => {
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep the text */
        }
        return { status: res.status, body: parsed };
      }),
    route,
    body
  )) as { status: number; body: any };
}

async function bobGet(route: string): Promise<{ status: number; body: any }> {
  return (await browser.execute(
    (r: string) =>
      fetch(r, { cache: 'no-store' }).then(async (res) => {
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep the text */
        }
        return { status: res.status, body: parsed };
      }),
    route
  )) as { status: number; body: any };
}

/** The artboard items of the shared Trash that belong to LetakA6, as bob's studio lists them. */
async function letakTrash(): Promise<Array<{ artboard: string; who?: string; mine?: boolean }>> {
  const r = await bobGet('/_api/trash');
  const items = (r.body?.items ?? []) as Array<{
    kind?: string;
    path?: string;
    artboard?: string;
    who?: string;
    mine?: boolean;
  }>;
  return items
    .filter((i) => i.kind === 'artboard' && i.path === LETAK)
    .map((i) => ({ artboard: String(i.artboard), who: i.who, mine: i.mine }));
}

const ids = (src: string | null) =>
  [...(src ?? '').matchAll(/<DCArtboard\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
/** A real, valid w×h PNG of one colour — every colour a different file (the name is a fingerprint of the bytes). */
function png(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function findFile(root: string, base: string, depth = 6): string | null {
  if (depth < 0 || !existsSync(root)) return null;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(root, e.name);
    if (e.isFile() && e.name === base) return p;
    if (e.isDirectory()) {
      const f = findFile(p, base, depth - 1);
      if (f) return f;
    }
  }
  return null;
}

describe('team-cell-missing (native-desktop)', () => {
  let c: Cell;
  before(async function () {
    if (!CELL) this.skip();
    c = CELL as Cell;
    startReport('team-cell-missing (native-desktop) — the boards that need a second person or a cell that is away');
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch((error: unknown) =>
      console.warn(`[team-cell-missing] window pin failed: ${String(error)}`)
    );
  });

  after(() => {
    try {
      process.kill((CELL as Cell).teammatePid, 'SIGCONT');
    } catch {
      /* gone */
    }
    restarted?.stop();
  });

  it('05 · es-all-trashed: alice trashes three, bob the fourth while the cell is away — bob sees no artboard left, and Restore 4 puts them back', async () => {
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-welcome')).waitForDisplayed({ timeout: 120_000 });
    // the four-artboard canvas is alice's; it reaches bob's copy through the cell
    mkdirSync(join(c.teammate, '.design', 'ui'), { recursive: true });
    writeFileSync(join(c.teammate, '.design', LETAK), LETAK_SOURCE);
    writeFileSync(join(c.teammate, '.design', 'ui', 'LetakA6.meta.json'), LETAK_META);
    await eventually(
      'LetakA6 in the designer’s copy',
      () => ids(read(join(c.designer, '.design', LETAK))).length === 4,
      180_000
    );
    await eventually('Saved', async () => (await statusWord())?.status === 'saved', 120_000);
    const row = await canvasRow('canvas-row-ui-LetakA6');
    await row.waitForDisplayed({ timeout: 60_000 });
    await row.click();
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 60_000 });
    await capture('05-letak-open-four-boards');

    // ── the cell goes away; both keep working ──
    await stopCell(c);
    const aliceOp = await fetch(`http://127.0.0.1:${c.teammatePort}/_api/edit-op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: LETAK,
        op: 'artboard.trash',
        targets: [],
        params: { artboards: ['flag-front', 'flag-back', 'tackle-front'] },
      }),
    });
    const aliceBody = await aliceOp.text();
    console.log(`[team-cell-missing] alice trashes A-C offline: ${aliceOp.status} ${aliceBody.slice(0, 300)}`);
    expect(aliceOp.status).toBe(200);
    // alice's studio now waits (stopped) — so bob's change is the one the cell takes first
    process.kill(c.teammatePid, 'SIGSTOP');

    const bobOp = await bobPost('/_api/edit-op', {
      file: LETAK,
      op: 'artboard.trash',
      targets: [],
      params: { artboards: ['tackle-back'] },
    });
    console.log(`[team-cell-missing] bob trashes D offline: ${bobOp.status} ${JSON.stringify(bobOp.body).slice(0, 300)}`);
    expect(bobOp.status).toBe(200);
    // a single teammate cannot empty the canvas — the guard is real
    const third = await bobPost('/_api/edit-op', {
      file: LETAK,
      op: 'artboard.trash',
      targets: [],
      params: { artboards: ['flag-front', 'flag-back', 'tackle-front'] },
    });
    console.log(`[team-cell-missing] bob alone trashes the rest: ${third.status} ${JSON.stringify(third.body).slice(0, 200)}`);
    expect(third.status).toBe(400);
    expect(String(third.body?.message ?? third.body)).toContain('A canvas keeps at least one artboard.');
    await capture('05-bob-trashed-d-offline');

    // ── the cell is back; bob lands first ──
    await startCell(c);
    await eventually(
      'bob’s trash accepted by the cell',
      async () => (await letakTrash()).some((i) => i.artboard === 'tackle-back'),
      180_000
    );
    process.kill(c.teammatePid, 'SIGCONT');
    await eventually(
      'alice’s three accepted after bob’s',
      async () => (await letakTrash()).length === 4,
      240_000
    );
    await eventually(
      'no artboard left in the designer’s copy',
      () => ids(read(join(c.designer, '.design', LETAK))).length === 0,
      120_000
    );

    // ── what the board draws ──
    const card = await $(tid('all-trashed'));
    await card.waitForDisplayed({ timeout: 90_000 });
    const text = (await card.getText()).replace(/\s+/g, ' ').trim();
    console.log(`[team-cell-missing] the card: ${text}`);
    expect(await card.getAttribute('data-count')).toBe('4');
    expect(text).toContain('LetakA6 has no artboards left.');
    expect(text).toMatch(/\S+ moved all four to the trash (just now|\d+ min ago)\./);
    expect(text).toContain('every earlier version is in Version history too.');
    const restore = await $(tid('all-trashed-restore'));
    expect((await restore.getText()).trim()).toBe('Restore 4 artboards');
    await capture('05-es-all-trashed');

    await restore.click();
    await card.waitForExist({ reverse: true, timeout: 60_000 });
    await eventually(
      'the four artboards back in the designer’s copy',
      () => ids(read(join(c.designer, '.design', LETAK))).length === 4,
      120_000
    );
    expect((await letakTrash()).length).toBe(0);
    await capture('05-es-all-trashed-restored');
  });

  it('12 · ia-missing: a picture alice holds and the cell does not reads "Waiting for Alice’s device" — quiet, not Missing', async () => {
    // alice's canvas that places the picture; the cell is up again
    writeFileSync(join(c.teammate, '.design', 'ui', 'Gallery.tsx'), GALLERY_SOURCE);
    await eventually(
      'Gallery in the designer’s copy',
      () => (read(join(c.designer, '.design', 'ui', 'Gallery.tsx')) ?? '').includes(PICTURE),
      180_000
    );
    // alice's device is away from now on: held, so her own sweep can't take the report back
    try {
      process.kill(c.teammatePid, 'SIGSTOP');
    } catch {
      /* already held */
    }
    const hubs = JSON.parse(
      read(join(dirname(c.teammate), 'teammate-cfg', 'hubs.json')) ?? '{}'
    ) as { hubs?: Record<string, { token?: string }> };
    const token = hubs.hubs?.[c.hub]?.token;
    expect(typeof token).toBe('string');
    // what her sweep says on every pass: "this Mac holds these" (asset-state.ts reportHeld) — her real token
    const report = await fetch(`${c.hub}/_asset-probe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        paths: [PICTURE],
        held: true,
        sweep: { id: 'e2e-alice-1', final: true },
      }),
    });
    expect(report.status).toBe(200);
    expect(((await report.json()) as { present: string[] }).present).toEqual([]); // the cell has no bytes

    const gallery = await canvasRow('canvas-row-ui-Gallery');
    await gallery.waitForDisplayed({ timeout: 60_000 });
    await gallery.click();
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 60_000 });

    let answer: { status: number; body: any } = { status: 0, body: null };
    await eventually(
      'the shell’s asset-state says waiting',
      async () => {
        answer = await bobGet(`/_api/asset-state?rel=${encodeURIComponent(PICTURE)}`);
        const item = (answer.body?.items ?? [])[0];
        return item?.state === 'waiting' && !!item?.who;
      },
      120_000
    );
    console.log(`[team-cell-missing] asset-state: ${JSON.stringify(answer.body)}`);
    const item = answer.body.items[0];
    expect(item.state).toBe('waiting'); // never "missing": a device still holds it
    expect(String(item.who.name).toLowerCase()).toBe('alice'); // a display name, never an address
    expect(String(item.who.name)).not.toContain('@');
    expect(item.who.kind).toBeNull(); // the hub reports no Mac / PC kind yet — the words say "device"
    expect(item.who.self).toBe(false);
    await capture('12-ia-missing-canvas');

    // the Inspector's box for the selected picture: the one status word, what is safe, and Relink… only for a copy
    const box = await $(tid('asset-absent-box'));
    const shown = await box.isExisting();
    if (shown) {
      expect(await box.getAttribute('data-state')).toBe('waiting');
      expect((await (await $(tid('asset-absent-word'))).getText()).trim()).toBe(
        "Waiting for Alice's device"
      );
      await capture('12-ia-missing-inspector');
    } else {
      console.log('[team-cell-missing] the picture is not selected: the Inspector box is not drawn');
    }
  });

  it('12 · ia-edges D: a photo dropped while the cell is away is kept on this Mac, and goes up by itself once it is online', async () => {
    try {
      process.kill(c.teammatePid, 'SIGCONT');
    } catch {
      /* gone */
    }
    await stopCell(c);
    await eventually(
      'the offline word',
      async () => /^Offline/.test((await statusWord())?.text ?? ''),
      120_000
    );
    expect((await statusWord())?.text).toBe('Offline — kept on this Mac');
    await (await $(tid('panel-tab-assets'))).click();
    const panel = await $(tid('assets-panel'));
    await panel.waitForExist({ timeout: 15_000 });

    const bytes = png(8, 8, [200, 30, 60]);
    const b64 = bytes.toString('base64');
    const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    await browser.execute((data: string) => {
      const raw = atob(data);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'huddle-offline.png', { type: 'image/png' }));
      const el = document.querySelector('[data-testid="assets-panel"]') as HTMLElement;
      for (const type of ['dragenter', 'dragover', 'drop'])
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, b64);

    let said = '';
    await eventually(
      'the line for the arrival',
      async () => {
        said = (await browser.execute(() =>
          Array.from(document.querySelectorAll('[data-testid^="notice-"]'))
            .map((n) => (n.textContent ?? '').trim())
            .join(' | ')
        )) as string;
        return /Kept on this Mac/.test(said);
      },
      60_000
    );
    console.log(`[team-cell-missing] toast: ${said}`);
    expect(said).toContain('Kept on this Mac — goes up by itself once it’s online.');
    await capture('12-ia-edges-d-offline');
    // it is on this Mac's disk, under its fingerprint name
    const mine = findFile(join(c.designer, '.design', 'assets'), `${sha8}.png`);
    console.log(`[team-cell-missing] sha8=${sha8} on disk: ${mine}`);
    expect(mine).not.toBeNull();

    // the cell is back: it goes up by itself
    await startCell(c);
    await eventually(
      'the photo at the cell',
      () => findFile(c.cellRepo, `${sha8}.png`) !== null || findFile(c.hubDir, `${sha8}.png`) !== null,
      240_000
    );
    await eventually('Saved', async () => (await statusWord())?.status === 'saved', 120_000);
    await capture('12-ia-edges-d-online');
  });
});
