// #14 (2.0.5) — a canvas's `.css` twin across a restart.
//
// The report: after edits made on disk while the studio was closed, five canvases showed "changed
// here and in the cloud" on the css lane, and "theirs" was an older copy of the same person's own
// css — nothing had run concurrently. Reproduced with the rig (`trash-sync-repro.mjs --scenario css
// --css-offline`, both Macs): a css save the studio could not deliver (offline, or quit before the
// answer) waits in the outbox; the next start's drain has it accepted, and the cold start then
// judged the closed-studio css edit against the css BEFORE that save — refused, its own save on
// the other side. The html lane has had `ownAccepted` for exactly this since F3 S14; css had
// nothing. And Keep mine answered only the html: the css stayed held, the project kept the other
// css, the notice went — and came back after the next restart.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { acceptedColdStart } from '../sync/accepted-cold-start.ts';
import { applyCssToDoc, applyHtmlToDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type LaneProposal,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { readRecoveryBody } from '../sync/source-recovery.ts';

const REMOTE = { remote: true };
const SRC = `export default () => (\n  <DesignCanvas>\n    <DCArtboard id="a" width={180} height={254}><h1>a</h1></DCArtboard>\n  </DesignCanvas>\n);\n`;
const SRC_EDITED = SRC.replace('<h1>a</h1>', '<h1>a edited</h1>');
const css = (c: string) => `.flag { color: ${c}; }\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'v2-205-css-twin-'));
  mkdirSync(join(dir, 'ui'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => ({
  html: join(dir, 'ui', 'flag.tsx'),
  css: join(dir, 'ui', 'flag.css'),
  comments: join(dir, '_comments', 'ui-flag.json'),
  annotations: join(dir, 'ui', 'flag.annotations.json'),
  meta: join(dir, 'ui', 'flag.meta.json'),
});
const historyDir = () => join(dir, '_history', 'ui-flag');
const publish = (doc: Y.Doc, html: string, c: string) =>
  doc.transact(() => {
    applyHtmlToDoc(doc, html, REMOTE);
    applyCssToDoc(doc, c, REMOTE);
  }, REMOTE);
const settle = () => new Promise((r) => setTimeout(r, 30));
const diskCss = () => readFileSync(paths().css, 'utf8');
const fsEvt = (p: string) => {
  const t = readFileSync(p, 'utf8');
  return { path: p, bytes: new TextEncoder().encode(t), hash: hashBytes(t) };
};

function studio(doc: Y.Doc) {
  const sent: Array<{ p: LaneProposal; answer: (o: ProposalOutcome) => void }> = [];
  let n = 0;
  const link: AcceptedLaneLink = {
    on: () => true,
    newTransactionId: () => `tx_${++n}`,
    propose: (p) => new Promise<ProposalOutcome>((answer) => sent.push({ p, answer })),
  };
  const conflicts: unknown[] = [];
  let recoveredCalls = 0;
  const projection = createDocProjection({
    slug: 'ui-flag',
    doc,
    paths: paths(),
    flushMs: 0,
    historyDir: historyDir(),
    accepted: link,
    waitForReconcile: true,
    onConflict: (c) => conflicts.push(c),
    onRecovered: () => {
      recoveredCalls++;
    },
  });
  projection.start();
  return { projection, sent, conflicts, recovered: () => recoveredCalls };
}

const coldStart = (
  s: ReturnType<typeof studio>,
  doc: Y.Doc,
  o: { ownAcceptedCss?: string | null } = {}
) =>
  acceptedColdStart({
    slug: 'ui-flag',
    doc,
    paths: paths(),
    rel: 'ui/flag.tsx',
    inProject: true,
    projection: s.projection,
    historyDir: historyDir(),
    wasAccepted: async () => false,
    createDoc: async () => ({ status: 'accepted' }),
    log: { log() {}, warn() {} },
    ...o,
  });

/** The canvas in the project and on disk at red, agreed (a first boot on it). */
async function agreedAtRed() {
  writeFileSync(paths().html, SRC);
  writeFileSync(paths().css, css('red'));
  const doc = new Y.Doc();
  publish(doc, SRC, css('red'));
  const s = studio(doc);
  await coldStart(s, doc);
  s.projection.reconcile();
  await settle();
  return { doc, s };
}

const cssVerdict = (r: Awaited<ReturnType<typeof acceptedColdStart>>) =>
  r.kind === 'reconciled' ? r.verdicts.find((v) => v.lane === 'css') : undefined;

describe('#14 — the css twin keeps its base across a restart', () => {
  test('a css save the drain had accepted is the base of the css edited while the studio was closed', async () => {
    const { s } = await agreedAtRed();
    // blue was saved, but its answer never came in that run (offline / quit): it stays in the outbox
    writeFileSync(paths().css, css('blue'));
    s.projection.applyFromFs(fsEvt(paths().css));
    await settle();
    expect(s.sent[0]?.p).toMatchObject({ lane: 'css', content: css('blue') });
    s.projection.stop();

    // studio closed: green on disk. The next start's drain has blue accepted first.
    writeFileSync(paths().css, css('green'));
    writeFileSync(paths().html, SRC_EDITED);
    const doc2 = new Y.Doc();
    publish(doc2, SRC, css('blue'));
    const b = studio(doc2);
    const r = await coldStart(b, doc2, { ownAcceptedCss: css('blue') });
    b.projection.reconcile();
    await settle();
    expect(cssVerdict(r)).toMatchObject({ decision: 'propose', base: css('blue') });
    expect(b.sent.find((x) => x.p.lane === 'css')?.p).toMatchObject({
      content: css('green'),
      baseContent: css('blue'),
    });
    expect(b.conflicts).toHaveLength(0);
    expect(diskCss()).toBe(css('green'));
    b.projection.stop();
  });

  test('the drained css on disk is agreed, and the older replica css is never written over it', async () => {
    const { s } = await agreedAtRed();
    s.projection.stop();
    writeFileSync(paths().css, css('blue'));
    // the drain had blue accepted; the replica still shows red (its publication is on the way)
    const doc2 = new Y.Doc();
    publish(doc2, SRC, css('red'));
    const b = studio(doc2);
    const r = await coldStart(b, doc2, { ownAcceptedCss: css('blue') });
    b.projection.reconcile();
    await settle();
    expect(cssVerdict(r)?.decision).toBe('agreed');
    expect(diskCss()).toBe(css('blue'));
    expect(b.conflicts).toHaveLength(0);
    expect(readRecoveryBody(historyDir(), paths().css, 'base')).toBe(css('blue'));
    // a save made before the publication arrives is based on blue, not on red
    writeFileSync(paths().css, css('green'));
    b.projection.applyFromFs(fsEvt(paths().css));
    await settle();
    expect(b.sent.find((x) => x.p.lane === 'css')?.p).toMatchObject({
      content: css('green'),
      baseContent: css('blue'),
    });
    b.projection.stop();
  });

  test('an accepted css save is the base on record at its answer (the studio may close before the publication)', async () => {
    const { s } = await agreedAtRed();
    writeFileSync(paths().css, css('blue'));
    s.projection.applyFromFs(fsEvt(paths().css));
    await settle();
    s.sent[0]?.answer({ status: 'accepted', actionId: 'act_1' });
    await settle();
    // closed before the publication of blue reached this replica
    s.projection.stop();
    expect(readRecoveryBody(historyDir(), paths().css, 'base')).toBe(css('blue'));

    writeFileSync(paths().css, css('green'));
    const doc2 = new Y.Doc();
    publish(doc2, SRC, css('blue'));
    const b = studio(doc2);
    const r = await coldStart(b, doc2);
    b.projection.reconcile();
    await settle();
    expect(cssVerdict(r)).toMatchObject({ decision: 'propose', base: css('blue') });
    expect(b.conflicts).toHaveLength(0);
    b.projection.stop();
  });
});

describe('#14 — a held css conflict is the canvas’s conflict until the css is answered', () => {
  test('an accepted html save does not clear the notice while the css twin is held', async () => {
    const { doc, s } = await agreedAtRed();
    // a real conflict: both lanes changed here, the css refused (a peer's css won)
    writeFileSync(paths().css, css('green'));
    writeFileSync(paths().html, SRC_EDITED);
    s.projection.applyFromFs(fsEvt(paths().css));
    s.projection.applyFromFs(fsEvt(paths().html));
    await settle();
    const cssTx = s.sent.find((x) => x.p.lane === 'css');
    const htmlTx = s.sent.find((x) => x.p.lane === 'html');
    publish(doc, SRC, css('purple'));
    cssTx?.answer({ status: 'rejected', code: 'base-conflict', head: hashBytes(css('purple')) });
    await settle();
    expect(s.conflicts.length).toBeGreaterThan(0);
    const before = s.recovered();
    publish(doc, SRC_EDITED, css('purple'));
    htmlTx?.answer({ status: 'accepted', actionId: 'act_h' });
    await settle();
    expect(s.recovered()).toBe(before);
    expect(s.projection.conflictSides()).not.toBeNull();
    expect(s.projection.heldCss()).toEqual({ mine: css('green'), theirs: css('purple') });
    s.projection.stop();
  });

  test('Keep mine for the css: proposed on top of theirs, cleared, and the base on record for the next restart', async () => {
    const { doc, s } = await agreedAtRed();
    writeFileSync(paths().css, css('green'));
    s.projection.applyFromFs(fsEvt(paths().css));
    await settle();
    publish(doc, SRC, css('purple'));
    s.sent[0]?.answer({
      status: 'rejected',
      code: 'base-conflict',
      head: hashBytes(css('purple')),
    });
    await settle();
    const sides = s.projection.heldCss();
    expect(sides).toEqual({ mine: css('green'), theirs: css('purple') });
    const kept = s.projection.proposeLane('css', sides?.mine as string, {
      baseContent: sides?.theirs as string,
    });
    await settle();
    expect(s.sent[1]?.p).toMatchObject({
      lane: 'css',
      content: css('green'),
      baseContent: css('purple'),
    });
    s.sent[1]?.answer({ status: 'accepted', actionId: 'act_mine' });
    expect((await kept)?.status).toBe('accepted');
    await settle();
    expect(s.projection.heldCss()).toBeNull();
    expect(s.projection.conflictSides()).toBeNull();
    s.projection.stop();

    // restart: the project holds mine; no conflict comes back
    const doc2 = new Y.Doc();
    publish(doc2, SRC, css('green'));
    const b = studio(doc2);
    const r = await coldStart(b, doc2);
    b.projection.reconcile();
    await settle();
    expect(cssVerdict(r)?.decision).toBe('agreed');
    expect(b.conflicts).toHaveLength(0);
    b.projection.stop();
  });

  test('Take theirs for the css: the project’s css returns to disk and the hold ends', async () => {
    const { doc, s } = await agreedAtRed();
    writeFileSync(paths().css, css('green'));
    s.projection.applyFromFs(fsEvt(paths().css));
    await settle();
    publish(doc, SRC, css('purple'));
    s.sent[0]?.answer({
      status: 'rejected',
      code: 'base-conflict',
      head: hashBytes(css('purple')),
    });
    await settle();
    expect(s.projection.takeAccepted()).toBe(true);
    await settle();
    expect(diskCss()).toBe(css('purple'));
    expect(s.projection.heldCss()).toBeNull();
    expect(readRecoveryBody(historyDir(), paths().css, 'local')).toBe(css('green'));
    s.projection.stop();
  });
});
