// p8-sweep-close — an error a later fix removed is listed apart (not counted) only when its shard was crawled
// before the fix; a shard on the fix that draws it again counts it, and an unknown build excuses nothing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedError } from '../v2-verify/dead-controls/fixed-since.mjs';
import { groupErrors, summarize } from '../v2-verify/dead-controls/report.mjs';

const CORS = {
  mode: 'browser',
  shell: 'project',
  surface: 'project',
  control: '<load>',
  kind: 'console.error',
  text: "Access to fetch at 'http://localhost:51681/_health' from origin 'http://localhost:48519' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
};
const OTHER = { ...CORS, text: 'TypeError: x is undefined' };
// a fake git: exit 1 = "not an ancestor", 0 = ancestor, 128 = unknown object
const git = (answers) => (args) => {
  const code = answers[args[3]];
  if (code === 0) return '';
  const err = new Error('git');
  err.status = code ?? 128;
  throw err;
};

test('a shard with no build (from before the stamp) is excused', () => {
  assert.ok(fixedError({ ...CORS }, git({})));
});

test('a shard crawled before the fix is excused; one crawled on it is not', () => {
  assert.ok(fixedError({ ...CORS, build: 'old' }, git({ old: 1 })));
  assert.equal(fixedError({ ...CORS, build: 'new' }, git({ new: 0 })), undefined);
});

test('an unknown build excuses nothing (fail closed)', () => {
  assert.equal(fixedError({ ...CORS, build: 'unknown' }, git({})), undefined);
});

test('an error no fix covers is never excused', () => {
  assert.equal(fixedError({ ...OTHER }, git({})), undefined);
});

test('the summary counts only what is not excused', () => {
  const s = summarize([], [{ ...CORS }, { ...OTHER }]);
  assert.equal(s.errors, 1);
  assert.equal(groupErrors([{ ...CORS }], { fixed: true }).length, 1);
});
