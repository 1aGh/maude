// #164 B1 (H6) — READERS is pinned. A reader is a command that is "provably a read": a call made only
// of readers opens no window, so anything it writes lands as outside. A tool that can write by a flag
// must never be one (the p8-secfix-hook F1/D2 class, #164): the pin makes adding a reader a visible,
// reviewed change.
//
// The rule a new reader must pass ("cannot write"): none of its flags, in any release, writes a file
// or runs a program -- no `-o FILE` / `--output`, no `w` command, no `-i` in place, no `--pre CMD`, no
// `-exec`. `find` is the one exception, and only because FIND_WRITES (bash-guard.mjs) refuses its
// writing actions.
//
// Run: node --test cli/lib/bash-guard-readers.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bashMayWrite, READERS, READERS_PIN } from './bash-guard.mjs';

test('READERS equals READERS_PIN (adding a reader means changing the pin, and passing the rule above)', () => {
  assert.deepEqual([...READERS].sort(), [...READERS_PIN].sort());
  assert.equal(Object.isFrozen(READERS_PIN), true);
  assert.equal(new Set(READERS_PIN).size, READERS_PIN.length);
});

test('tools whose flags write or run something are not readers', () => {
  for (const name of [
    'sort', // -o FILE
    'uniq', // uniq in out
    'sed', // -i, w
    'awk', // print > f
    'rg', // --pre CMD
    'tree', // -o FILE
    'file', // -C -m
    'xxd', // -r writes a binary
    'tee',
    'git',
    'env',
    'xargs',
    'python3',
    'node',
    'cp',
    'touch',
  ])
    assert.equal(READERS_PIN.includes(name), false, `${name} can write by a flag`);
});

test('each reader with plain arguments is a read, and with `> f` it may write', () => {
  for (const name of READERS_PIN) {
    // `[` needs its closing bracket; `cd` / `pushd` take a directory; the rest take a plain word
    const plain = name === '[' ? '[ -f x ]' : `${name} x`;
    assert.equal(bashMayWrite(plain), false, plain);
    assert.equal(bashMayWrite(`${plain} > out.txt`), true, `${plain} > out.txt`);
    assert.equal(bashMayWrite(`${plain} >> out.txt`), true, `${plain} >> out.txt`);
  }
});

test('find is a reader until an action that runs or writes follows', () => {
  assert.equal(bashMayWrite('find . -name x'), false);
  for (const a of ['-delete', '-exec rm {} ;', '-fprint out', '-ok rm {} ;'])
    assert.equal(bashMayWrite(`find . ${a}`), true, a);
});

test('a reader reached through a path or a wrapper is not trusted', () => {
  assert.equal(bashMayWrite('/tmp/x/cat f'), true);
  assert.equal(bashMayWrite('PATH=/tmp/x cat f'), true);
  assert.equal(bashMayWrite('sudo cat f'), true);
});
