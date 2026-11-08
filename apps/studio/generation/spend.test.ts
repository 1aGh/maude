// generation/spend.test.ts — the spend cap on paid media generation (Michal, 2026-11-08): a per-run and a
// per-day cap per project, a confirm above a single-job threshold, bounded per-Mac settings.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSpendGuard,
  estimateJobCost,
  readSpendSettings,
  SPEND_BOUNDS,
  SPEND_DEFAULTS,
  validateSpendSettings,
} from './spend.ts';

const roots: string[] = [];
function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'maude-spend-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const IMG = { modality: 'image', provider: 'gemini', model: 'gemini-2.5-flash-image' } as const;

describe('defaults and bounds', () => {
  test('the defaults are $2 per run, $10 per day, confirm above $1', () => {
    expect(SPEND_DEFAULTS).toEqual({ perRun: 2, perDay: 10, confirmOver: 1 });
    expect(readSpendSettings(undefined)).toEqual(SPEND_DEFAULTS);
  });

  test('a stored value outside its bounds falls back; a partial object fills the rest', () => {
    expect(readSpendSettings({ perRun: 5_000, perDay: -3, confirmOver: 'x' })).toEqual(
      SPEND_DEFAULTS
    );
    expect(readSpendSettings({ perRun: 4 })).toEqual({ ...SPEND_DEFAULTS, perRun: 4 });
  });

  test('a patch outside the bounds, or with an unknown key, is refused', () => {
    expect(validateSpendSettings({ perRun: SPEND_BOUNDS.perRun.max + 1 }).ok).toBe(false);
    expect(validateSpendSettings({ perDay: SPEND_BOUNDS.perDay.min / 2 }).ok).toBe(false);
    expect(validateSpendSettings({ confirmOver: -1 }).ok).toBe(false);
    expect(validateSpendSettings({ perRun: Number.NaN }).ok).toBe(false);
    expect(validateSpendSettings({ perRun: '2' }).ok).toBe(false);
    expect(validateSpendSettings({ nope: 1 }).ok).toBe(false);
    expect(validateSpendSettings([]).ok).toBe(false);
    const ok = validateSpendSettings({ perRun: 5, confirmOver: 0 });
    expect(ok.ok && ok.value).toEqual({ perRun: 5, confirmOver: 0 });
  });
});

describe('estimateJobCost', () => {
  test('a conservative per-kind estimate, never zero for a paid cloud kind', () => {
    expect(estimateJobCost(IMG)).toBeGreaterThanOrEqual(0.04);
    expect(estimateJobCost({ modality: 'video', provider: 'gemini' })).toBeGreaterThan(
      estimateJobCost(IMG)
    );
    expect(estimateJobCost({ modality: 'audio', provider: 'elevenlabs' })).toBeGreaterThan(0);
  });

  test('the pro image model costs more than the flash one; n multiplies', () => {
    const pro = estimateJobCost({ ...IMG, model: 'gemini-3-pro-image-preview' });
    expect(pro).toBeGreaterThan(estimateJobCost(IMG));
    expect(estimateJobCost(IMG, 4)).toBeCloseTo(estimateJobCost(IMG) * 4, 5);
  });

  test('a local engine is free', () => {
    expect(estimateJobCost({ modality: 'transcription', provider: 'whisper' })).toBe(0);
  });
});

