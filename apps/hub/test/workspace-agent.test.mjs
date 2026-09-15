// Cloud Phase 16 — the server-owned checkout.
//
// The end-to-end test at the bottom is the one that matters: an edit arrives
// with NO client running anywhere, and a real commit lands in a real git repo
// with the human as author and the bot as committer. Everything above it
// exists to make that test's failures legible.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as Y from 'yjs';

import { createWriteBehind, writeBehindKey } from '../src/asset-lane.mjs';
import { createGitRunner } from '../src/git-runner.mjs';
import { closeJournal, openJournal } from '../src/journal.mjs';
import { mergeSharedMetaIntoLocal } from '../src/meta-merge.mjs';
import { safeUrl, seedRepo } from '../src/seed-repo.mjs';
import { createWorkspaceAgent, slugFromDocName } from '../src/workspace-agent.mjs';
import {
  attributionFor,
  canvasSlug,
  DOC_TYPES,
  filesForCanvas,
  indexCanvasPaths,
  readDocContent,
  siblingPaths,
} from '../src/workspace-files.mjs';

const temps = [];
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'maude-ws-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const silent = () => ({ log() {}, warn() {}, error() {} });

function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ drift guards */

// The hub carries plain-JS twins of two studio modules because it must run
// under Node with no studio source tree present (see the header comments in
// workspace-files.mjs / meta-merge.mjs). A twin is only defensible while it is
// provably identical, which is what these two tests are for. They import the
// REAL studio source — available in the repo, absent from the image, which is
// exactly the asymmetry that makes the twins necessary in the first place.

