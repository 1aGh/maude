// S1.13 — restores (V2-1.9 §5.8): "Restore only <artboard>" (the splice: other artboards byte for byte,
// shared declarations kept AND listed, 409 reasons), one object by ElementRef / annotation id, Go back to
// lastGood (`_state/render-ok.json`), a version nobody kept (aside), each one a NEW version that ⌘Z undoes;
// who may restore (Can view / Can comment refused on the server) and the canvas-only no-oracle rule.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { readRenderOk, recordRenderOk } from '../history/last-good.ts';
import { restoreArtboard } from '../history/restore-artboard.ts';
import { parseObjectKey, restoreObject } from '../history/restore-object.ts';
import { createHistoryRoutes, type HistoryRuntime } from '../routes/history.ts';
import type { RouteSpec } from '../routes/table.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import { board as annBoard, sticky } from './fixtures/annotations-v2/boards.ts';

interface Parts {
  title?: string;
  badge?: string;
  jersey?: string;
  copy?: string;
  hero?: boolean;
}

function canvas(p: Parts = {}): string {
  const hero = `      <DCArtboard id="hero" label="Hero" width={100} height={100}>
        <Badge />
        <Jersey c="red" />
        <h1 data-cd-id="title">${p.title ?? 'Title'}</h1>
      </DCArtboard>
`;
  return `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

const Jersey = ({ c }: { c: string }) => <div className="${p.jersey ?? 'jersey'}">{c}</div>;

const Badge = () => <span className="hero-badge">${p.badge ?? 'NEW'}</span>;

export default function Board() {
  return (
    <DesignCanvas>
${p.hero === false ? '' : hero}      <DCArtboard id="away" label="Away" width={100} height={100}>
        <Jersey c="blue" />
        <p data-cd-id="copy">${p.copy ?? 'Copy'}</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
}

const rangeOf = (src: string, id: string): string => {
  const start = src.indexOf(`<DCArtboard id="${id}"`);
  const end = src.indexOf('</DCArtboard>', start) + '</DCArtboard>'.length;
  return start < 0 ? '' : src.slice(start, end);
};

// P8 missing-a: board 19 ("Every artboard moved to the trash") offers Restore N exactly when the canvas holds NO
// artboard — a canvas an AI run or a hand edit emptied. The splice found its place only beside a neighbour that is
// still there, so on that canvas every restore was refused (`invalid-result`) and the card's one button did nothing.
describe('restoring into a canvas with no artboard left', () => {
  const board = (inner: string, section: boolean) => `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function Board() {
  return (
    <DesignCanvas>
${section ? `      <DCSection id="main" title="Main">\n${inner}      </DCSection>\n` : inner}    </DesignCanvas>
  );
}
`;
  const hero = (pad: string) => `${pad}<DCArtboard id="hero" label="Hero" width={100} height={100}>
${pad}  <h1>Title</h1>
${pad}</DCArtboard>
`;
  const away = (pad: string) => `${pad}<DCArtboard id="away" label="Away" width={100} height={100}>
${pad}  <p>Copy</p>
${pad}</DCArtboard>
`;

  test('puts the artboard back inside the section that is left, byte for byte', () => {
    const old = board(hero('        ') + away('        '), true);
    const now = board('', true);
    const r = restoreArtboard('ui/Board.tsx', { html: now }, { html: old }, 'hero');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = r.lanes.html as string;
    expect(rangeOf(html, 'hero')).toBe(rangeOf(old, 'hero'));
    expect(html.indexOf('<DCArtboard id="hero"')).toBeGreaterThan(html.indexOf('<DCSection'));
    expect(html.indexOf('<DCArtboard id="hero"')).toBeLessThan(html.indexOf('</DCSection>'));
    expect(html).not.toContain('id="away"'); // only the one asked for
  });

  test('a canvas with no section either: the artboard goes inside the canvas', () => {
    const old = board(hero('      '), false);
    const r = restoreArtboard('ui/Board.tsx', { html: board('', false) }, { html: old }, 'hero');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rangeOf(r.lanes.html as string, 'hero')).toBe(rangeOf(old, 'hero'));
  });
});

describe('the one-artboard splice (restoreArtboard)', () => {
  const A = canvas({ title: 'Old title', badge: 'OLD', jersey: 'jersey-old' });
  const NOW = canvas({
    title: 'New title',
    badge: 'NEW',
    jersey: 'jersey-new',
    copy: 'Away copy 2',
  });

  test('the artboard and what only it uses come back; every other artboard is byte-identical', () => {
    const r = restoreArtboard('ui/a.tsx', { html: NOW }, { html: A }, 'hero');
    if (!r.ok) throw new Error(r.line);
    const html = r.lanes.html as string;
    expect(rangeOf(html, 'hero')).toBe(rangeOf(A, 'hero'));
    expect(rangeOf(html, 'away')).toBe(rangeOf(NOW, 'away'));
    // Badge is reached only by Hero → A's; Jersey is shared with Away → kept as now, and listed
    expect(html).toContain('<span className="hero-badge">OLD</span>');
    expect(html).toContain('className="jersey-new"');
    expect(r.sharedKept).toEqual(['Jersey']);
    expect(r.why).toBe(
      'Restores Hero as it was, as a new version. It uses parts other artboards share — Jersey — they stay as they are now.'
    );
    expect(r.label).toBe('Hero');
  });

  test('an artboard removed since goes back in A’s place; an id it never had is not-in-version', () => {
    const now = canvas({ hero: false, copy: 'Away copy 2' });
    const r = restoreArtboard('ui/a.tsx', { html: now }, { html: A }, 'hero');
    if (!r.ok) throw new Error(r.line);
    const html = r.lanes.html as string;
    expect(html.indexOf('id="hero"')).toBeGreaterThan(0);
    expect(html.indexOf('id="hero"')).toBeLessThan(html.indexOf('id="away"'));
    expect(rangeOf(html, 'away')).toBe(rangeOf(now, 'away'));
    const missing = restoreArtboard('ui/a.tsx', { html: NOW }, { html: A }, 'nope');
    expect(missing).toMatchObject({ ok: false, reason: 'not-in-version' });
  });

  test('a mapped family and a broken result are refused with the one line', () => {
    const fam = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
const items = [{ id: 'a' }, { id: 'b' }];
export default function F() {
  return (<DesignCanvas>{items.map((d) => <DCArtboard key={d.id} id={\`disc-\${d.id}\`} label="Disc" width={10} height={10}><p>x</p></DCArtboard>)}</DesignCanvas>);
}
`;
    const r = restoreArtboard('ui/f.tsx', { html: fam }, { html: fam }, 'disc-a');
    expect(r).toMatchObject({ ok: false, reason: 'family' });
    if (!r.ok)
      expect(r.line).toMatch(/^Can't restore only .+ — restore the whole canvas instead\.$/);
    const broken = restoreArtboard('ui/a.tsx', { html: NOW }, { html: 'export default (' }, 'hero');
    expect(broken).toMatchObject({ ok: false, reason: 'invalid-result' });
  });

  test('meta, annotations and CSS: this artboard’s entries become A’s, everything else stays now', () => {
    const meta = (hx: number, ax: number) =>
      `${JSON.stringify(
        {
          title: 'Board',
          futureKey: { keep: true },
          layout: {
            artboards: [
              { id: 'hero', x: hx, y: 0 },
              { id: 'away', x: ax, y: 0 },
            ],
          },
          artboardMeta: { hero: { note: `h${hx}` }, away: { note: `a${ax}` } },
        },
        null,
        2
      )}\n`;
    const ann = (heroText: string, awayText: string, extra = false) =>
      annBoard(
        { ...sticky('s-hero', heroText), parentArtboard: 'hero' },
        { ...sticky('s-away', awayText), parentArtboard: 'away' },
        ...(extra ? [{ ...sticky('s-new', 'added since'), parentArtboard: 'hero' }] : [])
      );
    const cssA = `.hero-badge { color: red; }\n\n.jersey { color: black; }\n`;
    const cssNow = `.hero-badge { color: blue; }\n\n.jersey { color: white; }\n`;
    const r = restoreArtboard(
      'ui/a.tsx',
      {
        html: NOW,
        meta: meta(500, 900),
        annotations: ann('now hero', 'now away', true),
        css: cssNow,
      },
      { html: A, meta: meta(0, 400), annotations: ann('old hero', 'old away'), css: cssA },
      'hero'
    );
    if (!r.ok) throw new Error(r.line);
    const m = JSON.parse(r.lanes.meta as string);
    expect(m.layout.artboards).toEqual([
      { id: 'hero', x: 0, y: 0 },
      { id: 'away', x: 900, y: 0 },
    ]);
    expect(m.artboardMeta).toEqual({ hero: { note: 'h0' }, away: { note: 'a900' } });
    expect(m.futureKey).toEqual({ keep: true });
    const els = JSON.parse(r.lanes.annotations as string).elements;
    expect(
      els
        .map((e: { id: string; text: string }) => [e.id, e.text])
        .sort(([x]: string[], [y]: string[]) => (x < y ? -1 : 1))
    ).toEqual([
      ['s-away', 'now away'],
      ['s-hero', 'old hero'],
    ]);
    expect(r.lanes.css).toBe(`.hero-badge { color: red; }\n\n.jersey { color: white; }\n`);
    expect(r.sharedKept).toEqual(['Jersey', '1 style']);
  });

  test('p95 ≤ 150 ms on a 60-artboard canvas', () => {
    const many = (tag: string) => {
      const abs = Array.from(
        { length: 60 },
        (_, i) =>
          `      <DCArtboard id="ab${i}" label="Board ${i}" width={100} height={100}>\n${Array.from(
            { length: 30 },
            (_, j) =>
              `        <div className="c${i}-${j}" data-cd-id="e${i}-${j}">${tag} ${i}.${j}</div>`
          ).join('\n')}\n      </DCArtboard>`
      ).join('\n');
      return `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\nexport default function M() {\n  return (\n    <DesignCanvas>\n${abs}\n    </DesignCanvas>\n  );\n}\n`;
    };
    const a = many('old');
    const n = many('new');
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = restoreArtboard('ui/m.tsx', { html: n }, { html: a }, 'ab30');
      times.push(performance.now() - t0);
      expect(r.ok).toBe(true);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length * 0.95) - 1] as number).toBeLessThan(150);
  });
});

