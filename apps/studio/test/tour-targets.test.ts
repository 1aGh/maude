// V2-7.3 — every spotlight a tour or a replayable What's New entry draws is a real, current hook.
//
// The tour overlay resolves a target with `document.querySelector` and, when nothing matches, quietly shows
// the step centred — so a renamed or deleted testid used to break a tour without any test noticing. This pins
// each target to client/testids.json (the contract, rule 5) AND to a literal in the client source, so a
// rename fails here. Entries marked `replayable: false` spotlight v1 chrome and are not offered again; they
// are exempt on purpose, and the test names them so the exemption cannot grow silently.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { COLLAB_TOUR } from '../client/tour/collab-tour.js';
import { QUICK_SETUP_TOUR } from '../client/tour/quick-setup-tour.js';
import { USAGE_TOUR } from '../client/tour/usage-tour.js';
import { canReplayTour } from '../client/whats-new-seen.js';

const STUDIO = path.resolve(import.meta.dir, '..');
const CLIENT = path.join(STUDIO, 'client');

type Hook = { hook: string; kind: string; v2?: string };
const HOOKS: Hook[] = JSON.parse(readFileSync(path.join(CLIENT, 'testids.json'), 'utf8'));
const FEED: { entries: Array<{ id: string; replayable?: boolean; tour?: Step[] }> } = JSON.parse(
  readFileSync(path.join(STUDIO, 'whats-new.json'), 'utf8')
);

type Step = { target?: string; title: string; body: string; optional?: boolean };

// The client source minus the tours and the feed's own readers, so a tour naming a hook cannot vouch for it.
function sourceCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f === 'tour') continue;
        walk(p);
      } else if (/\.(jsx?|tsx?)$/.test(f)) parts.push(readFileSync(p, 'utf8'));
    }
  };
  walk(CLIENT);
  return parts.join('\n');
}
const SOURCE = sourceCorpus();

/** `[data-testid='x'], [data-tour="y"]` → [{attr:'testid', name:'x'}, {attr:'tour', name:'y'}]; anything
 *  else (a class, a tag) comes back as `{attr:'other'}` so the test can refuse it. */