describe('drift: hub twins vs studio source', () => {
  it('DOC_TYPES matches the studio codec', async () => {
    const codec = await import('../../studio/sync/codec.ts');
    const persistence = await import('../../studio/collab/persistence.ts');
    assert.equal(DOC_TYPES.html, codec.Y_SYNC_TYPES.html);
    assert.equal(DOC_TYPES.css, codec.Y_SYNC_TYPES.css);
    assert.equal(DOC_TYPES.meta, codec.Y_SYNC_TYPES.meta);
    assert.equal(DOC_TYPES.annotations, persistence.Y_TYPES.annotations);
  });

  it('mergeSharedMetaIntoLocal is byte-identical to the studio codec', async () => {
    const codec = await import('../../studio/sync/codec.ts');
    const corpus = [
      [null, '{"layout":{"artboards":[]}}'],
      ['{"viewport":{"x":1,"y":2},"title":"Old"}', '{"title":"New"}'],
      ['{"syncable":false,"a":1}', '{"a":2,"b":3}'],
      ['{"last_modified":123}', '{"z":1,"a":2}'],
      ['not json at all', '{"ok":true}'],
      ['{"viewport":9}', 'not json either'],
      [null, '[]'],
      [null, '"a string"'],
      ['{"viewport":1}', '{"__proto__":{"polluted":true},"safe":1}'],
    ];
    for (const [local, shared] of corpus) {
      assert.equal(
        mergeSharedMetaIntoLocal(local, shared),
        codec.mergeSharedMetaIntoLocal(local, shared),
        `drift for local=${local} shared=${shared}`
      );
    }
  });

  it('canvasSlug matches the studio slug transform', () => {
    // Mirrors slugFor() in apps/studio/sync/index.ts, which is not exported.
    const studioSlug = (rel) =>
      rel
        .replace(/\//g, '-')
        .replace(/\s+/g, '_')
        .replace(/\.(tsx|html)$/i, '')
        .replace(/^\.+/, '')
        .toLowerCase();
    for (const rel of ['Foo.tsx', 'ui/Foo.tsx', 'UI/Deep/Bar Baz.tsx', 'a.html', '.hidden/x.tsx']) {
      assert.equal(canvasSlug(rel), studioSlug(rel), rel);
    }
  });
});

/* ------------------------------------------------------------- pure module */

describe('workspace-files (pure)', () => {
  it('indexes canvases and ignores runtime-state directories', () => {
    const index = indexCanvasPaths([
      'Home.tsx',
      'ui/Card.tsx',
      '_history/Home/1.tsx',
      '_trash/Old.tsx',
      'Home.meta.json',
      'notes.md',
    ]);
    assert.deepEqual([...index.entries()].sort(), [
      ['home', 'Home.tsx'],
      ['ui-card', 'ui/Card.tsx'],
    ]);
  });

  it('resolves slug collisions deterministically, not by readdir order', () => {
    const a = indexCanvasPaths(['ui/Card.tsx', 'ui-card.tsx']);
    const b = indexCanvasPaths(['ui-card.tsx', 'ui/Card.tsx']);
    assert.equal(a.get('ui-card'), b.get('ui-card'));
    assert.equal(a.get('ui-card'), 'ui-card.tsx'); // shorter wins
  });

  it('derives the sidecars from the body path, with the annotations asymmetry', () => {
    assert.deepEqual(siblingPaths('ui/Card.tsx'), {
      meta: 'ui/Card.meta.json',
      css: 'ui/Card.css',
      // NOT a sibling — the studio keys annotations by the flat slug at the
      // design root, and the hub must write the file the studio actually reads.
      annotations: 'ui-card.annotations.svg',
    });
  });

  it('an absent lane is not a deletion', () => {
    const writes = filesForCanvas({
      bodyRel: 'Home.tsx',
      content: { body: '<div/>', css: null, meta: null, annotations: null },
      onDisk: { body: null, css: 'body{}', meta: '{"a":1}', annotations: '<svg/>' },
    });
    assert.deepEqual(writes, [{ relPath: 'Home.tsx', text: '<div/>' }]);
  });

  it('skips lanes whose bytes already match', () => {
    const writes = filesForCanvas({
      bodyRel: 'Home.tsx',
      content: { body: 'same', css: 'x{}', meta: null, annotations: null },
      onDisk: { body: 'same', css: null, meta: null, annotations: null },
    });
    assert.deepEqual(writes, [{ relPath: 'Home.css', text: 'x{}' }]);
  });

  it('preserves the local meta keys a server must never reset', () => {
    const local = JSON.stringify({ viewport: { x: 5 }, syncable: false, title: 'Old' });
    const [write] = filesForCanvas({
      bodyRel: 'Home.tsx',
      content: { body: null, css: null, meta: '{"title":"New"}', annotations: null },
      onDisk: { meta: local },
    });
    const merged = JSON.parse(write.text);
    assert.equal(write.relPath, 'Home.meta.json');
    assert.equal(merged.title, 'New');
    assert.deepEqual(merged.viewport, { x: 5 }, 'camera must survive a server commit');
    assert.equal(merged.syncable, false, 'a security opt-out must never be overwritten');
  });

  it('refuses to write an unparseable meta over a good one', () => {
    const writes = filesForCanvas({
      bodyRel: 'Home.tsx',
      content: { body: null, css: null, meta: 'not json', annotations: null },
      onDisk: { meta: '{"title":"Keep me"}' },
    });
    assert.deepEqual(writes, []);
  });

  it('attributes an anonymous edit to nobody rather than to the bot', () => {
    assert.equal(attributionFor(null), null);
    assert.equal(attributionFor({}), null);
    assert.deepEqual(attributionFor({ name: 'Alice', email: 'a@example.com' }), {
      name: 'Alice',
      email: 'a@example.com',
    });
    const synthesized = attributionFor({ name: 'macbook-token' });
    assert.equal(synthesized.name, 'macbook-token');
    assert.match(synthesized.email, /@workspace\.invalid$/, 'a synthesized address says so');

    // A hub session label identifies a LOGIN, not a person, and it is a new
    // one tomorrow — attributing a design to `u-1e166564e89d` is unreadable
    // now and wrong later. The address is the stable identity.
    assert.deepEqual(attributionFor({ name: 'u-1e166564e89d', email: 'alice@acme.com' }), {
      name: 'alice',
      email: 'alice@acme.com',
    });
    // With no address there is nothing better, so the label survives.
    assert.equal(attributionFor({ name: 'u-1e166564e89d' }).name, 'u-1e166564e89d');
  });

  it('reads the synced lanes off a real Y.Doc', () => {
    const doc = new Y.Doc();
    doc.getText('html').insert(0, '<main/>');
    doc.getMap('annotations').set('svg', '<svg/>');
    assert.deepEqual(readDocContent(doc), {
      body: '<main/>',
      css: null,
      meta: null,
      annotations: '<svg/>',
      // The sync-internal path lane. Absent here — an older peer omits it, and
      // that is the normal case, not a degraded one.
      path: null,
      // The move-retirement lane (studio codec stampMovedTo) — same posture.
      movedTo: null,
    });
  });

  it('surfaces syncMeta.path — untrusted, for the agent to validate', () => {
    const doc = new Y.Doc();
    doc.getText('html').insert(0, '<main/>');
    doc.getMap('syncMeta').set('path', 'ui/2026/social/summer-camp.tsx');
    assert.equal(readDocContent(doc).path, 'ui/2026/social/summer-camp.tsx');
    // Never materialized: it is bookkeeping about the file, not part of it.
    assert.ok(
      !filesForCanvas({
        bodyRel: 'ui/x.tsx',
        content: readDocContent(doc),
        onDisk: {},
      }).some((w) => w.text.includes('summer-camp.tsx'))
    );
  });
});

describe('slugFromDocName', () => {
  it('accepts the namespace and legacy flat names', () => {
    assert.equal(slugFromDocName('ws/proj/main/home'), 'home');
    assert.equal(slugFromDocName('home'), 'home');
  });

  it('refuses anything it would have to guess about', () => {
    for (const bad of ['', null, 'ws/proj/main/a/b', '../../etc/passwd', 'ws//main/x', 'a/b']) {
      assert.equal(slugFromDocName(bad), null, String(bad));
    }
  });
});

/* -------------------------------------------------------------- seed repo */

describe('seedRepo', () => {
  it('is a no-op without MAUDE_SEED_REPO', async () => {
    const r = await seedRepo(tmp(), async () => ({ code: 0, stdout: '', stderr: '' }), {});
    assert.equal(r.state, 'skipped');
  });

  it('IS consumed — the URL reaches git clone', async () => {
    // The bug this phase closes was an env var nothing read. Asserting the
    // argv is the only thing that proves it is wired, and it is what stops
    // the wiring from rotting back out.
    const calls = [];
    const dir = tmp();
    const r = await seedRepo(
      dir,
      async (args) => {
        calls.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
      { url: 'https://github.com/acme/design.git', branch: 'main', log: silent() }
    );
    assert.equal(r.state, 'cloned');
    // FULL clone, not `--depth 1`. A shallow checkout cannot produce a
    // complete bundle, so a shallow seed makes the cell's history
    // unbackupable from the moment it is created — which is how alligators
    // wrote a day of backups that could not be restored.
    assert.deepEqual(calls[0], [
      'clone',
      '--branch',
      'main',
      '--',
      'https://github.com/acme/design.git',
      dir,
    ]);
    assert.ok(!calls[0].includes('--depth'), 'a shallow seed is unbackupable by construction');
  });

  it('refuses schemes that are local, unauthenticated, or arbitrary execution', async () => {
    for (const url of ['file:///etc', 'git://x/y', 'ssh://a/b', 'ext::sh -c whoami', '/tmp/repo']) {
      const r = await seedRepo(tmp(), async () => ({ code: 0, stdout: '', stderr: '' }), { url });
      assert.equal(r.state, 'failed', url);
    }
  });

  it('never seeds over existing work', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'already-here.txt'), 'x');
    const r = await seedRepo(dir, async () => ({ code: 0, stdout: '', stderr: '' }), {
      url: 'https://example.com/r.git',
    });
    assert.equal(r.state, 'skipped');
    assert.match(r.reason, /not empty/);
  });

  it('redacts the token a seed URL can carry', () => {
    assert.equal(
      safeUrl('https://x-access-token:ghs_secret@github.com/a/b.git'),
      'https://***@github.com/a/b.git'
    );
  });
});

/* ------------------------------------------- the journal-driven write-behind */