describe('one object (restoreObject)', () => {
  test('a canvas element by ElementRef; one with no authored id at A is refused', () => {
    const A = canvas({ title: 'Old title', copy: 'Old copy' });
    const NOW = canvas({ title: 'New title', copy: 'New copy' });
    const key = parseObjectKey('hero/title');
    expect(key).toEqual({ kind: 'element', artboard: 'hero', id: 'title' });
    const r = restoreObject({ html: NOW }, { html: A }, key as NonNullable<typeof key>);
    if (!r.ok) throw new Error(r.line);
    expect(r.lanes.html).toBe(canvas({ title: 'Old title', copy: 'New copy' }));
    const none = restoreObject(
      { html: NOW },
      { html: A },
      { kind: 'element', artboard: 'hero', id: 'ghost' }
    );
    expect(none).toMatchObject({
      ok: false,
      reason: 'not-in-version',
      line: 'Restore the artboard instead.',
    });
  });

  test('an annotation element by id: its record back, the others untouched', () => {
    const A = annBoard(sticky('s1', 'old one'), sticky('s2', 'old two'));
    const NOW = annBoard(sticky('s1', 'new one'), sticky('s2', 'new two'));
    const r = restoreObject(
      { html: canvas(), annotations: NOW },
      { html: canvas(), annotations: A },
      { kind: 'annotation', id: 's1' }
    );
    if (!r.ok) throw new Error(r.line);
    const els = JSON.parse(r.lanes.annotations as string).elements;
    expect(els.map((e: { text: string }) => e.text)).toEqual(['old one', 'new two']);
  });
});

