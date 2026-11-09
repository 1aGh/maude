// A canvas one AI run created and has not published yet, then written by ANOTHER run (a second chat,
// the next turn while the first run is still open or held): the later write must never be refused
// `run-overlap` and rolled back on disk. The created canvas has no accepted content, so the later
// run's change cannot be told apart from the creator's — the write goes into the run that created
// the canvas, and the bytes stay where the writer put them.
//
// A real in-process kernel over bun:sqlite (sync/local-kernel.ts) and the stage unit
// (sync/action-stage.ts). The oracle is the disk, the stage's answer and the history rows.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as Y from 'yjs';

import { createActionStage } from '../sync/action-stage.ts';
import { applyHtmlToDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { readRecoveryBody } from '../sync/source-recovery.ts';

const REMOTE = { remote: true };

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const REL = 'ui/fresh.tsx';
const REPO_REL = `.design/${REL}`;
const canvas = (title: string) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function Fresh() {
  return (
    <DesignCanvas>
      <DCArtboard id="p" width={100} height={100}>
        <h1>${title}</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-created-overlap-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = path.join(designRoot, REL);
  return {
    designRoot,
    read: () => readFileSync(file, 'utf8'),
    write: (body: string) => writeFileSync(file, body),
  };
}

function open(designRoot: string, warns: string[]) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: { warn: (m: unknown) => warns.push(String(m)), error() {} },
  });
  homes.push(h);
  return h;
}

async function runWrite(h: LocalHome, p: ReturnType<typeof project>, run: string, body: string) {
  p.write(body);
  h.runtime.claimAiWrite(run, REPO_REL, hashBytes(body));
  h.observe(REL);
  await h.flush();
  // the stage settles the capture a beat after the watcher hands it over
  await new Promise((r) => setTimeout(r, 20));
}

