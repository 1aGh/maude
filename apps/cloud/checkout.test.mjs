// The checkout decisions — Cloud Phase 14.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutSessionParams,
  deriveProjectId,
  validateNewProject,
  validatePlanChoice,
  validateTrialProject,
  validProjectId,
} from './checkout.mjs';
import { loadPricing } from './pricing.mjs';

const pricing = loadPricing();

describe('deriveProjectId', () => {
  it('folds a human name into an address', () => {
    assert.equal(deriveProjectId('Brno Alligators'), 'brno-alligators');
  });
  it('folds diacritics rather than dropping them', () => {
    assert.equal(deriveProjectId('Zkušební tým Dovrtěl'), 'zkusebni-tym-dovrtel');
  });
  it('never emits leading, trailing, or doubled dashes', () => {
    assert.equal(deriveProjectId('  --Weird---  name!!  '), 'weird-name');
  });
});

describe('validProjectId', () => {
  it('accepts the ordinary case', () => {
    assert.equal(validProjectId('brno-alligators'), true);
  });
  it('refuses reserved names and the share-view namespace wholesale', () => {
    assert.equal(validProjectId('cloud'), false);
    assert.equal(validProjectId('www'), false);
    assert.equal(validProjectId('view-anything'), false);
  });
  it('refuses what DNS would refuse', () => {
    assert.equal(validProjectId('ab'), false);
    assert.equal(validProjectId('-x-'), false);
    assert.equal(validProjectId('a'.repeat(41)), false);
    assert.equal(validProjectId('Ahoj'), false);
  });
});

describe('validateNewProject', () => {
  it('passes a real submission through with the derived id', () => {
    const v = validateNewProject({
      name: 'Brno Alligators',
      plan: 'project',
      interval: 'monthly',
      pricing,
    });
    assert.deepEqual(v, {
      ok: true,
      id: 'brno-alligators',
      name: 'Brno Alligators',
      plan: 'project',
      interval: 'monthly',
    });
  });
  it('refuses an unknown plan, a bad interval, a hopeless name', () => {
    assert.equal(
      validateNewProject({ name: 'ok name', plan: 'nope', interval: 'monthly', pricing }).ok,
      false
    );
    assert.equal(
      validateNewProject({ name: 'ok name', plan: 'project', interval: 'weekly', pricing }).ok,
      false
    );
    assert.equal(
      validateNewProject({ name: '!!', plan: 'project', interval: 'monthly', pricing }).ok,
      false
    );
  });
});

describe('checkoutSessionParams', () => {
  const params = checkoutSessionParams({
    projectId: 'brno-alligators',
    projectName: 'Brno Alligators',
    plan: 'project',
    priceId: 'price_x',
    trialDays: 14,
    customerId: 'cus_1',
    origin: 'https://cloud.maude.sh',
  });

  it('starts a TRIAL subscription — nothing chargeable at checkout', () => {
    assert.equal(params.mode, 'subscription');
    assert.equal(params['subscription_data[trial_period_days]'], '14');
  });
  it('still collects and validates the card — that is the authorization', () => {
    assert.equal(params.payment_method_collection, 'always');
  });
  it('carries everything the return needs to CREATE the project row', () => {
    assert.equal(params['metadata[project_id]'], 'brno-alligators');
    assert.equal(params['metadata[project_name]'], 'Brno Alligators');
    assert.equal(params['metadata[plan]'], 'project');
  });
  // 2026-08-01, measured during C1 by walking the real funnel. The account
  // runs Stripe Managed Payments, which makes Stripe the merchant of record:
  // it adds the customer's local VAT, collects it and remits it. Stripe
  // REFUSES `automatic_tax[enabled]=false` under Managed Payments, and
  // omitting the flag inherits ON from the account — so there is no shape of
  // this integration that does not charge tax, and every page quoting a price
  // has to say the price is net.
  it('charges VAT through Stripe as merchant of record, and says so to Stripe', () => {
    assert.equal(params['automatic_tax[enabled]'], 'true');
    // Without the write-back Stripe refuses automatic tax on a session that
    // names an existing customer — the session create fails outright.
    assert.equal(params['customer_update[address]'], 'auto');
    assert.equal(params['customer_update[name]'], 'auto');
    assert.equal(params.billing_address_collection, 'required');
    assert.equal(params['tax_id_collection[enabled]'], 'true');
  });

  it('returns to the waiting room, cancels back to the wizard', () => {
    assert.match(
      params.success_url,
      /\/checkout\/return\?project=brno-alligators&session_id=\{CHECKOUT_SESSION_ID\}/
    );
    assert.match(params.cancel_url, /\/projects\/new$/);
  });
});

describe('Cloud Phase 25 A4 — the canvas origin is not a project', () => {
  it('refuses `canvas`, which is the hostname every project renders through', () => {
    assert.equal(validProjectId('canvas'), false);
    // The reservation is exact — a club actually called this is still fine.
    assert.equal(validProjectId('canvas-club'), true);
  });
});

describe('Maude v2 S9.15 — the trial project and Choose a plan', () => {
  it('a trial project needs only a name that can be an address', () => {
    assert.deepEqual(validateTrialProject({ name: '  Zkušební tým ' }), {
      ok: true,
      id: 'zkusebni-tym',
      name: 'Zkušební tým',
    });
    assert.equal(validateTrialProject({ name: 'ab' }).ok, false);
    assert.equal(validateTrialProject({ name: 'admin' }).ok, false);
    assert.equal(validateTrialProject({}).ok, false);
  });

  it('Choose a plan validates the plan and interval the wizard does', () => {
    assert.deepEqual(validatePlanChoice({ plan: 'project', interval: 'monthly', pricing }), {
      ok: true,
      plan: 'project',
      interval: 'monthly',
    });
    assert.equal(validatePlanChoice({ plan: 'nope', interval: 'monthly', pricing }).ok, false);
    assert.equal(validatePlanChoice({ plan: 'project', interval: 'weekly', pricing }).ok, false);
  });

  it('the convert session omits the trial and names the existing project', () => {
    const base = {
      projectId: 'zkusebni-tym',
      projectName: 'Zkušební tým',
      plan: 'project',
      priceId: 'price_x',
      customerId: 'cus_1',
      origin: 'https://cloud.test',
    };
    const convert = checkoutSessionParams({ ...base, trialDays: null, convert: true });
    const wizard = checkoutSessionParams({ ...base, trialDays: 14 });
    assert.equal(convert['subscription_data[trial_period_days]'], undefined);
    assert.equal(convert['metadata[convert]'], '1');
    assert.equal(convert.cancel_url, 'https://cloud.test/projects/zkusebni-tym/billing');
    // Everything else is the wizard's session, key for key.
    const { 'subscription_data[trial_period_days]': _t, cancel_url: _c, ...w } = wizard;
    const { 'metadata[convert]': _m, cancel_url: _c2, ...c } = convert;
    assert.deepEqual(c, w);
  });
});