describe('write-behind (Sync v2 Increment 5)', () => {
  /** A journal + designRoot pair with real files, so recordWrite can hash them. */
  function scene() {
    const dataDir = tmp();
    const designRoot = tmp();
    const journal = openJournal(dataDir);
    const record = (rel, content = 'x') => {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), content);
      return journal.recordWrite({ designRoot, path: rel, source: 'peer-put' });
    };
    return { dataDir, designRoot, journal, record };
  }

  it('mirrors EVERY file-plane class the journal names — not only assets/', async () => {
    // The old sweeper walked `<designRoot>/assets/` and nothing else, so
    // `companion-text`, `code-module` and nested `system/**/assets/*` files
    // were durable only through git history (the F-6/B2 hole). The journal is
    // the classifier's own record of the plane, so driving the mirror from it
    // covers the whole plane by construction.
    const { dataDir, designRoot, journal, record } = scene();
    try {
      record('assets/aaaaaaaa.png', 'cas-bytes');
      record('system/ds/brand.css', '.brand{}');
      record('system/ds/assets/wordmark.svg', '<svg/>');
      const put = [];
      const wb = createWriteBehind({
        designRoot,
        s3: { bucket: 'x' },
        journal,
        prefix: '',
        log: silent(),
        deps: { putObject: async (_c, key) => put.push(key) },
      });
      await wb.flush();
      assert.deepEqual(put.sort(), [
        // Top-level content-addressed assets keep the legacy layout the read
        // proxy serves; everything else is keyed by path under files/.
        'assets/aaaaaaaa.png',
        'files/system/ds/assets/wordmark.svg',
        'files/system/ds/brand.css',
      ]);
      // Every row is stamped — the queue is empty, so a second flush is free.
      assert.deepEqual(journal.unmirrored(), []);
      await wb.flush();
      assert.equal(put.length, 3);
      wb.stop();
    } finally {
      closeJournal(dataDir);
    }
  });

  it('a tombstone mirrors nothing and settles its own row', async () => {
    // The blob stays in the bucket, unreferenced — quarantine semantics, the
    // reason a propagated delete is recoverable. The ROW still has to settle,
    // or the queue never drains.
    const { dataDir, designRoot, journal, record } = scene();
    try {
      record('assets/aaaaaaaa.png');
      journal.recordWrite({
        designRoot,
        path: 'assets/aaaaaaaa.png',
        source: 'peer-put',
        deleted: true,
      });
      const put = [];
      const wb = createWriteBehind({
        designRoot,
        s3: { bucket: 'x' },
        journal,
        prefix: '',
        log: silent(),
        deps: { putObject: async (_c, key) => put.push(key) },
      });
      await wb.flush();
      // The write row and the tombstone share the path; the newest row (the
      // tombstone) decides, so nothing uploads and both rows settle.
      assert.deepEqual(put, []);
      assert.deepEqual(journal.unmirrored(), []);
      wb.stop();
    } finally {
      closeJournal(dataDir);
    }
  });

  it('a failed put stays queued — the crash-safety property, LOUD (the sweepNew lesson)', async () => {
    const { dataDir, designRoot, journal, record } = scene();
    try {
      record('assets/aaaaaaaa.png');
      let fail = true;
      const put = [];
      const errors = [];
      const wb = createWriteBehind({
        designRoot,
        s3: { bucket: 'x' },
        journal,
        prefix: '',
        log: { log() {}, warn() {}, error: (m) => errors.push(m) },
        deps: {
          putObject: async (_c, key) => {
            if (fail) throw new Error('502');
            put.push(key);
          },
        },
      });
      await wb.flush();
      // Unstamped ⇒ still the queue's work; and the failure was named.
      assert.equal(journal.unmirrored().length, 1);
      assert.match(errors.join('\n'), /only in the checkout/);
      fail = false;
      await wb.flush();
      assert.deepEqual(put, ['assets/aaaaaaaa.png']);
      assert.deepEqual(journal.unmirrored(), []);
      wb.stop();
    } finally {
      closeJournal(dataDir);
    }
  });

  it('no object storage ⇒ a clean no-op, exactly like the journal tail', async () => {
    const { dataDir, journal, record, designRoot } = scene();
    try {
      record('assets/aaaaaaaa.png');
      const wb = createWriteBehind({
        designRoot,
        s3: null,
        journal,
        prefix: '',
        log: silent(),
      });
      const r = await wb.flush();
      assert.equal(r.skipped, 'no-target');
      wb.stop();
    } finally {
      closeJournal(dataDir);
    }
  });

  it('writeBehindKey — the two layouts, and a tenant scope prefixes both', () => {
    assert.equal(writeBehindKey('assets/aaaaaaaa.png'), 'assets/aaaaaaaa.png');
    assert.equal(writeBehindKey('system/ds/brand.css'), 'files/system/ds/brand.css');
    assert.equal(writeBehindKey('assets/aaaaaaaa.png', 't1'), 't1/assets/aaaaaaaa.png');
    assert.equal(writeBehindKey('system/ds/brand.css', 't1'), 't1/files/system/ds/brand.css');
  });
});

/* ---------------------------------------------------------- end to end */

