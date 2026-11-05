// The privacy notice's claims must be mechanically true — Cloud Phase 26.
//
// Same mechanism as `trust-claims.test.mjs`, for the same reason and against a
// sharper failure. Until this phase the notice said, verbatim:
//
//     "We hold no analytics, no tracking pixels, and no advertising
//      identifiers."
//
// Shipping a single `writeDataPoint` would have made that sentence false on
// the day it deployed, and GDPR Art. 13 wants the notice BEFORE the
// processing, not after. Nobody would have noticed, because a privacy page is
// exactly the document nobody re-reads.
//
// So the revision and the first emitted event shipped in the same change, and
// this file is what keeps them from drifting apart afterwards. It checks the
// page against the CODE, in both directions:
//
//   - what the page still PROMISES must still be true of the code;
//   - what the code now DOES must still be described on the page.
//
// The second direction is the one that matters. A claim-guard that only
// verifies the promises would stay green through a new event type carrying an
// email address.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { track } from './analytics.mjs';
import { EVENTS, BLOB as EVENTS_BLOB, toDataPoint, validateEvent } from './events.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLOUD = join(REPO, 'apps/cloud');
const page = readFileSync(join(REPO, 'site/content/docs/legal/privacy.mdx'), 'utf8');
const dpa = readFileSync(join(REPO, 'site/content/docs/legal/dpa.mdx'), 'utf8');

// ------------------------------------------------- the page describes reality

describe('the page describes what the code actually does', () => {
  it('no longer claims we hold no analytics, because we now do', () => {
    // The specific sentence this phase had to retire. Left in place it would
    // have been a false statement on a legal page, published by a change that
    // never mentioned it.
    assert.doesNotMatch(page, /no analytics, no tracking pixels/);
    assert.doesNotMatch(page, /We hold \*\*no analytics/);
  });

  it('says what a usage event contains, in the same words the code enforces', () => {
    assert.match(page, /Usage events/i);
    assert.match(page, /account id/i);
    assert.match(page, /never contains? your email address/i);
    assert.match(page, /never contains? anything from inside your designs/i);
  });

  it('discloses the PROJECT ID, which every datapoint also carries', () => {
    // The first revision enumerated "account id, action, timestamp" and left
    // this out — an incomplete enumeration on a legal page, and the exact
    // drift this guard exists to catch. A project id is a slug the customer
    // typed; it can be a person's or a client's name.
    assert.match(page, /project id/i);
    assert.equal(EVENTS_BLOB.projectId, 'blob2', 'blob2 is the project id');
    const dp = toDataPoint({ name: 'invite_created', accountId: 'acct_1', projectId: 'acme-corp' });
    assert.ok(dp.blobs.includes('acme-corp'), 'the project id really does travel');
  });

  it('discloses the tenant SIZE figures the cell reports hourly', () => {
    // tenant_stats/tenant_render are personal data about a customer's project
    // in the same way a mailbox size is, and they were absent from the notice.
    assert.match(page, /size figures/i);
    assert.match(page, /Counts and sizes only/i);
    for (const name of ['tenant_stats', 'tenant_render']) {
      assert.ok(EVENTS[name], `${name} exists but may be undisclosed`);
    }
  });

  it('states a retention period for them', () => {
    // Whatever the number is, it must BE a number on the page: "for as long as
    // useful" is not a retention period.
    assert.match(page, /Usage events[^|]*\|[^|]*\|\s*90 days\s*\|/);
  });

  it('names the subprocessor that holds them, in the notice AND the DPA', () => {
    // The storage decision was allowed to be a non-event precisely because AE
    // is Cloudflare and Cloudflare was already listed. That argument only
    // holds while the list actually says so.
    // The website itself may follow inside the same parentheses ("…, usage events, and this website").
    assert.match(page, /\*\*Cloudflare\*\* \(hosting, storage, DNS, usage events[,)]/);
    assert.match(dpa, /\*\*Cloudflare\*\*.*usage events/);
  });

  it('still refuses the things we still refuse', () => {
    assert.match(page, /no tracking pixels/);
    assert.match(page, /no advertising identifiers/);
    // Since the v2 site (PR #193) the page discloses its website analytics instead of denying
    // any: the claim that must hold is that they are cookieless and store nothing on the device.
    assert.match(
      page,
      /Web Analytics\*\*, which counts page views without cookies and without storing anything on your device/
    );
  });

  it('names a lawful basis for the processing it now describes', () => {
    assert.match(page, /Legitimate interests[^\n]*usage events/i);
    assert.match(page, /you may object/i);
  });
});

