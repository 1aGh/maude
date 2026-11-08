import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const source = readFileSync(
  new URL('../../../apps/desktop/e2e/multiplayer/tree-drag.js', import.meta.url),
  'utf8'
);

// Quality CI installs no Playwright browser; without one this is a skip, not a failure.
const noBrowser = !existsSync(chromium.executablePath()) && 'no Playwright chromium installed';
test('serialized tree gesture carries the dragstart handler payload through drop', {
  skip: noBrowser,
}, async () => {
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

test('a drop target the windowed list has not drawn is scrolled to, with the drag held', {
  skip: noBrowser,
}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<div data-rows data-drawn style="height:100px;overflow:auto;position:relative">
         <div id="from" draggable="true" style="height:20px">Folder</div>
         <div style="height:2000px"></div>
       </div>`
    );
    await page.evaluate(() => {
      const list = document.querySelector('[data-rows]');
      document.querySelector('#from').addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', 'held across the scroll');
      });
      // the list draws the target only once it is scrolled near it, as the Canvases panel does
      list.addEventListener('scroll', () => {
        if (list.scrollTop < 400 || document.querySelector('#to')) return;
        const to = document.createElement('div');
        to.id = 'to';
        to.textContent = 'Target';
        to.addEventListener('dragover', (event) => event.preventDefault());
        to.addEventListener('drop', (event) => {
          event.preventDefault();
          event.currentTarget.textContent = event.dataTransfer.getData('text/plain');
        });
        list.insertBefore(to, list.lastElementChild);
      });
    });
    await page.evaluate(`(${source})(${JSON.stringify({ source: '#from', destination: '#to' })})`);
    assert.equal(await page.locator('#to').textContent(), 'held across the scroll');
  } finally {
    await browser.close();
  }
});