describe('workspace agent, end to end against real git', () => {
  const gitOk = gitAvailable();

  for (const delayedPeerStore of [false, true])
    it(`a document store preserves a local body edit awaiting its watcher (delayed peer store: ${delayedPeerStore})`, async () => {
      const repo = tmp();
      const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 60_000, log: silent() });
      const doc = new Y.Doc();
      const base = 'export default function Home(){return <main>Previous</main>}\n';
      const local = base.replace('Previous', 'New local work');
      const args = { documentName: 'ws/repro/main/home', document: doc };
      try {
        await agent.start();
        doc.getText('html').insert(0, base);
        doc.getText('meta').insert(0, JSON.stringify({ title: 'Before' }));
        await agent.onDocumentStored(args);
        assert.equal((await agent.flush()).ok, true);
        const file = join(repo, '.design/home.tsx');
        if (delayedPeerStore) {
          const peer = base.replace('Previous', 'Previous peer');
          doc.transact(() => {
            doc.getText('html').delete(0, doc.getText('html').length);
            doc.getText('html').insert(0, peer);
          });
          writeFileSync(file, peer); // studio projector arrived before the hub store hook
        }
        writeFileSync(file, local);
        doc.getArray('comments').push([{ id: 'comment', text: 'Independent update' }]);
        doc.getText('meta').delete(0, doc.getText('meta').length);
        doc.getText('meta').insert(0, JSON.stringify({ title: 'Independent update' }));
        const out = await agent.onDocumentStored(args);
        assert.equal(
          readFileSync(file, 'utf8'),
          local,
          'the watcher must still be able to read the edit'
        );
        assert.equal(
          JSON.parse(readFileSync(join(repo, '.design/home.meta.json'), 'utf8')).title,
          'Independent update'
        );
        assert.ok(
          !out?.staged.includes('home.tsx'),
          'do not attribute the local candidate to this store'
        );
        await agent.flush();
        assert.equal(
          execFileSync('git', ['show', 'HEAD:.design/home.tsx'], { cwd: repo, encoding: 'utf8' }),
          base
        );

        // Once the watcher has imported the new body, history can record it.
        doc.transact(() => {
          doc.getText('html').delete(0, doc.getText('html').length);
          doc.getText('html').insert(0, local);
        });
        await agent.onDocumentStored(args);
        assert.equal((await agent.flush()).ok, true);
        assert.equal(
          execFileSync('git', ['show', 'HEAD:.design/home.tsx'], { cwd: repo, encoding: 'utf8' }),
          local
        );
      } finally {
        await agent.stop();
        doc.destroy();
      }
    });

  it('invalid source never overwrites the valid checkout or reaches history (audit P0 #2)', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 60_000, log: silent() });
    const doc = new Y.Doc();
    const args = { documentName: 'ws/repro/main/home', document: doc };
    const setBody = (text) =>
      doc.transact(() => {
        doc.getText('html').delete(0, doc.getText('html').length);
        doc.getText('html').insert(0, text);
      });
    const good = 'export default function Home(){return <main>Good</main>}\n';
    const bad = 'export default function Home(){return <main title="broken';
    const fixed = good.replace('Good', 'Fixed');
    const file = join(repo, '.design/home.tsx');
    try {
      await agent.start();
      setBody(good);
      doc.getText('meta').insert(0, JSON.stringify({ title: 'Before' }));
      await agent.onDocumentStored(args);
      assert.equal((await agent.flush()).ok, true);

      setBody(bad);
      doc.getText('meta').delete(0, doc.getText('meta').length);
      doc.getText('meta').insert(0, JSON.stringify({ title: 'Independent' }));
      const out = await agent.onDocumentStored(args);
      assert.equal(readFileSync(file, 'utf8'), good, 'the valid checkout must survive');
      assert.ok(!out?.staged.includes('home.tsx'), 'the rejected body must not be staged');
      assert.equal(
        JSON.parse(readFileSync(join(repo, '.design/home.meta.json'), 'utf8')).title,
        'Independent',
        'unrelated lanes keep flowing'
      );
      assert.equal(
        agent.rejectedSources.get('home.tsx')?.reason,
        'Source has syntax errors or duplicate bindings'
      );
      await agent.flush();
      assert.equal(
        execFileSync('git', ['show', 'HEAD:.design/home.tsx'], { cwd: repo, encoding: 'utf8' }),
        good
      );

      // A valid repair projects and commits normally and clears the rejection.
      setBody(fixed);
      await agent.onDocumentStored(args);
      assert.equal(readFileSync(file, 'utf8'), fixed);
      assert.equal(agent.rejectedSources.has('home.tsx'), false);
      assert.equal((await agent.flush()).ok, true);
      assert.equal(
        execFileSync('git', ['show', 'HEAD:.design/home.tsx'], { cwd: repo, encoding: 'utf8' }),
        fixed
      );
    } finally {
      await agent.stop();
      doc.destroy();
    }
  });

  it('invalid source already on disk is never committed by a store (audit P0 #2)', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 60_000, log: silent() });
    const doc = new Y.Doc();
    const args = { documentName: 'ws/repro/main/home', document: doc };
    const good = 'export default function Home(){return <main>Good</main>}\n';
    const bad = 'export default function Home(){return <main title="broken';
    try {
      await agent.start();
      doc.getText('html').insert(0, good);
      await agent.onDocumentStored(args);
      assert.equal((await agent.flush()).ok, true);
      // A paired writer already materialized the same invalid bytes, so the
      // write path has nothing to do — the commit-eligibility path must refuse.
      writeFileSync(join(repo, '.design/home.tsx'), bad);
      doc.transact(() => {
        doc.getText('html').delete(0, doc.getText('html').length);
        doc.getText('html').insert(0, bad);
      });
      const out = await agent.onDocumentStored(args);
      assert.ok(!out?.staged.includes('home.tsx'));
      await agent.flush();
      assert.equal(
        execFileSync('git', ['show', 'HEAD:.design/home.tsx'], { cwd: repo, encoding: 'utf8' }),
        good
      );
    } finally {
      await agent.stop();
      doc.destroy();
    }
  });

  it('a browser-only edit produces a server commit authored by the human', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
    });
    const started = await agent.start();
    assert.equal(started.state, 'created');

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default function Home() { return <main/>; }\n');
    doc.getText('meta').insert(0, '{"title":"Home"}');

    const out = await agent.onDocumentStored({
      documentName: 'ws/acme/main/home',
      document: doc,
      user: { name: 'Alice Novak', email: 'alice@example.com' },
    });
    assert.deepEqual(out.written.sort(), ['home.meta.json', 'home.tsx']);
    assert.ok(existsSync(join(repo, '.design/home.tsx')), 'body written');
    assert.ok(existsSync(join(repo, '.design/home.meta.json')), 'meta written');

    const commit = await agent.flush();
    assert.equal(commit.ok, true, `commit failed: ${JSON.stringify(commit)}`);

    const show = (fmt) =>
      execFileSync('git', ['log', '-1', `--format=${fmt}`], { cwd: repo, encoding: 'utf8' }).trim();
    assert.equal(show('%an'), 'Alice Novak', 'author is the human who edited');
    assert.equal(show('%ae'), 'alice@example.com');
    assert.equal(show('%cn'), 'Maude Workspace', 'committer is the machine');
    assert.match(show('%s'), /^design: update home$/);

    await agent.stop();
  });

  it('never rewrites history — only add and commit reach git', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    const verbs = [];
    const real = createGitRunner();
    const agent = createWorkspaceAgent({
      repoDir: repo,
      debounceMs: 5,
      log: silent(),
      run: (args, o) => {
        verbs.push(args[0]);
        return real(args, o);
      },
    });
    await agent.start();
    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'x');
    await agent.onDocumentStored({ documentName: 'ws/a/main/home', document: doc, user: null });
    await agent.flush();
    await agent.stop();

    const forbidden = ['reset', 'rebase', 'checkout', 'push', 'clean', 'restore', 'amend'];
    for (const v of verbs)
      assert.ok(!forbidden.includes(v), `history-rewriting verb reached git: ${v}`);
  });

  it('keeps a canvas at its existing nested path instead of flattening it', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    mkdirSync(join(repo, '.design/ui'), { recursive: true });
    writeFileSync(join(repo, '.design/ui/Card.tsx'), 'old\n');
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();

    const doc = new Y.Doc();
    const next = 'export default () => <p>new</p>;\n';
    doc.getText('html').insert(0, next);
    const out = await agent.onDocumentStored({
      documentName: 'ws/a/main/ui-card',
      document: doc,
      user: null,
    });
    assert.deepEqual(out.written, ['ui/Card.tsx']);
    assert.equal(readFileSync(join(repo, '.design/ui/Card.tsx'), 'utf8'), next);
    assert.ok(
      !existsSync(join(repo, '.design/ui-card.tsx')),
      'must not flatten an existing canvas'
    );
    await agent.stop();
  });

  it('a late validated syncMeta.path relocates the fallback stub instead of pinning it', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // THE STAMP RACE, as a test (fix 5, sync RCA 2026-08-10). The first store
    // arrives before the peer's `syncMeta.path` lands, the fallback places the
    // body flat inside the group, and pathIndex used to memoise that guess
    // forever — the real nested path could never win, and the canvas 404'd its
    // dynamic import in the cloud for good.
    const repo = tmp();
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default () => <main>deep</main>;\n');

    // Store 1: body, no path → the group-aware fallback guesses flat-in-group.
    const first = await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-social-summer',
      document: doc,
      user: null,
    });
    assert.deepEqual(first.written, ['ui/social-summer.tsx'], 'fallback stub first');
    // Commit the stub, so the relocation below exercises the delete half too
    // (an uncommitted stub is simply dropped from staging — see the
    // tracked-paths guard in the agent).
    const stubCommit = await agent.flush();
    assert.equal(stubCommit.ok, true, 'the stub commits like any canvas');

    // Store 2: the peer's stamp arrived — same document now carries its path.
    doc.getMap('syncMeta').set('path', 'ui/social/summer.tsx');
    const second = await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-social-summer',
      document: doc,
      user: null,
    });
    assert.equal(second.bodyRel, 'ui/social/summer.tsx', 'the validated path wins');
    assert.ok(existsSync(join(repo, '.design/ui/social/summer.tsx')), 'relocated to the real home');
    assert.ok(!existsSync(join(repo, '.design/ui/social-summer.tsx')), 'the stub is gone');
    assert.ok(
      second.staged.includes('ui/social-summer.tsx'),
      'the vacated path is staged (delete half)'
    );
    assert.ok(second.staged.includes('ui/social/summer.tsx'), 'the new path is staged (add half)');

    // Store 3: the index now holds the validated home — no second document, no
    // resurrection of the stub.
    doc.getText('html').insert(doc.getText('html').length, '// more\n');
    const third = await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-social-summer',
      document: doc,
      user: null,
    });
    assert.deepEqual(third.written, ['ui/social/summer.tsx'], 'later stores land at the new home');
    assert.ok(!existsSync(join(repo, '.design/ui/social-summer.tsx')), 'still exactly one file');

    const commit = await agent.flush();
    assert.equal(commit.ok, true, `commit failed: ${JSON.stringify(commit)}`);
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    assert.equal(dirty.trim(), '', 'the move left nothing dirty — both halves committed');
    await agent.stop();
  });

  it('a real checkout file is never relocated by a wire path (provenance wins)', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // pathIndex provenance: boot-scan entries come from real files the tenant
    // has — a peer may not move another peer's work, whatever its stamp says.
    const repo = tmp();
    mkdirSync(join(repo, '.design/ui'), { recursive: true });
    writeFileSync(join(repo, '.design/ui/a-b.tsx'), 'theirs\n');
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'mine\n');
    // A perfectly VALID path for this document — pointing somewhere else.
    doc.getMap('syncMeta').set('path', 'ui/a/b.tsx');
    const out = await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-a-b',
      document: doc,
      user: null,
    });
    assert.deepEqual(out.written, ['ui/a-b.tsx'], 'the checkout location holds');
    assert.ok(!existsSync(join(repo, '.design/ui/a')), 'no relocation, no twin');
    await agent.stop();
  });

  it('commits an edit ANOTHER process already wrote to disk (cell live pairing)', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // THE PAIRING RACE, as a test. Under DDR-213 the studio child's doc→file
    // projector writes the same bytes from the same doc and usually gets there
    // first, so the hub has nothing to write. It must still COMMIT: the cell
    // owns this tenant's history, and the child's own autocommit is disabled.
    // Before the fix this left the tree permanently dirty and `git log` empty.
    const repo = tmp();
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default () => <main>paired</main>;\n');

    // The OTHER process wins the race: disk already holds the doc's bytes.
    mkdirSync(join(repo, '.design'), { recursive: true });
    writeFileSync(join(repo, '.design/home.tsx'), 'export default () => <main>paired</main>;\n');

    const out = await agent.onDocumentStored({
      documentName: 'ws/acme/main/home',
      document: doc,
      user: { name: 'Dana', email: 'dana@example.com' },
    });
    assert.deepEqual(out.written, [], 'the hub had nothing to write — the projector won');
    assert.deepEqual(out.staged, ['home.tsx'], 'but it must still stage the lane for commit');

    const commit = await agent.flush();
    assert.equal(commit.ok, true, `expected a commit, got ${JSON.stringify(commit)}`);
    const tracked = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(tracked, '.design/home.tsx');
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    assert.equal(dirty.trim(), '', 'the checkout must not be left dirty');
    await agent.stop();
  });

  it('never commits a meta the write path refused to write', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // The commit gate must not be looser than the write gate. `filesForCanvas`
    // refuses to write a `.meta.json` whose shared half does not parse; staging
    // it anyway would commit unvalidated bytes into the tenant's history and on
    // to their GitHub mirror — defeating the refusal. (Defender finding, 2026-08-06.)
    const repo = tmp();
    mkdirSync(join(repo, '.design'), { recursive: true });
    writeFileSync(join(repo, '.design/home.tsx'), 'body\n');
    writeFileSync(join(repo, '.design/home.meta.json'), '{"layout":{"anything":1}}\n');

    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'body\n'); // identical to disk — nothing to write
    doc.getText('meta').insert(0, 'not json at all'); // the write path will refuse this

    const out = await agent.onDocumentStored({
      documentName: 'ws/acme/main/home',
      document: doc,
      user: null,
    });
    assert.ok(
      !out.written.includes('home.meta.json'),
      'the write path must still refuse an unparseable shared meta'
    );
    assert.ok(
      !out.staged.includes('home.meta.json'),
      'and the commit path must refuse it too — not route around the gate'
    );
    assert.ok(out.staged.includes('home.tsx'), 'the body lane is unaffected');
    await agent.stop();
  });

  it('an unchanged lane produces no empty commit', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // The other half of the same change: now that we stage lanes we did not
    // write, a re-store of identical bytes must NOT manufacture a commit.
    const repo = tmp();
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();
    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'x\n');
    const store = () =>
      agent.onDocumentStored({ documentName: 'ws/a/main/home', document: doc, user: null });

    await store();
    assert.equal((await agent.flush()).ok, true);
    const first = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

    await store(); // identical bytes, second time
    const again = await agent.flush();
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'nothing-to-commit');
    const second = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(second, first, 'no empty commit was manufactured');
    await agent.stop();
  });

  it('an unparseable document name is ignored, not guessed at', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();
    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'x');
    assert.equal(
      await agent.onDocumentStored({ documentName: '../../escape', document: doc, user: null }),
      null
    );
    await agent.stop();
  });
});