function parseTarget(target: string): Array<{ attr: string; name: string }> {
  return target.split(',').map((part) => {
    const m = part.trim().match(/^\[data-(testid|tour)\s*=\s*(['"])([^'"]+)\2\]$/);
    return m ? { attr: m[1], name: m[3] } : { attr: 'other', name: part.trim() };
  });
}

function hookEntry(attr: string, name: string): Hook | undefined {
  if (attr === 'tour') return HOOKS.find((h) => h.kind === 'data-tour' && h.hook === name);
  const exact = HOOKS.find((h) => h.kind.startsWith('testid') && h.hook === name);
  if (exact) return exact;
  // a pattern hook: `panel-head-<side>` covers `panel-head-left`
  return HOOKS.find((h) => {
    if (!h.kind.startsWith('testid') || !h.hook.includes('<')) return false;
    const re = new RegExp(
      `^${h.hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '[a-z0-9-]+')}$`
    );
    return re.test(name);
  });
}

function inSource(attr: string, name: string): boolean {
  if (attr === 'tour') return SOURCE.includes(`data-tour="${name}"`);
  if (
    SOURCE.includes(`'${name}'`) ||
    SOURCE.includes(`"${name}"`) ||
    SOURCE.includes(`\`${name}\``)
  )
    return true;
  // built from a template: `panel-head-${side}` → the static prefix
  const dyn = name.match(/^([a-z0-9-]+-)[a-z0-9-]+$/);
  return !!dyn && SOURCE.includes(`\`${dyn[1]}\${`);
}

const DECKS: Record<string, Step[]> = {
  'usage-tour': USAGE_TOUR as Step[],
  'collab-tour': COLLAB_TOUR as Step[],
  'quick-setup-tour': QUICK_SETUP_TOUR as Step[],
};
const REPLAYABLE = FEED.entries.filter((e) => Array.isArray(e.tour) && canReplayTour(e));
const SPOTLIGHTS: Array<{ where: string; step: Step }> = [
  ...Object.entries(DECKS).flatMap(([name, steps]) =>
    steps.map((step, i) => ({ where: `${name} step ${i + 1}`, step }))
  ),
  ...REPLAYABLE.flatMap((e) =>
    (e.tour as Step[]).map((step, i) => ({ where: `whats-new ${e.id} step ${i + 1}`, step }))
  ),
];

describe('tour spotlight targets are current hooks', () => {
  test('there are spotlights to check (the walk is not vacuous)', () => {
    expect(SPOTLIGHTS.filter((s) => s.step.target).length).toBeGreaterThan(15);
  });

  for (const { where, step } of SPOTLIGHTS) {
    if (!step.target) continue;
    test(`${where}: ${step.target}`, () => {
      for (const t of parseTarget(step.target as string)) {
        // v2 tours name a data-testid or a data-tour anchor, never a styling class
        expect(
          t.attr,
          `${where}: "${t.name}" is not a [data-testid] / [data-tour] selector`
        ).not.toBe('other');
        const entry = hookEntry(t.attr, t.name);
        expect(entry, `${where}: ${t.name} is not in client/testids.json`).toBeDefined();
        expect(
          /^(retired|historical)/.test(entry?.v2 ?? ''),
          `${where}: ${t.name} is ${entry?.v2} in client/testids.json`
        ).toBe(false);
        expect(inSource(t.attr, t.name), `${where}: nothing in client/ emits ${t.name}`).toBe(true);
      }
    });
  }
});

describe('non-replayable entries', () => {
  const frozen = FEED.entries.filter((e) => e.replayable === false);

  test('they exist, and only entries with a tour carry the flag', () => {
    expect(frozen.length).toBeGreaterThan(0);
    for (const e of frozen) expect(Array.isArray(e.tour) && e.tour.length > 0, e.id).toBe(true);
  });

  test('canReplayTour refuses them and offers every other tour', () => {
    for (const e of frozen) expect(canReplayTour(e)).toBe(false);
    for (const e of REPLAYABLE) expect(canReplayTour(e)).toBe(true);
    expect(canReplayTour({ tour: [] })).toBe(false);
    expect(canReplayTour({})).toBe(false);
  });

  test('a replayable entry never spotlights a styling class (v1 chrome)', () => {
    for (const e of REPLAYABLE)
      for (const s of e.tour as Step[])
        if (s.target) expect(s.target, e.id).not.toMatch(/(^|,\s*)\./);
  });
});

describe('the v2 decks speak CONTRACT words', () => {
  const BANNED: Array<[RegExp, string]> = [
    [/\bAssistant\b/, 'say "AI chat panel" (first mention) or "AI" (CONTRACT §3)'],
    [/\bmenu ?bar\b/i, 'there is no menubar; say Menu (CONTRACT §1)'],
    [/\bcommand palette\b/i, 'say Search (CONTRACT §3)'],
    [/\bsidebar\b/i, 'say panel (CONTRACT §3)'],
    [/\bboard\b/i, 'say canvas (CONTRACT §3)'],
    [/\bView\s*(→|▸)/, 'write the path as Menu › View (CONTRACT §1)'],
    [/\bHelp\s*(→|▸)/, 'write the path as Menu › Help (CONTRACT §1)'],
    [/\b(we|our|us)\b|(^|\s)I(\s|['’])/, 'the app never says "we" or "I" (CONTRACT §4)'],
    [/!/, 'no exclamation marks (CONTRACT §4)'],
  ];
  for (const [name, steps] of Object.entries(DECKS)) {
    test(`${name}: every step has copy, and none uses a retired word`, () => {
      expect(steps.length).toBeGreaterThan(2);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(0);
        for (const [re, why] of BANNED) {
          expect(`${s.title}\n${s.body}`, `${name} "${s.title}": ${why}`).not.toMatch(re);
        }
      }
    });
    test(`${name}: the last step is centred and never optional (the tour always ends on a card)`, () => {
      const last = steps[steps.length - 1];
      expect(last.target).toBeUndefined();
      expect(last.optional).toBeUndefined();
    });
  }

  test('a target that a role or shell can lack is optional (skipped, not broken)', () => {
    const absentable = [
      'share-cluster-share', // read-only people see "Ask to edit" instead
      'share-cluster-exports', // present once any export exists
      'ai-chat-island', // the AI chat panel is native-only
      'panel-icon-assistant',
      'inspector-panel', // viewers get no Inspector
      'panel-head-left', // gone while panels are hidden (⌘\)
    ];
    for (const [name, steps] of Object.entries(DECKS)) {
      for (const s of steps) {
        if (s.target && absentable.some((a) => (s.target as string).includes(a)))
          expect(s.optional, `${name} "${s.title}" targets ${s.target}`).toBe(true);
      }
    }
  });
});