describe('the guard', () => {
  const settings =
    (over: Partial<typeof SPEND_DEFAULTS> = {}) =>
    () => ({
      ...SPEND_DEFAULTS,
      ...over,
    });

  test('under the caps a job runs, and the spend is counted', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings() });
    const a = g.admit({ key: 'a', estimate: 0.1 });
    expect(a.ok).toBe(true);
    expect(g.spent().run).toBeCloseTo(0.1, 5);
    expect(g.spent().day).toBeCloseTo(0.1, 5);
  });

  test('the per-run cap stops a job and says which cap, how much, and how to raise it', () => {
    const g = createSpendGuard({
      designRoot: root(),
      settings: settings({ perRun: 0.25, confirmOver: 5 }),
    });
    expect(g.admit({ key: 'a', estimate: 0.1 }).ok).toBe(true);
    expect(g.admit({ key: 'b', estimate: 0.1 }).ok).toBe(true);
    const c = g.admit({ key: 'c', estimate: 0.1 });
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.status).toBe(402);
    expect(c.reason).toBe('run-cap');
    expect(c.message).toContain('$0.25');
    expect(c.message).toMatch(/Settings/);
    expect(c.message).toMatch(/Nothing was generated/);
    expect(g.spent().run).toBeCloseTo(0.2, 5); // the refused job was not counted
  });

  test('the per-day cap holds across guards (a restart) in the same project, and not in another', () => {
    const dir = root();
    const s = settings({ perDay: 0.25, confirmOver: 5 });
    const g1 = createSpendGuard({ designRoot: dir, settings: s });
    expect(g1.admit({ key: 'a', estimate: 0.2 }).ok).toBe(true);
    const g2 = createSpendGuard({ designRoot: dir, settings: s });
    const blocked = g2.admit({ key: 'b', estimate: 0.1 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe('day-cap');
      expect(blocked.message).toContain('$0.25');
      expect(blocked.message).toMatch(/today/);
    }
    const other = createSpendGuard({ designRoot: root(), settings: s });
    expect(other.admit({ key: 'b', estimate: 0.1 }).ok).toBe(true);
  });

  test('a new day starts from zero', () => {
    const dir = root();
    let day = new Date(2026, 10, 8, 23, 0);
    const g = createSpendGuard({
      designRoot: dir,
      settings: settings({ perDay: 0.15, confirmOver: 5 }),
      now: () => day,
    });
    expect(g.admit({ key: 'a', estimate: 0.1 }).ok).toBe(true);
    expect(g.admit({ key: 'b', estimate: 0.1 }).ok).toBe(false);
    day = new Date(2026, 10, 9, 0, 5);
    expect(g.spent().day).toBe(0);
    expect(g.admit({ key: 'b', estimate: 0.1 }).ok).toBe(true);
  });

  test('a failed job gives its estimate back', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings() });
    const a = g.admit({ key: 'a', estimate: 0.5 });
    expect(a.ok && g.spent().run).toBeCloseTo(0.5, 5);
    if (a.ok) a.refund();
    expect(g.spent().run).toBe(0);
    expect(g.spent().day).toBe(0);
  });

  test('one failed take of four gives back only its share', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings({ confirmOver: 5 }) });
    const a = g.admit({ key: 'a', estimate: 0.4 });
    if (!a.ok) throw new Error('expected ok');
    a.refund(0.1);
    expect(g.spent().run).toBeCloseTo(0.3, 5);
    a.refund(0.1);
    a.refund(1); // never more than was counted
    expect(g.spent().run).toBeCloseTo(0, 5);
    a.refund();
    expect(g.spent().run).toBe(0);
  });

  test('a job the person already confirmed skips the threshold but never a cap', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings({ perRun: 1.2 }) });
    expect(g.admit({ key: 'a', estimate: 1.1, confirmed: true }).ok).toBe(true);
    const over = g.admit({ key: 'b', estimate: 0.5, confirmed: true });
    expect(!over.ok && over.reason).toBe('run-cap');
  });

  test('a free job is never blocked, even at a spent cap', () => {
    const g = createSpendGuard({
      designRoot: root(),
      settings: settings({ perRun: 0.1, confirmOver: 0 }),
    });
    expect(g.admit({ key: 'a', estimate: 0.1 }).ok).toBe(false); // confirm at $0: every priced job asks
    expect(g.admit({ key: 'free', estimate: 0 }).ok).toBe(true);
  });

  test('a job above the threshold returns needs-confirm, and nothing is counted', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings({ perRun: 50 }) });
    const r = g.admit({ key: 'k', estimate: 1.5, summary: 'a video from Google' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.reason).toBe('needs-confirm');
    expect(r.approvalId).toMatch(/^ok_/);
    expect(r.estimate).toBeCloseTo(1.5, 5);
    expect(r.message).toContain('$1.50');
    expect(g.spent().run).toBe(0);
    expect(g.pending().map((p) => p.id)).toEqual([r.approvalId as string]);
  });

  test('asking again for the same job reuses the pending approval', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings({ perRun: 50 }) });
    const a = g.admit({ key: 'k', estimate: 1.5 });
    const b = g.admit({ key: 'k', estimate: 1.5 });
    expect(!a.ok && !b.ok && a.approvalId === b.approvalId).toBe(true);
    expect(g.pending()).toHaveLength(1);
  });

  test('the approval is a person’s act: approved in the app, then the same job runs once', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings({ perRun: 50 }) });
    const r = g.admit({ key: 'k', estimate: 1.5 });
    if (r.ok) throw new Error('expected needs-confirm');
    const id = r.approvalId as string;
    // sent before the person said yes: still waiting
    expect(g.admit({ key: 'k', estimate: 1.5, approvalId: id }).ok).toBe(false);
    expect(g.approve(id)).toBe(true);
    // another job under that id: no
    expect(g.admit({ key: 'other', estimate: 1.5, approvalId: id }).ok).toBe(false);
    const go = g.admit({ key: 'k', estimate: 1.5, approvalId: id });
    expect(go.ok).toBe(true);
    expect(g.spent().run).toBeCloseTo(1.5, 5);
    // single use
    expect(g.admit({ key: 'k', estimate: 1.5, approvalId: id }).ok).toBe(false);
  });

  test('asking the same job again after the person approved it needs no id', () => {
    const g = createSpendGuard({ designRoot: root(), settings: settings({ perRun: 50 }) });
    const r = g.admit({ key: 'k', estimate: 1.5 });
    if (r.ok) throw new Error('expected needs-confirm');
    g.approve(r.approvalId as string);
    expect(g.admit({ key: 'other', estimate: 1.5 }).ok).toBe(false);
    expect(g.admit({ key: 'k', estimate: 1.5 }).ok).toBe(true);
    expect(g.admit({ key: 'k', estimate: 1.5 }).ok).toBe(false); // used once
  });

  test('an approval does not lift a cap', () => {
    const g = createSpendGuard({
      designRoot: root(),
      settings: settings({ perRun: 1, confirmOver: 0.5 }),
    });
    const r = g.admit({ key: 'k', estimate: 0.9 });
    if (r.ok) throw new Error('expected needs-confirm');
    g.approve(r.approvalId as string);
    expect(g.admit({ key: 'k2', estimate: 0.9 }).ok).toBe(false);
    expect(g.admit({ key: 'k', estimate: 0.9, approvalId: r.approvalId }).ok).toBe(true);
    const again = g.admit({ key: 'z', estimate: 0.9 });
    expect(!again.ok && again.reason).toBe('run-cap');
  });

  test('a declined or expired approval does not run the job', () => {
    let t = 1_000_000;
    const g = createSpendGuard({
      designRoot: root(),
      settings: settings({ perRun: 50 }),
      clock: () => t,
    });
    const r = g.admit({ key: 'k', estimate: 1.5 });
    if (r.ok) throw new Error('expected needs-confirm');
    g.approve(r.approvalId as string);
    t += 11 * 60_000;
    expect(g.admit({ key: 'k', estimate: 1.5, approvalId: r.approvalId }).ok).toBe(false);
    const d = g.admit({ key: 'd', estimate: 1.5 });
    if (d.ok) throw new Error('expected needs-confirm');
    expect(g.decline(d.approvalId as string)).toBe(true);
    expect(g.pending().find((p) => p.id === d.approvalId)).toBeUndefined();
  });

  test('the ledger holds amounts only — no prompt, no key', () => {
    const dir = root();
    const g = createSpendGuard({ designRoot: dir, settings: settings() });
    g.admit({ key: 'secret-prompt-text', estimate: 0.1 });
    const text = readFileSync(join(dir, '_state', 'generate-spend.json'), 'utf8');
    expect(text).not.toContain('secret-prompt-text');
    expect(JSON.parse(text)).toMatchObject({ usd: 0.1 });
  });

  test('a corrupt ledger starts the day from zero rather than failing the job', () => {
    const dir = root();
    const g = createSpendGuard({ designRoot: dir, settings: settings() });
    g.admit({ key: 'a', estimate: 0.1 });
    writeFileSync(join(dir, '_state', 'generate-spend.json'), '{not json');
    const g2 = createSpendGuard({ designRoot: dir, settings: settings() });
    expect(g2.admit({ key: 'a', estimate: 0.1 }).ok).toBe(true);
  });
});
