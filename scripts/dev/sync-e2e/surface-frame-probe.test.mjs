import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const script = readFileSync(
  new URL('../../../apps/desktop/src-tauri/src/e2e-frame-probe.js', import.meta.url),
  'utf8'
);
test('debug probe observes an isolated canvas without disabling same-origin enforcement', async () => {
  const canvas = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<h1>Rendered on another origin</h1><input value="unchanged">
      <button onclick="this.textContent='Clicked through UI'">Click me</button>
      <div contenteditable="true" aria-label="Editor">Initial</div>
      <div id="gesture" style="width:100px;height:100px" onpointerup="this.textContent='Pointer finished'">Drag here</div>
      <div id="drop" ondrop="event.preventDefault(); event.dataTransfer.files[0].text().then(t => this.textContent=t)">Drop here</div>`);
  });
  await new Promise((done) => canvas.listen(0, '127.0.0.1', done));
  const canvasUrl = `http://127.0.0.1:${canvas.address().port}`;
  const shell = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(
      `<iframe data-testid="canvas-frame" sandbox="allow-scripts allow-same-origin" src="${canvasUrl}"></iframe>`
    );
  });
  await new Promise((done) => shell.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(script);
    await page.goto(`http://127.0.0.1:${shell.address().port}`);
    await page.frameLocator('iframe').locator('h1').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('iframe').contentDocument), null);
    const result = await page.evaluate(() => window.__maudeE2EFrameProbe('h1'));
    assert.equal(result.text, 'Rendered on another origin');
    assert.equal(result.visible, true);
    await page.evaluate(() =>
      window.__maudeE2EFrameProbe('input', 'setValue', 'unexpected mutation')
    );
    assert.equal(await page.frameLocator('iframe').locator('input').inputValue(), 'unchanged');
    assert.equal(await page.evaluate(() => window.__maudeE2EFrameProbe('#missing')), null);
    // A same-origin sender that is NOT the selected canvas cannot spoof its response.
    const guarded = await page.evaluate(async () => {
      const pending = window.__maudeE2EFrameProbe('h1');
      window.postMessage(
        {
          protocol: 'maude-e2e-frame-probe-v1',
          kind: 'response',
          id: 4,
          result: { text: 'spoofed' },
        },
        location.origin
      );
      return pending;
    });
    assert.equal(guarded.text, 'Rendered on another origin');
    await page.evaluate(() => window.__maudeE2EFrameProbe('button', 'click'));
    assert.equal(
      await page.frameLocator('iframe').locator('button').textContent(),
      'Clicked through UI'
    );
    await page.evaluate(() =>
      window.__maudeE2EFrameProbe('[contenteditable]', 'editText', 'Typed text')
    );
    assert.equal(
      await page.frameLocator('iframe').locator('[contenteditable]').textContent(),
      'Typed text'
    );
    await page.evaluate(() =>
      window.__maudeE2EFrameProbe('#gesture', 'pointer', { dx: 30, dy: 20 })
    );
    assert.equal(
      await page.frameLocator('iframe').locator('#gesture').textContent(),
      'Pointer finished'
    );
    await page.evaluate(() =>
      window.__maudeE2EFrameProbe('#drop', 'dropFile', {
        name: 'fixture.png',
        type: 'image/png',
        base64: btoa('actual transferred bytes'),
      })
    );
    assert.equal(
      await page.frameLocator('iframe').locator('#drop').textContent(),
      'actual transferred bytes'
    );
    const rejected = await page.evaluate(() =>
      window.__maudeE2EFrameProbe('#drop', 'dropFile', {
        name: '../outside.png',
        type: 'image/png',
        base64: btoa('unexpected'),
      })
    );
    assert.match(rejected.error, /Unsupported/);
    assert.equal(
      await page.frameLocator('iframe').locator('#drop').textContent(),
      'actual transferred bytes'
    );
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.dataset.testid = 'canvas-load-error';
      overlay.textContent = 'Canvas unavailable';
      document.body.append(overlay);
    });
    const blocked = await page.evaluate(() => window.__maudeE2EFrameProbe('#missing'));
    assert.match(blocked.error, /obscured/);
    assert.equal(blocked.visible, false);
  } finally {
    await browser.close();
    await Promise.all([
      new Promise((done) => shell.close(done)),
      new Promise((done) => canvas.close(done)),
    ]);
  }
});