describe('seedRepo: a failed clone must be retryable', () => {
  it('removes the partial checkout so the next boot tries again', async () => {
    // The first real container run failed its clone on a missing CA bundle and
    // left `/repo/.git` behind. The "already initialized" guard then read that
    // as a completed seed, so every subsequent boot skipped seeding — one
    // transient network failure turning into a permanently empty workspace.
    const dir = tmp();
    const r = await seedRepo(
      dir,
      async () => {
        mkdirSync(join(dir, '.git'), { recursive: true }); // what a real clone leaves
        return { code: 128, stdout: '', stderr: 'certificate verification failed' };
      },
      { url: 'https://example.com/r.git', log: silent() }
    );
    assert.equal(r.state, 'failed');
    assert.ok(!existsSync(join(dir, '.git')), 'a partial clone must not look like a finished one');

    const retry = await seedRepo(dir, async () => ({ code: 0, stdout: '', stderr: '' }), {
      url: 'https://example.com/r.git',
      log: silent(),
    });
    assert.equal(retry.state, 'cloned', 'the next boot must be able to retry');
  });
});

describe('shutdown must not race the commit', () => {
  it('stop() flushes and REPORTS the commit rather than swallowing it', {
    skip: gitAvailable() ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    // Long debounce, so nothing commits on its own — the only thing that can
    // produce a commit here is stop() doing its job.
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 60_000, log: silent() });
    await agent.start();
    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default () => <p>late edit</p>;\n');
    await agent.onDocumentStored({
      documentName: 'ws/a/main/home',
      document: doc,
      user: { name: 'Alice', email: 'alice@example.com' },
    });

    const outcome = await agent.stop();
    assert.ok(outcome?.ok, `stop() must commit and say so, got ${JSON.stringify(outcome)}`);
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(count, '1', 'the edit made just before shutdown must be in history');
  });
});

