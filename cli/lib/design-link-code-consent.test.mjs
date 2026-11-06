// fix/207 — `maude design link`'s shared-code question.
//
// A recorded `false` (from `--yes`, or a link run without a terminal) used to end the question for
// good: `askCodeModuleConsent` returned early on any recorded boolean, so the hint it printed —
// "Re-link and answer yes to change it" — could not be followed. Now an interactive re-link asks
// again after a no, a non-interactive one still records no unless `--allow-code` says yes, and the
// hint points at the in-app answer (Sync details › Allow shared code…).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { askCodeModuleConsent } from './design-link.mjs';
import { addHub, getHub } from './hubs-config.mjs';

const HUB = 'https://hub.example.com';
let dir;
let prev;
let out;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'link-code-consent-'));
  prev = process.env.HUBS_CONFIG_PATH;
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  addHub(HUB, 'tok');
  out = [];
});
afterEach(() => {
  if (prev === undefined) delete process.env.HUBS_CONFIG_PATH;
  else process.env.HUBS_CONFIG_PATH = prev;
  rmSync(dir, { recursive: true, force: true });
});

const io = (answers) => {
  const asked = [];
  return {
    asked,
    opts: {
      interactive: true,
      prompt: async (q) => {
        asked.push(q);
        return answers.shift() ?? false;
      },
      write: (s) => out.push(s),
    },
  };
};

describe('maude design link — the shared-code question', () => {
  test('an interactive re-link asks AGAIN after a recorded no, and a yes is recorded', async () => {
    await askCodeModuleConsent(HUB, {
      assumeYes: true,
      interactive: false,
      write: (s) => out.push(s),
    });
    assert.equal(getHub(HUB).codeModulesAllowed, false);

    const t = io([true]);
    await askCodeModuleConsent(HUB, t.opts);
    assert.equal(t.asked.length, 1);
    assert.equal(getHub(HUB).codeModulesAllowed, true);
  });

  test('a recorded yes is kept without asking', async () => {
    const first = io([true]);
    await askCodeModuleConsent(HUB, first.opts);
    const again = io([false]);
    await askCodeModuleConsent(HUB, again.opts);
    assert.equal(again.asked.length, 0);
    assert.equal(getHub(HUB).codeModulesAllowed, true);
  });

  test('--yes and no terminal record NO; --allow-code is the only non-interactive yes', async () => {
    await askCodeModuleConsent(HUB, {
      assumeYes: true,
      interactive: false,
      write: (s) => out.push(s),
    });
    assert.equal(getHub(HUB).codeModulesAllowed, false);
    await askCodeModuleConsent(HUB, { interactive: false, write: (s) => out.push(s) });
    assert.equal(getHub(HUB).codeModulesAllowed, false);
    await askCodeModuleConsent(HUB, {
      assumeYes: true,
      allowCode: true,
      interactive: false,
      write: (s) => out.push(s),
    });
    assert.equal(getHub(HUB).codeModulesAllowed, true);
  });

  test('the no-hint points at the in-app answer, not at an impossible re-link', async () => {
    await askCodeModuleConsent(HUB, { interactive: false, write: (s) => out.push(s) });
    const said = out.join('');
    assert.match(said, /Sync details/);
    assert.match(said, /Allow shared code/);
    assert.match(said, /--allow-code/);
    assert.doesNotMatch(said, /answer yes/);
  });

  test('a loopback pairing is never asked and records nothing', async () => {
    const t = io([true]);
    await askCodeModuleConsent(HUB, { ...t.opts, loopback: true });
    assert.equal(t.asked.length, 0);
    assert.equal(getHub(HUB).codeModulesAllowed, undefined);
  });
});
