// Read-only production-module probes; all writes are confined to fresh tmp dirs.
// Run from repo root: bun --no-env-file docs/audits/2026-09-13-hub-sync/reproduce.ts
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceAgent } from '../../../apps/hub/src/workspace-agent.mjs';
import { createEditSourceCommand } from '../../../apps/studio/commands/edit-source-command.ts';
import * as Y from '../../../apps/studio/node_modules/yjs/dist/yjs.mjs';
import { applyHtmlToDoc, htmlFromDoc } from '../../../apps/studio/sync/codec.ts';
import { hashBytes } from '../../../apps/studio/sync/echo-guard.ts';
import { createFileLedger } from '../../../apps/studio/sync/file-ledger.ts';
import { scanLocalFiles } from '../../../apps/studio/sync/file-plane.ts';
import { syncPresentation } from '../../../apps/studio/sync/presentation.ts';
import { createDocProjection } from '../../../apps/studio/sync/projection.ts';
import { sourceError } from '../../../apps/studio/sync/source-validation.ts';

const temp = mkdtempSync(join(tmpdir(), 'maude-sync-audit-'));
const base = 'export default () => <div title="old" color="black"/>;\n';
const remote = 'export default () => <div title="new" color="black"/>;\n';
const local = 'export default () => <div title="old" color="red"/>;\n';
const bad = 'export default () => <div title="broken';
const report = (name: string, result: unknown) => console.log(JSON.stringify({ name, result }));
try {
  const root = join(temp, 'projection');
  mkdirSync(root);
  const file = join(root, 'screen.tsx');
  writeFileSync(file, base);
  const doc = new Y.Doc();
  applyHtmlToDoc(doc, base);
  const conflicts: unknown[] = [];
  let recovered = 0;
  const projection = createDocProjection({
    slug: 'screen',
    doc,
    paths: {
      html: file,
      comments: join(root, 'comments.json'),
      annotations: join(root, 'annotations.svg'),
    },
    historyDir: join(root, 'history'),
    flushMs: 60000,
    onConflict: (c) => conflicts.push(c),
    onRecovered: () => recovered++,
  });
  projection.start();
  projection.reconcile();
  // Local editor read BASE; remote update arrives before its next save/watcher.
  applyHtmlToDoc(doc, remote, { peer: 'B' });
  writeFileSync(file, local);
  projection.applyFromFs({ path: file, bytes: Buffer.from(local), hash: hashBytes(local) });
  report('stale-whole-file-import', {
    inputsValid: [base, remote, local].every((s) => sourceError(file, s) === null),
    result: htmlFromDoc(doc),
    remoteEditSurvives: htmlFromDoc(doc).includes('title="new"'),
    localEditSurvives: htmlFromDoc(doc).includes('color="red"'),
    conflicts,
    recovered,
  });
  projection.stop();
  doc.destroy();

  report(
    'summary-with-blocked-files-and-source',
    syncPresentation(
      {
        state: 'online',
        queuedOps: 0,
        docs: { synced: 91, pending: 0, rejected: 0 },
        conflicts: [{ kind: 'body-rejected', slug: 'screen', reason: 'invalid-source' }],
        files: {
          failed: 1,
          progress: { phase: 'blocked', tracked: 100, delivered: 99, remaining: 1 },
        },
      } as any,
      { project: 'Audit' }
    )
  );

  const repo = join(temp, 'hub');
  const agent = createWorkspaceAgent({
    repoDir: repo,
    designRel: '.design',
    debounceMs: 60000,
    log: { log() {}, warn() {}, error() {} },
  });
  const start = await agent.start();
  const hubDoc = new Y.Doc();
  hubDoc.getText('html').insert(0, base);
  await agent.onDocumentStored({
    documentName: 'ws/audit/main/home',
    document: hubDoc,
    user: null,
  });
  await agent.flush();
  const hubFile = join(repo, '.design/home.tsx');
  if (readFileSync(hubFile, 'utf8') !== base) throw new Error('Hub baseline failed');
  hubDoc.getText('html').delete(0, hubDoc.getText('html').length);
  hubDoc.getText('html').insert(0, bad);
  await agent.onDocumentStored({
    documentName: 'ws/audit/main/home',
    document: hubDoc,
    user: null,
  });
  const commit = await agent.flush();
  report('hub-workspace-projects-invalid-source', {
    start,
    invalidSource: sourceError(hubFile, bad) !== null,
    overwritten: readFileSync(hubFile, 'utf8') === bad,
    commitOk: commit?.ok,
  });
  await agent.stop();
  hubDoc.destroy();

  const scanRoot = join(temp, 'scan');
  mkdirSync(join(scanRoot, 'assets'), { recursive: true });
  writeFileSync(join(scanRoot, 'assets/small.svg'), '<svg/>');
  // Sparse: logical size only, no 513MiB allocation/read/upload.
  const fd = openSync(join(scanRoot, 'assets/large.mp4'), 'w');
  ftruncateSync(fd, 513 * 1024 * 1024);
  closeSync(fd);
  const ledger = createFileLedger({ designRoot: scanRoot, hubUrl: 'https://audit.invalid' });
  const scanned = scanLocalFiles(scanRoot, ledger);
  report('oversized-local-file-enumeration', {
    smallEnumerated: scanned.has('assets/small.svg'),
    largeEnumerated: scanned.has('assets/large.mp4'),
  });
  ledger.stop();

  const undoCalls: unknown[] = [];
  const command = createEditSourceCommand({
    payload: {
      op: 'css',
      canvas: 'home.tsx',
      id: 'title',
      key: 'color',
      before: 'black',
      after: 'red',
    },
    applyFn: (request) => {
      undoCalls.push(request);
    },
  });
  await command.undo();
  report('css-undo-wire-request', undoCalls);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
