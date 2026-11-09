// 2.1.1 T11 — a hub's own paired studio (a cell, or a self-hosted workspace hub) never holds a
// source conflict at cold start.
//
// The field report: the web studio a self-hosted hub serves showed "<canvas> changed here and in
// the cloud" in Diagnostics, Compare read "The two versions can't be read right now" and Keep
// mine answered "not found"; the desktop showed nothing. The hub log had `cold start: css=hold`
// then `source sync blocked (local-edit); local file kept.` Two halves:
//
//  - the 404 is the hub's studio proxy: `/_api/project/conflict` is REFUSED in a cell (decision
//    v2-S9.24b — one member's card would become every member's), and a refusal answers 404 so the
//    cell looks like it never had the feature. Compare and Keep mine can never work there.
//  - the conflict itself is the paired studio's cold start: its checkout's css differed from the
//    project's with no base on record, so the lane was HELD, exactly as on a person's Mac. But a
//    hub's checkout is the project's cache, not a person's work (DDR-243; the hub is the sole
//    committer, DDR-209): nobody can pick a side there, and nothing on it is owed to the project.
//    The project's version wins and the checkout's bytes are kept in the recovery slot.
//
// The canvas is a `_`-named module in a design-system preview folder (`preview/_ui-feedback.tsx`)
// on purpose: the report suspected the underscore. The sync runtime matches the held conflict by
// its exact slug, so the name plays no part — pinned below too.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { decide } from '../../hub/src/studio-manifest.mjs';
import { acceptedColdStart } from '../sync/accepted-cold-start.ts';
import { applyCssToDoc, applyHtmlToDoc } from '../sync/codec.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type LaneProposal,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { readRecoveryBody } from '../sync/source-recovery.ts';

