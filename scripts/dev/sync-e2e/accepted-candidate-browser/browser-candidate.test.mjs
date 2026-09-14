import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { start } from './dist/fixture-server.mjs';
import { desktopRequire, evidenceDir, hubRequire, own } from './paths.mjs';

const { chromium } = desktopRequire('@playwright/test');
const Y = hubRequire('yjs');
const html = `<!doctype html><meta charset="utf-8"><title>T7 Browser candidate proof</title>
<style>body{font:16px system-ui;margin:24px}textarea{width:90%;height:100px}pre{white-space:pre-wrap;border:1px solid #aaa;padding:12px}label{display:block;margin:8px 0}</style>
<h1>Accepted / optimistic candidate</h1><p id="status">Loading</p>
<h2>Accepted shared source</h2><pre id="accepted"></pre><h2>Private candidate</h2><pre id="candidate"></pre>
<label>Transaction <input id="transaction"></label><label>Depends on <input id="depends"></label>
<label>Source <textarea id="source"></textarea></label><button id="save">Save candidate</button><button id="retry">Retry retained bytes</button><button id="restore">Restore candidate</button>
<script type="module" src="/browser-client.js"></script>`;
async function site(hub) {
  const server = createServer(async (req, res) => {
    if (req.url === '/config') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ws: hub.ws, document: 'projects/p/accepted/d' }));
      return;
    }
    if (req.url === '/browser-client.js') {
      res.setHeader('content-type', 'application/javascript');
      res.end(readFileSync(join(own, 'dist/browser-client.js')));
      return;
    }
    if (req.url === '/proposals') {
      const body = [];
      for await (const c of req) body.push(c);
      const reply = await fetch(hub.http + '/proposals', {
        method: 'POST',
        headers: { authorization: req.headers.authorization || '' },
        body: Buffer.concat(body),
      });
      res.statusCode = reply.status;
      res.setHeader('content-type', 'application/json');
      res.end(await reply.text());
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(label);
    await delay(10);
  }
}
async function ready(page) {
  await page.waitForFunction(() => window.spike?.state.ready);
}
async function unchanged(hub, pages, root, base) {
  assert.equal(hub.kernel.state.source, base);
  assert.equal(hub.accepted.getText('source').toString(), base);
  assert.equal(readFileSync(join(root, 'checkout/canvas.tsx'), 'utf8'), base);
  assert.equal(hub.kernel.state.history.length, 0);
  for (const page of pages) assert.equal(await page.locator('#accepted').textContent(), base);
}
async function save(page, id, source, depends = '') {
  await page.locator('#transaction').fill(id);
  await page.locator('#depends').fill(depends);
  await page.locator('#source').fill(source);
  await page.locator('#save').click();
  await page.waitForFunction((id) => window.spike.state.lastResult?.transactionId === id, id);
  return page.evaluate(() => window.spike.state.lastResult);
}

