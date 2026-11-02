// S3.7b — the sign-in return address may carry the presentation follow form
// (`/?open=<rel>&present=follow`), and nothing else. Both RETURN_RULES twins —
// the hub's `validateReturnTo` and the client's `normalizeReturnAddress` —
// agree on every fixture here (the parity half), and the follow form survives
// the sign-in cookie round trip.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeReturnAddress } from '../../studio/client/share-link.js';
import { setReturnTo, takeReturnTo, validateReturnTo } from '../src/return-to.mjs';
import { presentReturnTo } from '../src/routes-v2/present.mjs';

function response() {
  const headers = {};
  return {
    headers,
    getHeader: (key) => headers[key],
    setHeader: (key, value) => {
      headers[key] = value;
    },
  };
}
const roundTrip = (value) => {
  const res = response();
  setReturnTo(res, value);
  const saved = res.headers['set-cookie']?.[0].split(';')[0] ?? 'maude_return=invalid';
  return takeReturnTo({ headers: { cookie: saved } }, response());
};

const enc = (rel) => rel.split('/').map(encodeURIComponent).join('/');

/** Refused by both twins — today's refusals plus every near miss of the follow form. */
const REFUSED = [
  'https://evil',
  '//evil',
  '/\\evil',
  '/?open=../x',
  '/?open=%2fetc',
  '/admin',
  '/?open=a&x=1',
  '/?open=a#hash',
  '/?open=a//b',
  '/?open=a%00b',
  '/?open=%ZZ',
  `/?open=${'a'.repeat(700)}`,
  // the follow form's near misses
  '/?open=ui/A.tsx&present=x',
  '/?open=ui/A.tsx&present=',
  '/?open=ui/A.tsx&present=follow&x=1',
  '/?open=ui/A.tsx&present=follow&present=follow',
  '/?open=ui/A.tsx&present=follow#x',
  '/?open=ui/A.tsx&present=Follow',
  '/?open=ui/A.tsx&Present=follow',
  '/?open=ui/A.tsx&present=%66ollow',
  '/?open=ui/A.tsx&present=follow%20',
  '/?open=ui/A.tsx&amp;present=follow',
  '/?open=ui/A.tsx&present=follow&',
  '/?present=follow&open=ui/A.tsx',
  '/?open=&present=follow',
  '/?open=../x&present=follow',
  '//evil/?open=ui/A.tsx&present=follow',
  '/present/ui/A',
  '/present/ui/A.tsx',
  `/?open=${'a'.repeat(700)}&present=follow`,
];

/** Accepted by both twins, each with its canonical form. */
const ACCEPTED = [
  ['/?open=ui/A.tsx', '/?open=ui/A.tsx'],
  ['/?open=ui/A.tsx&present=follow', '/?open=ui/A.tsx&present=follow'],
  [`/?open=${enc('ui/Žába.tsx')}&present=follow`, `/?open=${enc('ui/Žába.tsx')}&present=follow`],
  [
    `/?open=${enc('ui/A+B & C.tsx')}&present=follow`,
    `/?open=${enc('ui/A+B & C.tsx')}&present=follow`,
  ],
  // An encoded `&present=follow` is part of a FILE NAME, never the follow form.
  ['/?open=a%26present%3Dfollow', '/?open=a%26present%3Dfollow'],
  ['/?open=.design/ui/A.tsx&present=follow', '/?open=ui/A.tsx&present=follow'],
];

test('the follow form is accepted, canonical, and survives the sign-in cookie', () => {
  for (const [value, canonical] of ACCEPTED) {
    assert.equal(validateReturnTo(value), canonical, value);
    assert.equal(roundTrip(value), canonical, value);
  }
  const long = `/?open=${enc(`ui/${'界'.repeat(505)}.tsx`)}&present=follow`;
  assert.equal(validateReturnTo(long), long);
  assert.equal(roundTrip(long), long);
});

test('every near miss of the follow form is refused, and a refused cookie returns to /', () => {
  for (const bad of REFUSED) {
    assert.equal(validateReturnTo(bad), null, bad);
    assert.equal(roundTrip(bad), '/', bad);
  }
  // A forged follow cookie keeps the identity rules (base64url, canonical, bounded).
  for (const forged of [
    'f.',
    'f._w',
    'f.YQ=',
    'F.YQ',
    'f.f.YQ',
    `f.${Buffer.from('../x').toString('base64url')}`,
  ]) {
    const res = response();
    assert.equal(takeReturnTo({ headers: { cookie: `maude_return=${forged}` } }, res), '/', forged);
  }
});

test('RETURN_RULES parity — the client twin agrees on every fixture', () => {
  for (const bad of REFUSED) assert.equal(normalizeReturnAddress(bad), null, bad);
  for (const [value, canonical] of ACCEPTED) {
    assert.equal(normalizeReturnAddress(value), canonical, value);
    assert.equal(normalizeReturnAddress(value), validateReturnTo(value), value);
  }
});

test('presentReturnTo builds exactly the follow form for a canvas', () => {
  assert.equal(presentReturnTo('ui/A.tsx'), '/?open=ui/A.tsx&present=follow');
  assert.equal(presentReturnTo('combine kampan.tsx'), '/?open=combine%20kampan.tsx&present=follow');
  assert.equal(validateReturnTo(presentReturnTo('ui/Žába.tsx')), presentReturnTo('ui/Žába.tsx'));
});