// ── the route over a real local home ──────────────────────────────────────────────────────

const claim = (c: AccessClaim) => resolveAccess(c);
const OBSERVER = claim({ v: 1, role: 'observer' });
const VIEWER = claim({ v: 1, role: 'viewer' });
const MEMBER = claim({ v: 1, role: 'member' });
const ONLY_A = claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });

// biome-ignore lint/suspicious/noExplicitAny: a test reads arbitrary answer JSON
type Body = Record<string, any>;

const homes: LocalHome[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function project() {
  const root = mkdtempSync(path.join(tmpdir(), 's113-restore-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = path.join(designRoot, 'ui', 'a.tsx');
  writeFileSync(file, canvas({ title: 'Old title', badge: 'OLD', copy: 'Old copy' }));
  writeFileSync(path.join(designRoot, 'ui', 'b.tsx'), canvas());
  const home = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_s113', name: 'Mac' },
    bootId: 'boot-s113',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(home);
  await home.ready();
  const edit = async (text: string) => {
    writeFileSync(file, text);
    home.observe('ui/a.tsx');
    await home.flush();
  };
  const head = async () =>
    (await home.runtime.acceptedHistory({ path: '.design/ui/a.tsx', limit: 1 }))[0];
  const read = () => readFileSync(file, 'utf8');
  let who = MEMBER;
  const specs = createHistoryRoutes({
    control: () => home.runtime as unknown as HistoryRuntime,
    designRel: '.design',
    designRoot,
    access: () => who,
  });
  const spec = specs.find(
    (s) => s.method === 'POST' && s.path === '/_api/project/restore'
  ) as RouteSpec;
  const restore = async (body: unknown, as = MEMBER) => {
    who = as;
    const text = JSON.stringify(body);
    const res = await spec.handle(
      new Request('http://localhost/_api/project/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(text.length) },
        body: text,
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  return { home, designRoot, edit, head, read, restore };
}

describe('POST /_api/project/restore — scoped restores land as ONE new version', () => {
  test('only Hero: Away is untouched, the action is a restore, and Undo puts Now back', async () => {
    const p = await project();
    const a = (await p.head())?.revision as number;
    const now = canvas({
      title: 'New title',
      badge: 'NEW',
      copy: 'New copy',
      jersey: 'jersey-new',
    });
    await p.edit(now);
    const r = await p.restore({ path: 'ui/a.tsx', at: `r${a}`, artboard: 'hero' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sharedKept: ['Jersey'] });
    expect(r.body.line).toMatch(/^Restored Hero to \d+ \w+, \d\d:\d\d$/);
    await p.home.flush();
    const disk = p.read();
    expect(rangeOf(disk, 'hero')).toContain('Old title');
    expect(rangeOf(disk, 'away')).toBe(rangeOf(now, 'away'));
    expect(disk).toContain('className="jersey-new"');
    expect(disk).toContain('<span className="hero-badge">OLD</span>');
    const row = await p.head();
    expect(row?.kind).toBe('restore');
    expect(row?.actionId).toBe(r.body.actionId);
    expect(row?.label).toBe(r.body.line);
    // the toast's Undo (⌘Z, V2-1.5 U16): one step back to Now
    const u = await p.home.runtime.acceptedUndo(r.body.actionId);
    expect(u.status).toBe('accepted');
    await p.home.flush();
    expect(p.read()).toBe(now);
  });

  test('409 with a reason and the line: a family, an artboard A never had', async () => {
    const p = await project();
    const a = (await p.head())?.revision as number;
    await p.edit(canvas({ title: 'Later' }));
    const r = await p.restore({ path: 'ui/a.tsx', at: `r${a}`, artboard: 'ghost' });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      ok: false,
      reason: 'not-in-version',
      line: "Can't restore only ghost — restore the whole canvas instead.",
    });
  });

  test('one object by ElementRef', async () => {
    const p = await project();
    const a = (await p.head())?.revision as number;
    await p.edit(canvas({ title: 'New title', badge: 'NEW', copy: 'New copy' }));
    const r = await p.restore({ path: 'ui/a.tsx', at: `r${a}`, element: 'hero/title' });
    expect(r.status).toBe(200);
    await p.home.flush();
    expect(p.read()).toBe(canvas({ title: 'Old title', badge: 'NEW', copy: 'New copy' }));
    expect((await p.head())?.kind).toBe('restore');
  });

  test('Go back: the version this Mac last drew, as a new version ("Went back to 14:05")', async () => {
    const p = await project();
    const good = canvas({ title: 'Drew fine' });
    await p.edit(good);
    recordRenderOk(p.designRoot, 'ui/a.tsx', good);
    expect(Object.keys(readRenderOk(p.designRoot))).toEqual(['ui/a.tsx']);
    await p.edit(canvas({ title: 'Throws at runtime' }));
    await p.edit(canvas({ title: 'Still throws' }));
    const r = await p.restore({ path: 'ui/a.tsx', at: '@last-good' });
    expect(r.status).toBe(200);
    expect(r.body.line).toMatch(/^Went back to \d\d:\d\d$/);
    await p.home.flush();
    expect(p.read()).toBe(good);
    expect((await p.head())?.label).toBe(r.body.line);
  });

  test('a version nobody kept: its body over Now', async () => {
    const p = await project();
    const kept = canvas({ title: 'The one I did not keep' });
    const aside = await p.home.runtime.acceptedAside('.design/ui/a.tsx', 'html', kept);
    expect(aside.status).toBe('accepted');
    const asideRev = (await p.head())?.revision as number;
    const r = await p.restore({ path: 'ui/a.tsx', at: `r${asideRev}` });
    expect(r.status).toBe(200);
    expect(r.body.line).toMatch(/^Restored your version from /);
    await p.home.flush();
    expect(p.read()).toBe(kept);
    expect((await p.head())?.kind).toBe('restore');
  });
});

describe('who may restore (§5.12)', () => {
  test('Can view and Can comment are refused on the server; nothing reaches the home', async () => {
    const p = await project();
    const a = (await p.head())?.revision as number;
    await p.edit(canvas({ title: 'Later' }));
    const before = (await p.head())?.revision;
    for (const who of [OBSERVER, VIEWER])
      for (const body of [
        { path: 'ui/a.tsx', at: `r${a}`, artboard: 'hero' },
        { path: 'ui/a.tsx', at: `r${a}`, element: 'hero/title' },
        { path: 'ui/a.tsx', at: '@last-good' },
        { path: 'ui/a.tsx', at: `r${a}` },
      ]) {
        const r = await p.restore(body, who);
        expect(r.status).toBe(403);
        expect(r.body).toEqual({ ok: false, reason: 'forbidden' });
      }
    expect((await p.head())?.revision).toBe(before);
  });

  test('canvas-only: a canvas not granted answers exactly like a missing one', async () => {
    const p = await project();
    const notGranted = await p.restore({ path: 'ui/b.tsx', at: 'r1', artboard: 'hero' }, ONLY_A);
    const missing = await p.restore({ path: 'ui/zzz.tsx', at: 'r1', artboard: 'hero' }, ONLY_A);
    expect(notGranted.status).toBe(403);
    expect(notGranted).toEqual(missing);
  });
});