test('Chromium accepted isolation, IndexedDB U1/U2 reload/rebase, explicit unsaved storage failures', {
  timeout: 30000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 't7-browser-'));
  const hub = await start(root);
  const http = await site(hub);
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true });
    const writer = await browser.newPage();
    const reader = await browser.newPage();
    for (const page of [writer, reader]) {
      page.setDefaultTimeout(5000);
      page.on('pageerror', (error) => errors.push(error.message));
    }
    await Promise.all([
      writer.goto(http.url + '/?role=writer'),
      reader.goto(http.url + '/?role=reader'),
    ]);
    await Promise.all([ready(writer), ready(reader)]);
    const base = hub.kernel.state.source;
    const acceptedBytes = Buffer.from(Y.encodeStateAsUpdate(hub.accepted));
    for (const [role, author, peer] of [
      ['writer', writer, reader],
      ['reader', reader, writer],
    ]) {
      for (const type of [0, 4])
        for (const kind of [1, 2]) {
          const before = hub.seen.filter(
            (s) => s.token === role && s.type === type && s.subtype === kind
          ).length;
          await author.evaluate(
            ({ type, kind }) =>
              window.spike.raw(type, kind, 'REJECTED_BROWSER_' + type + '_' + kind),
            { type, kind }
          );
          await until(
            () =>
              hub.seen.filter((s) => s.token === role && s.type === type && s.subtype === kind)
                .length > before,
            'server receives browser raw packet'
          );
          const id = await author.evaluate(() => window.spike.state.clientId);
          const marker = type * 10 + kind;
          await author.evaluate((marker) => window.spike.cursor(marker), marker);
          await peer.waitForFunction(
            ({ id, marker }) =>
              window.spike
                .awareness()
                .some(([client, state]) => client === id && state?.cursor?.[0] === marker),
            { id, marker }
          );
          await unchanged(hub, [writer, reader], root, base);
          assert.deepEqual(Buffer.from(Y.encodeStateAsUpdate(hub.accepted)), acceptedBytes);
        }
    }
    const count = hub.seen.filter((s) => s.token === 'writer' && s.subtype === 1).length;
    const poisonedId = await writer.evaluate(() => window.spike.poisonedHandshake());
    await until(
      () => hub.seen.filter((s) => s.token === 'writer' && s.subtype === 1).length > count,
      'browser fresh-session SyncStep2'
    );
    await writer.evaluate(() => window.spike.poisonCursor(999));
    await reader.waitForFunction(
      (id) =>
        window.spike
          .awareness()
          .some(([client, state]) => client === id && state?.cursor?.[0] === 999),
      poisonedId
    );
    await unchanged(hub, [writer, reader], root, base);
    await writer.evaluate(() => window.spike.destroyPoison());
    const invalid = 'export default function Canvas(){return <div>REJECTED_U1_BROWSER</span>}';
    const repaired = 'export default function Canvas(){return <div>REPAIRED_U2_BROWSER</div>}';
    assert.equal((await save(writer, 'u1', invalid)).code, 'source-invalid');
    assert.equal(await writer.locator('#candidate').textContent(), invalid);
    await unchanged(hub, [writer, reader], root, base);
    assert.equal((await save(writer, 'u2', repaired, 'u1')).code, 'dependency-missing');
    const retained = await writer.evaluate(() => window.spike.list());
    assert.equal(retained.length, 2);
    assert.equal(await writer.locator('#candidate').textContent(), repaired);
    await unchanged(hub, [writer, reader], root, base);
    await writer.reload();
    await ready(writer);
    assert.deepEqual(await writer.evaluate(() => window.spike.list()), retained);
    assert.equal(await writer.locator('#candidate').textContent(), repaired);
    await unchanged(hub, [writer, reader], root, base);
    assert.equal((await writer.evaluate(() => window.spike.retry('u1'))).code, 'source-invalid');
    assert.equal(
      (await writer.evaluate(() => window.spike.retry('u2'))).code,
      'dependency-missing'
    );
    const result = await save(writer, 'u3', repaired);
    assert.equal(result.status, 'accepted');
    assert.equal(result.revision, 1);
    await reader.waitForFunction((repaired) => window.spike.state.accepted === repaired, repaired);
    assert.equal(hub.kernel.state.history.length, 1);
    assert.equal(readFileSync(join(root, 'checkout/canvas.tsx'), 'utf8'), repaired);
    assert.deepEqual((await writer.evaluate(() => window.spike.list())).slice(0, 2), retained);
    await writer.reload();
    await ready(writer);
    assert.deepEqual(await writer.evaluate(() => window.spike.retry('u3')), result);
    assert.equal(hub.kernel.state.history.length, 1);
    for (const fault of ['QuotaExceededError', 'AbortError']) {
      const retainedBefore = await writer.evaluate(() => window.spike.list());
      const submissions = await writer.evaluate(() => window.spike.state.submitted);
      await writer.evaluate((fault) => {
        window.spike.storageFault = fault;
      }, fault);
      await writer.locator('#transaction').fill('failed-' + fault);
      await writer.locator('#source').fill('export default () => <div>UNSAVED_' + fault + '</div>');
      await writer.locator('#save').click();
      await writer.waitForFunction(
        (fault) => window.spike.state.status === 'Unsaved: ' + fault,
        fault
      );
      assert.deepEqual(await writer.evaluate(() => window.spike.list()), retainedBefore);
      assert.equal(await writer.evaluate(() => window.spike.state.submitted), submissions);
      await writer.screenshot({
        path: join(evidenceDir, 'browser-unsaved-' + fault + '.png'),
        fullPage: true,
      });
      assert.match(await writer.locator('#candidate').textContent(), /UNSAVED_/);
      assert.equal(hub.kernel.state.revision, 1);
      assert.equal(await reader.locator('#accepted').textContent(), repaired);
      await writer.reload();
      await ready(writer);
      assert.equal(await writer.locator('#candidate').textContent(), repaired);
      assert.deepEqual(await writer.evaluate(() => window.spike.list()), retainedBefore);
    }
    assert.deepEqual(await writer.evaluate(() => window.spike.retry('u3')), result);
    assert.equal(hub.kernel.state.history.length, 1);
    assert.deepEqual(errors, []);
    const evidence = {
      node: process.version,
      chromium: browser.version(),
      rawFrames: hub.seen.filter((s) => s.subtype === 1 || s.subtype === 2).length,
      retainedRequests: retained.map((r) => ({
        id: r.id,
        request: r.request,
        snapshot: r.snapshot,
        update: r.update,
      })),
      revision: hub.kernel.state.revision,
      history: hub.kernel.state.history.length,
      storageFaults: [
        'QuotaExceededError injected inside real transaction',
        'AbortError injected inside real transaction',
      ],
      pageErrors: errors,
    };
    writeFileSync(join(evidenceDir, 'browser-evidence.json'), JSON.stringify(evidence, null, 2));
    await writer.screenshot({ path: join(evidenceDir, 'browser-proof.png'), fullPage: true });
    t.diagnostic(
      JSON.stringify({
        node: evidence.node,
        chromium: evidence.chromium,
        revision: evidence.revision,
        history: evidence.history,
      })
    );
  } finally {
    if (browser) await browser.close();
    await http.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});