describe('the hub owns its own shutdown', () => {
  it('Hocuspocus signal handling is OFF', async () => {
    // Hocuspocus installs SIGINT/SIGQUIT/SIGTERM handlers that `destroy()` and
    // then `process.exit(0)`. Ours flushes the pending commit first — and the
    // two race. Observed live: `git add` had run, `git commit` had not, and the
    // workspace shut down staged-but-uncommitted. Every migrated cell would
    // lose its last edits, and migration is the normal path for a cell.
    //
    // This is one config line, which is exactly the kind of thing a refactor
    // removes without a single test going red. Hence this test.
    const { createHub } = await import('../src/server.mjs');
    const built = createHub({ port: 0, dataDir: tmp(), secret: 'x', insecureHttp: true });
    assert.equal(
      built.server.configuration.stopOnSignals,
      false,
      'the hub must handle SIGTERM itself, or the shutdown flush is cut short'
    );
    built.stopBackgroundWork();
  });
});

describe('the seed never leaves a credential on disk', () => {
  it('rewrites origin to a URL with no token in it', async () => {
    // `git clone https://x-access-token:<token>@…` writes that URL verbatim
    // into .git/config, where the tenant's own tooling reads it. The mirror
    // lane refuses to do this (DDR-201); the seed was quietly doing it.
    const calls = [];
    const dir = tmp();
    await seedRepo(
      dir,
      async (args) => {
        calls.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
      { url: 'https://x-access-token:ghs_secret@github.com/acme/design.git', log: silent() }
    );
    const flat = calls.flat().join(' ');
    assert.ok(flat.includes('ghs_secret'), 'the clone itself must of course use it');
    const setUrl = calls.find((a) => a[0] === 'remote' && a[1] === 'set-url');
    assert.ok(setUrl, 'the remote must be rewritten after cloning');
    assert.equal(setUrl[3], 'https://github.com/acme/design.git');
    assert.ok(!setUrl.join(' ').includes('ghs_secret'));
  });

  it('removes the remote outright if it cannot be rewritten', async () => {
    // A live credential on disk is worse than losing where the project came
    // from.
    const calls = [];
    await seedRepo(
      tmp(),
      async (args) => {
        calls.push(args);
        return args[1] === 'set-url'
          ? { code: 1, stdout: '', stderr: 'nope' }
          : { code: 0, stdout: '', stderr: '' };
      },
      { url: 'https://x-access-token:ghs_secret@github.com/acme/design.git', log: silent() }
    );
    assert.ok(calls.some((a) => a[0] === 'remote' && a[1] === 'remove'));
  });
});

/* -------------------------------------------------- the move protocol */

describe('a retired document (the move protocol, studio codec stampMovedTo)', () => {
  const gitOk = gitAvailable();

  it('when a paired studio projects the checkout, the agent never writes, relocates or parks — it only commits', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // The cell race the surface run found (2026-09-15, L04): the accepted move
    // created the new document and retired the old one at once, the agent
    // wrote the new path and parked the old file, and the studio's own rename
    // then died with ENOENT. With one projector there is no race.
    const repo = tmp();
    let projector = true;
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
      writesCheckout: () => projector,
    });
    await agent.start();
    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default function Home() { return <main/>; }\n');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });
    await agent.flush();
    assert.ok(
      existsSync(join(repo, '.design/home.tsx')),
      'materialised while it was the projector'
    );

    projector = false; // the project switched to accepted revisions; the studio projects now
    // An accepted move: the new document exists and the old one is retired.
    const moved = new Y.Doc();
    moved.getText('html').insert(0, 'export default () => <p>moved</p>;\n');
    moved.getMap('syncMeta').set('path', 'ui/folder/home.tsx');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-folder-home',
      document: moved,
      user: null,
    });
    assert.ok(!existsSync(join(repo, '.design/ui/folder/home.tsx')), 'the agent wrote nothing');
    doc.getMap('syncMeta').set('movedTo', 'ui/folder/home.tsx');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });
    assert.ok(
      existsSync(join(repo, '.design/home.tsx')),
      'the old file is the studio’s to move, not parked'
    );
    assert.ok(!existsSync(join(repo, '.design/_trash')), 'nothing quarantined');

    // The studio does the move on disk and projects the accepted body; the
    // agent commits what it finds.
    mkdirSync(join(repo, '.design/ui/folder'), { recursive: true });
    renameSync(join(repo, '.design/home.tsx'), join(repo, '.design/ui/folder/home.tsx'));
    writeFileSync(join(repo, '.design/ui/folder/home.tsx'), moved.getText('html').toString());
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-folder-home',
      document: moved,
      user: null,
    });
    const other = new Y.Doc();
    other.getText('html').insert(0, 'x');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/other',
      document: other,
      user: null,
    });
    const commit = await agent.flush();
    assert.equal(commit?.ok, true, JSON.stringify(commit));
    const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' });
    assert.ok(tracked.includes('.design/ui/folder/home.tsx'), tracked);
    assert.ok(!tracked.includes('.design/home.tsx\n'), tracked);
  });

  it('quarantines the checkout copy and commits the deletion', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    // The user-visible bug this pins: move a canvas into a folder on the
    // desktop and the cloud tree kept BOTH paths — the new one from the new
    // document, and the old one because nothing ever told the checkout the
    // old document was done. The ghost file is exactly what their screenshot
    // showed ("je tam navíc tralal-Threads").
    const repo = tmp();
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
    });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default function Home() { return <main/>; }\n');
    doc.getText('meta').insert(0, '{"title":"Home"}');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/home',
      document: doc,
      user: { name: 'Alice Novak', email: 'alice@example.com' },
    });
    await agent.flush();
    assert.ok(existsSync(join(repo, '.design/home.tsx')), 'materialised before the move');

    // The mover stamps the doc retired; the hub sees the next store. The NEW
    // path does not exist yet — the mover's rename (or the new document's
    // materialisation) is still in flight — so the hub must HOLD: quarantining
    // now is the exact race that killed a live move with ENOENT (the hub and
    // the cell's studio child share one disk).
    doc.getMap('syncMeta').set('movedTo', 'ui/folder/home.tsx');
    const out = await agent.onDocumentStored({
      documentName: 'ws/acme/main/home',
      document: doc,
      user: { name: 'Alice Novak', email: 'alice@example.com' },
    });
    assert.equal(out, null, 'a retired doc materialises nothing');
    assert.ok(
      existsSync(join(repo, '.design/home.tsx')),
      'HOLD while the new path is absent — the move is still in flight'
    );

    // The canvas lands at its new home — and it lands as a DOCUMENT, which is
    // what a move actually is. A file appearing at the named path is not
    // enough: `movedTo` is peer-written, and "something exists there" answers
    // yes for `config.json` too.
    const moved = new Y.Doc();
    moved.getText('html').insert(0, 'export default () => <p>moved body</p>;\n');
    moved.getMap('syncMeta').set('path', 'ui/folder/home.tsx');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-folder-home',
      document: moved,
      user: null,
    });
    // Any later store sweeps pending retirements — here, the new doc's own.
    const other = new Y.Doc();
    other.getText('html').insert(0, 'x');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/other',
      document: other,
      user: null,
    });

    assert.ok(!existsSync(join(repo, '.design/home.tsx')), 'the ghost file is gone');
    const trash = join(repo, '.design/_trash');
    assert.ok(existsSync(trash), 'quarantined, not unlinked');
    const parked = readdirSync(trash, { recursive: true }).map(String);
    assert.ok(
      parked.some((p) => p.endsWith('home.tsx')),
      `the body is recoverable from _trash/: ${parked.join(', ')}`
    );

    const commit = await agent.flush();
    assert.equal(commit.ok, true, `the deletion commits: ${JSON.stringify(commit)}`);
    const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' });
    assert.ok(!tracked.includes('.design/home.tsx'), 'git agrees the canvas moved on');

    // And a LATER store of the same retired doc is a quiet no-op — the doc
    // can arrive again forever (reconnects, replays) without churning.
    const again = await agent.onDocumentStored({
      documentName: 'ws/acme/main/home',
      document: doc,
      user: null,
    });
    assert.equal(again, null);

    await agent.stop();
  });

  it('records the deletion even when somebody else removed the file first', {
    skip: gitAvailable() ? false : 'git not available',
  }, async () => {
    // On a CELL the studio child shares this disk and its own retirement
    // watcher usually parks the ghost before the hub's sweep looks. Finding
    // the path already gone must still reach git: the file is tracked, and a
    // silent skip leaves the checkout and its history divergent forever — the
    // canvas moved and `git show HEAD` still lists it at the old path.
    const repo = tmp();
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
    });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default () => null;\n');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });
    await agent.flush();
    assert.ok(
      execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).includes('home.tsx'),
      'tracked before the move'
    );

    // Somebody else (the studio child) parks it, THEN the stamp is seen.
    rmSync(join(repo, '.design/home.tsx'));
    doc.getMap('syncMeta').set('movedTo', 'ui/folder/home.tsx');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });

    const commit = await agent.flush();
    assert.equal(commit.ok, true, `the deletion commits: ${JSON.stringify(commit)}`);
    assert.ok(
      !execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).includes('home.tsx'),
      'git agrees the canvas is gone from the old path'
    );
    await agent.stop();
  });

  it('refuses a move that names a file rather than a canvas', async () => {
    // `movedTo` is peer-written CRDT content, and acting on it quarantines the
    // canvas and stages a git deletion. An existence probe answers yes for
    // `config.json`, so a peer could retire every slug in a project by naming
    // a path that certainly exists. A move ends at a CANVAS; anything else
    // HOLDs, which costs a ghost and never a deletion.
    const repo = tmp();
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
    });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default function Home() { return <main/>; }\n');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });
    await agent.flush();
    assert.ok(existsSync(join(repo, '.design/home.tsx')));

    writeFileSync(join(repo, '.design/config.json'), '{}');
    doc.getMap('syncMeta').set('movedTo', 'config.json');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });

    const other = new Y.Doc();
    other.getText('html').insert(0, 'x');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/other',
      document: other,
      user: null,
    });

    assert.ok(existsSync(join(repo, '.design/home.tsx')), 'the canvas is still there');
    assert.ok(!existsSync(join(repo, '.design/_trash')), 'nothing was quarantined');
  });

  it('stops quarantining once a burst looks like a project being emptied', async () => {
    const repo = tmp();
    const warned = [];
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: { log() {}, error() {}, warn: (m) => warned.push(String(m)) },
    });
    await agent.start();

    // One canvas that stays put, and 20 that all claim to have moved into it.
    // Every retirement is individually well-formed and the target never goes
    // away, so nothing HOLDs for an ordinary reason — only the breaker can
    // stop the drain.
    const home = new Y.Doc();
    home.getText('html').insert(0, 'export default () => <main/>;\n');
    home.getMap('syncMeta').set('path', 'ui/home.tsx');
    await agent.onDocumentStored({
      documentName: 'ws/acme/main/ui-home',
      document: home,
      user: null,
    });

    const N = 20;
    const docs = [];
    for (let i = 0; i < N; i++) {
      const d = new Y.Doc();
      d.getText('html').insert(0, `export default () => <i>${i}</i>;\n`);
      d.getMap('syncMeta').set('path', `ui/c${i}.tsx`);
      await agent.onDocumentStored({
        documentName: `ws/acme/main/ui-c${i}`,
        document: d,
        user: null,
      });
      docs.push(d);
    }
    await agent.flush();

    for (let i = 0; i < N; i++) {
      docs[i].getMap('syncMeta').set('movedTo', 'ui/home.tsx');
      await agent.onDocumentStored({
        documentName: `ws/acme/main/ui-c${i}`,
        document: docs[i],
        user: null,
      });
    }

    const gone = Array.from({ length: N }, (_, i) =>
      existsSync(join(repo, `.design/ui/c${i}.tsx`))
    ).filter((present) => !present).length;
    assert.ok(gone > 0, 'the ordinary move protocol still works');
    assert.ok(gone <= 10, `the breaker capped the burst — ${gone} of ${N} were quarantined`);
    assert.ok(
      warned.some((m) => m.includes('move-retirement breaker')),
      `the pause is announced, not silent: ${warned.join(' | ')}`
    );
    assert.ok(existsSync(join(repo, '.design/ui/home.tsx')), 'the target is untouched');
  });

  it('a retired doc the checkout never materialised is simply ignored', async () => {
    const repo = tmp();
    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
    });
    await agent.start();
    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'ghost body');
    doc.getMap('syncMeta').set('movedTo', 'ui/elsewhere.tsx');
    const out = await agent.onDocumentStored({
      documentName: 'ws/acme/main/never-here',
      document: doc,
      user: null,
    });
    assert.equal(out, null);
    assert.ok(!existsSync(join(repo, '.design/never-here.tsx')), 'nothing materialised');
    await agent.stop();
  });
});

