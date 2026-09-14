import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const source = readFileSync(
  new URL('../../../apps/desktop/e2e/multiplayer/tree-drag.js', import.meta.url),
  'utf8'
);

test('serialized tree gesture carries the dragstart handler payload through drop', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="from" draggable="true">Folder</div><div id="to">Target</div>`);
    await page.evaluate(() => {
      document.querySelector('#from').addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', 'payload written by the UI');
      });
      document.querySelector('#to').addEventListener('dragover', (event) => event.preventDefault());
      document.querySelector('#to').addEventListener('drop', (event) => {
        event.preventDefault();
        event.currentTarget.textContent = event.dataTransfer.getData('text/plain');
      });
    });
    assert.equal(await page.evaluate(() => typeof globalThis.__name), 'undefined');
    await page.evaluate(`(${source})(${JSON.stringify({ source: '#from', destination: '#to' })})`);
    assert.equal(await page.locator('#to').textContent(), 'payload written by the UI');
    await assert.rejects(
      page.evaluate(`(${source})(${JSON.stringify({ source: '#missing', destination: '#to' })})`),
      /source\/destination absent/
    );
  } finally {
    await browser.close();
  }
});