// --------------------------------------------- the code honours the claims

describe('"never your email address" is enforced, not promised', () => {
  it('no event may be recorded with an address in the account field', () => {
    // The single check the published sentence rests on.
    for (const address of ['a@example.com', 'customer:a@example.com', 'A@EXAMPLE.COM']) {
      assert.equal(
        validateEvent({ name: 'invite_created', accountId: address }).ok,
        false,
        address
      );
    }
  });

  it('no declared event has an open-valued property anywhere in the vocabulary', () => {
    // "Never anything from inside your designs" cannot be checked value by
    // value — it has to be structural. Every property is a closed set, so a
    // customer's own words have no path into a blob at all.
    for (const [name, spec] of Object.entries(EVENTS)) {
      for (const [key, allowed] of Object.entries(spec.props ?? {})) {
        assert.ok(
          Array.isArray(allowed) &&
            allowed.length > 0 &&
            allowed.every((v) => typeof v === 'string'),
          `${name}.${key} is not a closed set of strings`
        );
      }
    }
  });

  it('no declared event can produce a datapoint containing an "@"', () => {
    // Exhaustive over the whole vocabulary, using each event's own declared
    // values — so a new event with an address-shaped enum fails here.
    for (const [name, spec] of Object.entries(EVENTS)) {
      const props = Object.fromEntries(
        Object.entries(spec.props ?? {}).map(([k, allowed]) => [k, allowed[0]])
      );
      const dp = toDataPoint({ name, accountId: 'acct_1', projectId: 'p', props });
      assert.ok(!JSON.stringify(dp).includes('@'), `${name} produced an address-shaped blob`);
    }
  });

  it('the pages ship no script, so there is nothing in the browser to report on you', () => {
    // The page says this in as many words, and it is what makes the whole
    // design consent-free: there is no client-side collector to block.
    for (const file of ['brand.mjs', 'dashboard.mjs', 'operator-pages.mjs', 'checkout-pages.mjs']) {
      const source = readFileSync(join(CLOUD, file), 'utf8');
      assert.doesNotMatch(source, /<script/i, `${file} renders a script tag`);
    }
    assert.match(page, /ships no JavaScript/i);
  });

  it('events go to our own subprocessor, never to a third-party collector', () => {
    // "No third-party analytics" as a property of the code: the only network
    // call analytics.mjs makes is to Cloudflare's own API, and the write side
    // makes none at all — it is a platform binding.
    const analytics = readFileSync(join(CLOUD, 'analytics.mjs'), 'utf8');
    const hosts = [...analytics.matchAll(/https?:\/\/([^/'`$\s]+)/g)].map((m) => m[1]);
    for (const host of hosts) {
      assert.ok(
        host.endsWith('cloudflare.com'),
        `analytics.mjs reaches ${host}, which is not our own subprocessor`
      );
    }
  });

  it('an analytics failure can never become a customer-visible failure', () => {
    // Not a privacy claim, but the same class of promise: the notice describes
    // analytics as incidental to the service, and it has to actually be.
    assert.doesNotThrow(() =>
      track(
        {
          EVENTS: {
            writeDataPoint() {
              throw new Error('x');
            },
          },
        },
        null,
        { name: 'invite_created' }
      )
    );
    assert.doesNotThrow(() => track({}, null, { name: 'nonsense' }));
  });
});

// ------------------------------------------------------------- no weasel words

describe('the notice makes no promise about a mechanism that does not exist', () => {
  it('carries none of the words that signal an aspiration', () => {
    // Same guard the Trust page carries, for the same reason: the reassuring
    // sentence written first and built later.
    for (const weasel of ['we plan to', 'will soon', 'is planned', 'coming soon', 'we intend to']) {
      assert.ok(!page.toLowerCase().includes(weasel), `the privacy notice says "${weasel}"`);
    }
  });
});