describe('the hub keeps history even when the project gitignores the design root', () => {
  // DDR-228 makes a hub-owned project gitignore `/.design/`. This checkout is
  // seeded from that repo, so it inherits the rule — and the hub would stop
  // committing the one thing it exists to hold. That matters because the
  // generation backup is `git bundle --all` (committed objects only) and
  // object storage mirrors `assets/` alone: without this, a hub-owned design
  // system has no durable copy anywhere, and a deletion is unrecoverable
  // rather than merely annoying.
  it('commits a canvas the .gitignore excludes', {
    skip: gitAvailable() ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo, stdio: 'ignore' });
    writeFileSync(
      join(repo, '.gitignore'),
      '# maude:hub-owned:begin\n/.design/\n# maude:hub-owned:end\n'
    );
    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'seed'], { cwd: repo, stdio: 'ignore' });

    const agent = createWorkspaceAgent({
      repoDir: repo,
      designRel: '.design',
      debounceMs: 5,
      log: silent(),
    });
    await agent.start();

    const doc = new Y.Doc();
    doc.getText('html').insert(0, 'export default function Home() { return <main/>; }\n');
    await agent.onDocumentStored({ documentName: 'ws/acme/main/home', document: doc, user: null });
    const res = await agent.flush();

    assert.equal(res.ok, true, `the commit landed: ${JSON.stringify(res)}`);
    const tracked = execFileSync('git', ['ls-files', '--', '.design'], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.match(tracked, /\.design\/home\.tsx/, 'the canvas is in history despite the ignore');
  });
});
