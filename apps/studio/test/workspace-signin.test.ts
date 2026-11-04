// The workspace disclosure — DDR-054's trust model in words (DDR-192 §6). This file also held the
// "Sign in to workspace" email/password tests; issue #204 retired that flow (the desktop owns no
// team-server login — see managed-projects-no-password.test.ts), so only the disclosure is left.

import { describe, expect, test } from 'bun:test';

import { type DisclosureItem, workspaceDisclosure } from '../sync/workspace-signin.ts';

describe('the disclosure panel — DDR-054 made visible (DDR-192 §6)', () => {
  const text = (items: DisclosureItem[]) => items.map((i) => `${i.title} ${i.detail}`).join(' ');

  test('it says what the operator CAN see, not only what they cannot', () => {
    // A disclosure that only lists reassurances is marketing. The point is that
    // the person can decide, which requires the uncomfortable half.
    const items = workspaceDisclosure({ operator: 'your team', aiAvailable: true });
    const sees = items.filter((i) => i.kind === 'sees');
    expect(sees.length).toBeGreaterThanOrEqual(3);
    expect(text(sees)).toMatch(/edit history/i);
    expect(text(sees)).toMatch(/when you are editing/i);
    expect(text(sees)).toMatch(/comments/i);
  });

  test('it names the containment invariant in words a person understands', () => {
    const items = workspaceDisclosure({ operator: 'Maude Cloud', aiAvailable: true });
    expect(text(items)).toMatch(/never executes them/i);
    expect(text(items)).toMatch(/render here, on your machine/i);
  });

  test('it names the operator, so "who can see this" has an answer', () => {
    const items = workspaceDisclosure({ operator: 'Acme Design Ltd', aiAvailable: true });
    expect(text(items)).toContain('Acme Design Ltd');
  });

  test('the AI-less state is stated as a fact, not an error', () => {
    // Phase 6's persona: an invitee without a Claude subscription gets a
    // first-class product, not a broken one.
    const off = workspaceDisclosure({ operator: 'your team', aiAvailable: false });
    const ai = off.find((i) => i.title.includes('AI'));
    expect(ai?.detail).toMatch(/Everything else works normally/i);
    expect(ai?.detail).not.toMatch(/error|unavailable|failed|missing/i);

    const on = workspaceDisclosure({ operator: 'your team', aiAvailable: true });
    expect(on.find((i) => i.title.includes('AI'))?.detail).toMatch(/your own subscription/i);
  });

  test('it promises the exit, because that is what makes the rest believable', () => {
    const items = workspaceDisclosure({ operator: 'Maude Cloud', aiAvailable: true });
    expect(text(items)).toMatch(/opens without Maude/i);
  });

  test('no jargon reaches the person', () => {
    // DDR-193 §5 — the product word is "project"/"workspace". These words on an
    // invite path tell a non-developer the product is not for them.
    const items = workspaceDisclosure({ operator: 'your team', aiAvailable: false });
    const all = text(items).toLowerCase();
    for (const word of [
      'token',
      'repository',
      'repo ',
      'oauth',
      'bearer',
      'crdt',
      'yjs',
      'commit',
    ]) {
      expect(all).not.toContain(word);
    }
  });
});
