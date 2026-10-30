// S8.17b — what people see of a Figma comment pin: the thread says "<name> · from Figma", has no avatar,
// no Edit, bolds no @handle in it; the Comments panel row shows the same label and no initials; and an
// imported @mention rings no bell in the unread list.

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
import { groupThreads } from '../client/v2/comments/comments-model.js';
import { unreadMentions } from '../client/v2/comments/mention-model.js';
import { CommentThread, type OverlayComment, resetMentionPeople } from '../comments-overlay.tsx';
import { hiddenCodePoints, RLO, ZWSP } from './_hostile-names.ts';

const FILE = '.design/ui/Uniformy.tsx';
const imported = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c_fig1',
    file: FILE,
    selector: '',
    bounds: null,
    world: { x: 110, y: 120 },
    text: 'Logo je moc male, @michal',
    status: 'open',
    created: '2026-10-02T08:00:00.000Z',
    resolved_at: null,
    author: 'Michal',
    mentions: [],
    thread: [
      {
        id: 'r_fig1',
        author: 'Michal',
        body: 'Zvetsim, @michal',
        created: '2026-10-02T09:30:00.000Z',
        importedFrom: {
          source: 'figma',
          author: { name: 'Tereza K' },
          at: '2026-10-02T09:30:00.000Z',
        },
      },
    ],
    importedFrom: {
      source: 'figma',
      author: { name: 'Jonas Novak' },
      at: '2026-10-02T08:00:00.000Z',
    },
    ...over,
  }) as unknown as OverlayComment;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
  resetMentionPeople();
});

function mountThread(c: OverlayComment, mine: boolean) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentThread
        comment={c}
        sequence={1}
        onClose={() => {}}
        onPatch={() => {}}
        onDelete={() => {}}
        onReply={async () => true}
        mine={mine}
      />
    );
  });
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

describe('the thread popover', () => {
  test('the writer shows as "<name> · from Figma", on the root and on the imported reply', () => {
    mountThread(imported(), true);
    expect(q('[data-testid="comment-imported-c_fig1"]')?.textContent).toBe(
      'Jonas Novak · from Figma'
    );
    expect(q('.cm-thread__reply-author')?.textContent).toBe('Tereza K · from Figma');
    // the importer's own name is nowhere on the thread
    expect(document.body.textContent).not.toContain('Michal');
  });

  test('no avatar with initials, no Edit (the importer cannot rewrite what Figma said), Delete stays the importer’s', () => {
    mountThread(imported(), true);
    expect(
      all('.cm-av').every((a) => a.classList.contains('cm-av--imported') && a.textContent === '')
    ).toBe(true);
    expect(q('[data-testid="comment-edit"]')).toBeNull();
    expect(q('[data-testid="comment-delete-c_fig1"]')).not.toBeNull();
  });

  test('an @handle in imported words is plain text — nothing in it looks like a mention', () => {
    mountThread(imported(), false);
    expect(q('.cm-thread__body')?.textContent).toBe('Logo je moc male, @michal');
    expect(q('.cm-thread__body [data-mention]')).toBeNull();
    expect(q('.cm-thread__reply-body [data-mention]')).toBeNull();
  });

  test('a hostile name from a peer is re-clamped when drawn', () => {
    const c = imported({
      importedFrom: { source: 'figma', author: { name: `${RLO}even${ZWSP} Eve` } },
    });
    mountThread(c, false);
    const label = q('[data-testid="comment-imported-c_fig1"]')?.textContent ?? '';
    expect(label).toBe('even Eve · from Figma');
    expect(hiddenCodePoints(label)).toEqual([]);
  });

  test('an ordinary thread is untouched: initials avatar, Edit, bolded @mention', () => {
    mountThread(imported({ importedFrom: undefined, thread: [], text: 'hi @lin' }), true);
    expect(q('[data-testid="comment-edit"]')).not.toBeNull();
    expect(q('.cm-av--imported')).toBeNull();
    expect(q('.cm-thread__body [data-mention]')?.textContent).toBe('@lin');
  });
});

describe('the Comments panel and the unread list', () => {
  const byFile = {
    [FILE]: [
      imported(),
      imported({ id: 'c2', importedFrom: undefined, thread: [], author: 'Lin', text: 'Logo ok' }),
    ],
  };

  test('an imported row carries the label; an ordinary one does not', () => {
    const [g] = groupThreads(byFile, 'all', { me: 'Michal' });
    const rows = new Map((g?.threads ?? []).map((t: { id: string }) => [t.id, t]));
    expect((rows.get('c_fig1') as { importedLabel: string | null }).importedLabel).toBe(
      'Jonas Novak · from Figma'
    );
    expect((rows.get('c2') as { importedLabel: string | null }).importedLabel).toBeNull();
  });

  test('imported @michal rings no bell, whoever ran the import', () => {
    expect(unreadMentions(byFile, 'Michal')).toEqual([]);
    expect(unreadMentions(byFile, 'Lin')).toEqual([]);
    // a project member's reply that mentions Lin still does
    const withReply = {
      [FILE]: [
        imported({
          thread: [
            ...(imported() as unknown as { thread: unknown[] }).thread,
            { id: 'r2', author: 'Jonas', body: 'hej @lin', created: '2026-10-03T08:00:00.000Z' },
          ],
        }),
      ],
    };
    expect(unreadMentions(withReply, 'Lin').map((m: { threadId: string }) => m.threadId)).toEqual([
      'c_fig1',
    ]);
  });
});