const REMOTE = { remote: true };
const SLUG = 'system-ds-preview-_ui-feedback';
const SRC = `export default () => (\n  <DesignCanvas>\n    <DCArtboard id="a" width={180} height={254}><h1>a</h1></DCArtboard>\n  </DesignCanvas>\n);\n`;
const SRC_OTHER = SRC.replace('<h1>a</h1>', '<h1>a on the hub disk</h1>');
const css = (c: string) => `.feedback { color: ${c}; }\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't11-hub-checkout-'));
  mkdirSync(join(dir, 'system', 'ds', 'preview'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => ({
  html: join(dir, 'system', 'ds', 'preview', '_ui-feedback.tsx'),
  css: join(dir, 'system', 'ds', 'preview', '_ui-feedback.css'),
  comments: join(dir, '_comments', `${SLUG}.json`),
  annotations: join(dir, 'system', 'ds', 'preview', '_ui-feedback.annotations.json'),
  meta: join(dir, 'system', 'ds', 'preview', '_ui-feedback.meta.json'),
});
const historyDir = () => join(dir, '_history', SLUG);
const settle = () => new Promise((r) => setTimeout(r, 30));
const read = (p: string) => readFileSync(p, 'utf8');

function studio(doc: Y.Doc) {
  const sent: LaneProposal[] = [];
  let n = 0;
  const link: AcceptedLaneLink = {
    on: () => true,
    newTransactionId: () => `tx_${++n}`,
    propose: (p) => {
      sent.push(p);
      return new Promise<ProposalOutcome>(() => {});
    },
  };
  const conflicts: unknown[] = [];
  const projection = createDocProjection({
    slug: SLUG,
    doc,
    paths: paths(),
    flushMs: 0,
    historyDir: historyDir(),
    accepted: link,
    waitForReconcile: true,
    onConflict: (c) => conflicts.push(c),
  });
  projection.start();
  return { projection, sent, conflicts };
}

/** The project holds `html` + `css`; the checkout on disk holds `diskHtml` + `diskCss`, no base on record. */
async function boot(o: {
  html: string;
  css: string;
  diskHtml: string;
  diskCss: string;
  checkoutIsCache?: boolean;
}) {
  writeFileSync(paths().html, o.diskHtml);
  writeFileSync(paths().css, o.diskCss);
  const doc = new Y.Doc();
  doc.transact(() => {
    applyHtmlToDoc(doc, o.html, REMOTE);
    applyCssToDoc(doc, o.css, REMOTE);
  }, REMOTE);
  const s = studio(doc);
  const r = await acceptedColdStart({
    slug: SLUG,
    doc,
    paths: paths(),
    rel: 'system/ds/preview/_ui-feedback.tsx',
    inProject: true,
    projection: s.projection,
    historyDir: historyDir(),
    wasAccepted: async () => false,
    createDoc: async () => ({ status: 'accepted' }),
    log: { log() {}, warn() {} },
    ...(o.checkoutIsCache ? { checkoutIsCache: true } : {}),
  });
  s.projection.reconcile();
  await settle();
  return { s, r };
}

const verdict = (r: Awaited<ReturnType<typeof acceptedColdStart>>, lane: string) =>
  r.kind === 'reconciled' ? r.verdicts.find((v) => v.lane === lane) : undefined;

describe('T11 — a hub checkout is the project’s cache: cold start never holds a conflict', () => {
  test('css differing with no base: the project’s css wins, the checkout’s is kept in recovery, no conflict', async () => {
    const { s, r } = await boot({
      html: SRC,
      css: css('red'),
      diskHtml: SRC,
      diskCss: css('green'),
      checkoutIsCache: true,
    });
    expect(verdict(r, 'css')?.decision).toBe('materialize');
    expect(s.conflicts).toHaveLength(0);
    expect(s.projection.conflictSides()).toBeNull();
    expect(read(paths().css)).toBe(css('red'));
    expect(readRecoveryBody(historyDir(), paths().css, 'local')).toBe(css('green'));
    // nothing of the checkout's is proposed to the project
    expect(s.sent).toHaveLength(0);
    s.projection.stop();
  });

  test('html differing with no base: the project’s source wins, the checkout’s is kept in recovery, no conflict', async () => {
    const { s, r } = await boot({
      html: SRC,
      css: css('red'),
      diskHtml: SRC_OTHER,
      diskCss: css('red'),
      checkoutIsCache: true,
    });
    expect(verdict(r, 'html')?.decision).toBe('materialize');
    expect(s.conflicts).toHaveLength(0);
    expect(s.projection.conflictSides()).toBeNull();
    expect(read(paths().html)).toBe(SRC);
    expect(readRecoveryBody(historyDir(), paths().html, 'local')).toBe(SRC_OTHER);
    expect(s.sent).toHaveLength(0);
    s.projection.stop();
  });

  test('a person’s Mac still holds it: both sides kept, a visible conflict (T2 — never a silent overwrite)', async () => {
    const { s, r } = await boot({
      html: SRC,
      css: css('red'),
      diskHtml: SRC,
      diskCss: css('green'),
    });
    expect(verdict(r, 'css')?.decision).toBe('hold');
    expect(s.conflicts).toHaveLength(1);
    expect(read(paths().css)).toBe(css('green'));
    // the `_`-named module's conflict is readable by its slug's projection (the name plays no part)
    expect(s.projection.conflictSides()).toMatchObject({ mine: SRC, theirs: SRC });
    expect(s.projection.heldCss()).toEqual({ mine: css('green'), theirs: css('red') });
    expect(s.projection.takeAccepted()).toBe(true);
    await settle();
    expect(read(paths().css)).toBe(css('red'));
    expect(s.projection.conflictSides()).toBeNull();
    s.projection.stop();
  });

  test('why the card was a dead end in a cell: the conflict route is refused there for every role (404)', () => {
    for (const role of ['owner', 'editor', 'commenter', 'observer']) {
      expect(decide('GET', '/_api/project/conflict', role)).toMatchObject({
        allow: false,
        reason: 'refused',
      });
      expect(decide('POST', '/_api/project/conflict', role)).toMatchObject({
        allow: false,
        reason: 'refused',
      });
    }
  });
});