describe('a canvas another run created', () => {
  test('stage: a second run writing a canvas the first run created is never refused run-overlap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ai-stage-created-'));
    dirs.push(dir);
    const refused: unknown[] = [];
    const sent: Array<{ operations: unknown[] }> = [];
    const stage = createActionStage({
      designRoot: dir,
      propose: async (a) => {
        sent.push(a);
        return { protocol: 1, status: 'accepted', transactionId: a.transactionId };
      },
      newTransactionId: () => `tx_${sent.length + 1}`,
      log: { log() {}, warn() {} },
      onRefused: (w) => refused.push(w),
    });
    stage.begin('run:r1', 'made it', { runId: 'r1', claimOnly: true });
    stage.begin('run:r2', 'edits it', { runId: 'r2', claimOnly: true });
    const c0 = canvas('created');
    stage.claim('r1', REL, hashBytes(c0));
    void stage.capture(REL, 'ui-fresh', {
      lane: 'html',
      content: c0,
      baseContent: '',
      transactionId: 't0',
      stageable: true,
      create: REL,
    });
    const c1 = canvas('edited');
    stage.claim('r2', REL, hashBytes(c1));
    const second = stage.capture(REL, 'ui-fresh', {
      lane: 'html',
      content: c1,
      baseContent: c0,
      transactionId: 't1',
      stageable: true,
      create: REL,
    });
    const settledEarly = await Promise.race([
      second.then((o) => o),
      new Promise((r) => setTimeout(() => r('staged'), 20)),
    ]);
    expect(settledEarly).toBe('staged');
    expect(refused).toEqual([]);
    // the creator publishes the canvas WITH the later write in it
    await stage.end('run:r1', 'done');
    expect(JSON.stringify(sent.at(-1)?.operations)).toContain('edited');
    expect(await second).toMatchObject({ status: 'accepted' });
  });

  test('local project: the later run’s bytes stay on disk and are published with the canvas', async () => {
    const p = project();
    const warns: string[] = [];
    const h = open(p.designRoot, warns);
    await h.ready();
    h.runtime.beginAiAction('run:r1', 'made it', { runId: 'r1', chatId: 'c1', claimOnly: true });
    await runWrite(h, p, 'r1', canvas('created'));
    h.runtime.beginAiAction('run:r2', 'edits it', { runId: 'r2', chatId: 'c2', claimOnly: true });
    const edited = canvas('edited');
    await runWrite(h, p, 'r2', edited);
    expect(warns.filter((w) => w.includes('run-overlap'))).toEqual([]);
    expect(p.read()).toBe(edited);
    const ended = await h.runtime.endAiAction('run:r1', 'done');
    expect(ended?.status).toBe('accepted');
    await h.runtime.endAiAction('run:r2', 'done');
    expect(p.read()).toBe(edited);
    const rows = await h.runtime.acceptedHistory({ limit: 10 });
    expect(rows.map((r) => r.kind)).toEqual(['ai']);
    expect(rows.filter((r) => r.kind === 'outside')).toEqual([]);
  });

  test('local project: a held creator (the run failed) does not turn every later edit into a rollback', async () => {
    const p = project();
    const warns: string[] = [];
    const h = open(p.designRoot, warns);
    await h.ready();
    h.runtime.beginAiAction('run:r1', 'made it', { runId: 'r1', chatId: 'c1', claimOnly: true });
    await runWrite(h, p, 'r1', canvas('created'));
    await h.runtime.endAiAction('run:r1', 'failed');
    h.runtime.beginAiAction('run:r2', 'edits it', { runId: 'r2', chatId: 'c1', claimOnly: true });
    const edited = canvas('edited after the failure');
    await runWrite(h, p, 'r2', edited);
    expect(warns.filter((w) => w.includes('run-overlap'))).toEqual([]);
    expect(p.read()).toBe(edited);
  });

  test('local project: a real overlap still leaves the disk, but its bytes are kept for recovery', async () => {
    const p = project();
    p.write(canvas('accepted'));
    const warns: string[] = [];
    const h = open(p.designRoot, warns);
    await h.ready();
    h.runtime.beginAiAction('run:r1', 'one', { runId: 'r1', chatId: 'c1', claimOnly: true });
    h.runtime.beginAiAction('run:r2', 'two', { runId: 'r2', chatId: 'c2', claimOnly: true });
    const first = canvas('first run');
    await runWrite(h, p, 'r1', first);
    const second = canvas('second run');
    await runWrite(h, p, 'r2', second);
    // A13: the refused write leaves the disk ...
    expect(warns.some((w) => w.includes('run-overlap'))).toBe(true);
    expect(p.read()).toBe(first);
    // ... but the writer's bytes are never lost
    const historyDir = path.join(p.designRoot, '_history', 'ui-fresh');
    expect(readRecoveryBody(historyDir, REL, 'local')).toBe(second);
  });

  test('linked project: the rolled-back bytes of a real overlap are kept for recovery', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'maude-overlap-projection-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'ui'), { recursive: true });
    const html = path.join(dir, 'ui', 'fresh.tsx');
    const accepted = canvas('accepted');
    writeFileSync(html, accepted);
    const doc = new Y.Doc();
    doc.transact(() => applyHtmlToDoc(doc, accepted, REMOTE), REMOTE);
    const sent: Array<{ answer: (o: ProposalOutcome) => void }> = [];
    let n = 0;
    const link: AcceptedLaneLink = {
      on: () => true,
      newTransactionId: () => `tx_${++n}`,
      propose: () => new Promise<ProposalOutcome>((answer) => sent.push({ answer })),
    };
    const historyDir = path.join(dir, '_history', 'ui-fresh');
    const projection = createDocProjection({
      slug: 'ui-fresh',
      doc,
      paths: {
        html,
        comments: path.join(dir, '_comments', 'ui-fresh.json'),
        annotations: path.join(dir, 'ui-fresh.annotations.svg'),
        css: path.join(dir, 'ui', 'fresh.css'),
        meta: path.join(dir, 'ui', 'fresh.meta.json'),
      },
      flushMs: 0,
      historyDir,
      accepted: link,
    });
    projection.start();
    projection.reconcile();
    const refused = canvas('second run');
    writeFileSync(html, refused);
    projection.applyFromFs({
      path: html,
      bytes: new TextEncoder().encode(refused),
      hash: hashBytes(refused),
    });
    expect(sent).toHaveLength(1);
    sent[0]?.answer({ status: 'rejected', code: 'run-overlap' });
    await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(html, 'utf8')).toBe(accepted);
    expect(readRecoveryBody(historyDir, html, 'local')).toBe(refused);
    projection.stop?.();
  });
});
