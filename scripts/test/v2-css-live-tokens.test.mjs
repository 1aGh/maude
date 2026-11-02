import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectLive } from '../lib/css-live-tokens.mjs';

test('a multi-word literal ending in -- before + makes the whole family live (dock.jsx: "sh-dockslot sh-dockslot--" + side)', () => {
  const live = collectLive(["const c = 'sh-dockslot sh-dockslot--' + side + ' x';"]);
  assert.equal(live('sh-dockslot--left'), true);
  assert.equal(live('sh-dockslot--right'), true);
});

test('a template prefix and a single-word literal prefix still work', () => {
  const live = collectLive(['`sh-corner--${at}`', "'foo-' + x"]);
  assert.equal(live('sh-corner--ai-left'), true);
  assert.equal(live('foo-bar'), true);
});

test('a name that is nowhere in the sources is not live', () => {
  const live = collectLive(["const c = 'sh-dockslot sh-dockslot--' + side;", 'className="a b"']);
  assert.equal(live('ex-shape-pic'), false);
  assert.equal(live('sh-dock'), false);
});
