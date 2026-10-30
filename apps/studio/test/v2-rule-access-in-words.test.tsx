// S9.21c — rule `00/rule/access-in-words` (00 Index §6, see 10 co-ask-edit): "Can view (look only) · Can comment
// (look + comment), with Ask to edit as the one action."
//
// The role is put in words in five places (the Share cluster, the Share sheet's role menu, the access client's
// cards and row lines, Home's cloud rows, the where-matrix); a word that drifts in one of them is the rule broken,
// so every producer is held to the same two words here. Then the surface itself: a person who cannot edit sees
// their access word where the save status sits and exactly one action, Ask to edit — never Share — and a link
// opened in a browser says "esc for Viewing", not a role id.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { cloudRoleWord } from '../client/home/home-model.js';
import { accessWord, ACCESS_WORDS as CARD_WORDS } from '../client/v2/access/access-client.js';
import { AccessLayer } from '../client/v2/access/access-host.jsx';
import { WHERE_CONTEXTS } from '../client/v2/advanced/where-matrix.js';
import { previewHint } from '../client/v2/preview/preview-bar.jsx';
import { ROLE_WORDS } from '../client/v2/share/share-model.js';
import { capsFor } from '../client/v2/shell/canvas-mode.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import {
  accessStatus,
  ACCESS_WORDS as CLUSTER_WORDS,
  facesOf,
  saveStatus,
} from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';

const VIEW = 'Can view';
const COMMENT = 'Can comment';

describe('one word per role, in every place it is said', () => {
  test('Can view = observer, Can comment = viewer, Can edit = member', () => {
    expect(CLUSTER_WORDS).toEqual({ view: VIEW, comment: COMMENT });
    expect([accessWord('observer'), accessWord('viewer'), accessWord('member')]).toEqual([
      VIEW,
      COMMENT,
      'Can edit',
    ]);
    expect([CARD_WORDS.observer, CARD_WORDS.viewer]).toEqual([VIEW, COMMENT]);
    expect([ROLE_WORDS.observer.word, ROLE_WORDS.viewer.word, ROLE_WORDS.member.word]).toEqual([
      VIEW,
      COMMENT,
      'Can edit',
    ]);
    expect([cloudRoleWord('observer'), cloudRoleWord('viewer'), cloudRoleWord('member')]).toEqual([
      VIEW,
      COMMENT,
      'Can edit',
    ]);
    expect(WHERE_CONTEXTS.find((c) => c.id === 'comment')?.label).toBe(COMMENT);
  });
  test('what each one lets you do, in the role menu: look only · look, comment', () => {
    expect(ROLE_WORDS.observer.line).toBe('Look only');
    expect(ROLE_WORDS.viewer.line.startsWith('Look, comment')).toBe(true);
  });
  test('an id is never shown', () => {
    for (const id of ['observer', 'viewer', 'member', 'owner'])
      expect(accessWord(id)).toMatch(/^(Owner|Can (edit|comment|view))$/);
    for (const junk of ['admin', 'readonly', '', null, undefined])
      expect(accessWord(junk)).toBe('');
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
async function cluster(access: ReturnType<typeof accessStatus>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ShareCluster
        faces={facesOf({ you: 'Petra Malá' })}
        status={saveStatus({ linked: true, online: true, phase: 'synced', pending: 0 })}
        ctx={menuCtx({ native: false, readOnly: !!access, canvasOpen: true })}
        run={() => {}}
        access={access}
        canShare
        onAskToEdit={() => {}}
      />
    );
  });
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const actions = [...(host?.querySelectorAll('button, a') ?? [])]
    .map((b) => b.textContent?.trim())
    .filter((t) => t === 'Share' || t === 'Ask to edit');
  return { q, actions };
}

describe('Ask to edit is the one action', () => {
  for (const [role, word] of [
    ['observer', VIEW],
    ['viewer', COMMENT],
  ] as const) {
    test(`${word}: the word where the save status sits, Ask to edit, no Share`, async () => {
      const { q, actions } = await cluster(accessStatus({ canEdit: false, role }));
      expect(q('share-cluster-status')?.textContent).toBe(word);
      expect(q('share-cluster-ask')?.textContent).toBe('Ask to edit');
      expect(q('share-cluster-share')).toBeNull();
      expect(actions).toEqual(['Ask to edit']);
    });
  }
  test('Can edit: no access word, Share, no Ask to edit', async () => {
    const { q, actions } = await cluster(accessStatus({ canEdit: true, role: 'member' }));
    expect(q('share-cluster-ask')).toBeNull();
    expect(actions).toEqual(['Share']);
  });
  test('a link in a browser: Preview says what esc does in mode words, not a role id', () => {
    expect(previewHint(capsFor({ canEdit: false, role: 'observer' }))).toBe('for Viewing');
    expect(previewHint(capsFor({ canEdit: false, role: 'viewer' }))).toBe('for Viewing');
  });
});

describe('the access cards name the canvas, never its file', () => {
  // The shell hands the host the open tab's designRoot-relative path; the words carry its name only.
  const rel = 'ui/2026/combine/Combine-kampan.tsx';
  async function layer(props: Record<string, unknown>) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<AccessLayer canvas={rel} project="Alligators brand" {...props} />);
    });
    return host;
  }
  test('link off: "Ask the person who shared Combine-kampan for a new one."', async () => {
    const h = await layer({ linkOff: true });
    const words = h.querySelector('[data-testid="access-link-off"]')?.textContent ?? '';
    expect(words).toContain('This link was turned off.');
    expect(words).toContain('Ask the person who shared Combine-kampan for a new one.');
    expect(words).not.toContain('.tsx');
    expect(words).not.toContain('ui/');
  });
  test('the view-only tip: "You can look at Combine-kampan, not change it."', async () => {
    const h = await layer({ tip: true });
    const words = h.querySelector('[data-testid="access-view-tip"]')?.textContent ?? '';
    expect(words).toContain('You can look at Combine-kampan, not change it.');
    expect(words).not.toContain('.tsx');
  });
});
