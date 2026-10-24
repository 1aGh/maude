// P8 C5 (04 md-comment, 10 co-comment-thread) — the comment card is the board's `md-th` / `co-th`: it opens with
// its words ("Pricing · Desktop"), Resolve is a ghost button with a check (no sequence badge, no primary
// fill), the faces wear their tone, the reply is one field with a small accent send, the @ picker lists faces.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CommentComposer,
  CommentThread,
  canvasTitle,
  type OverlayComment,
  placeHeading,
} from '../comments-overlay.tsx';

const comment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    file: '.design/ui/Pricing.tsx',
    selector: '',
    bounds: { x: 100, y: 100, w: 24, h: 24 },
    text: 'Yearly should be the default',
    status: 'open',
    created: new Date(Date.now() - 2 * 3600_000).toISOString(),
    resolved_at: null,
    author: 'Tereza',
    thread: [
      {
        id: 'r1',
        author: 'Jonas',
        body: 'Agree.',
        created: new Date(Date.now() - 3600_000).toISOString(),
      },
    ],
    ...over,
  }) as unknown as OverlayComment;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
});
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

function mountThread(c: OverlayComment) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentThread
        comment={c}
        sequence={3}
        onClose={() => {}}
        onPatch={() => {}}
        onDelete={() => {}}
        onReply={async () => true}
      />
    );
  });
}

describe('the heading says canvas · place, the way the board writes it', () => {
  test('canvasTitle: the file name in words', () => {
    expect(canvasTitle('.design/ui/Pricing.tsx')).toBe('Pricing');
    expect(canvasTitle('.design/ui/Combine-kampan.tsx')).toBe('Combine kampan');
    expect(canvasTitle(null)).toBe('');
  });

  test('placeHeading: "Pricing · Desktop"; a canvas-wide spot is just the canvas; an unknown canvas is just the place', () => {
    document.body.innerHTML =
      '<div data-dc-screen="desktop"><span class="dc-artboard-label">Desktop</span><div class="dc-artboard-body"></div></div>';
    expect(placeHeading({ artboard: 'desktop' }, '.design/ui/Pricing.tsx')).toBe(
      'Pricing · Desktop'
    );
    expect(placeHeading({ selector: '' }, '.design/ui/Pricing.tsx')).toBe('Pricing');
    expect(placeHeading({ artboard: 'desktop' }, null)).toBe('Desktop');
  });
});

describe('the thread card', () => {
  test('no sequence badge; Resolve is a ghost button with a check and the word; the number stays a data attribute', () => {
    mountThread(comment());
    expect(q('.cm-thread__seq')).toBeNull();
    expect(q('.cm-thread')?.getAttribute('data-seq')).toBe('3');
    const resolve = q('[data-testid="comment-resolve-c1"]') as HTMLElement;
    expect(resolve.className).toContain('cm-btn--ghost');
    expect(resolve.className).not.toContain('cm-btn--primary');
    expect(resolve.querySelector('svg.cm-glyph')).not.toBeNull();
    expect(resolve.textContent?.trim()).toBe('Resolve');
  });

  test('the faces wear their person tone; an AI or an unnamed author carries none', () => {
    mountThread(
      comment({
        thread: [
          {
            id: 'r2',
            author: 'Unit AI',
            authorKind: 'ai',
            body: 'x',
            created: new Date().toISOString(),
          },
        ],
      })
    );
    const faces = [...document.querySelectorAll<HTMLElement>('.cm-av')];
    const tereza = faces[0];
    expect(tereza.style.getPropertyValue('--cm-av-tone')).not.toBe('');
    const ai = faces.find((f) => f.classList.contains('cm-av--ai'));
    expect(ai?.style.getPropertyValue('--cm-av-tone') ?? '').toBe('');
  });

  test('the reply is one field with a small accent send (the ›), not a textarea over a "Send" button', () => {
    mountThread(comment());
    const form = q('.cm-thread__reply-form--field') as HTMLElement;
    expect(form).not.toBeNull();
    const send = form.querySelector('.cm-thread__reply-actions .cm-btn--primary') as HTMLElement;
    expect(send.getAttribute('aria-label')).toBe('Send');
    expect(send.textContent?.trim()).toBe('');
    expect(send.querySelector('svg')).not.toBeNull();
  });
});

describe('the new-comment card', () => {
  test('is the same card: the heading holds the place, one field, the small accent send', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <CommentComposer
          state={{ selection: { selector: '' }, clientX: 10, clientY: 10 } as never}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      );
    });
    expect(q('.cm-composer__send svg')).not.toBeNull();
    expect(q('.cm-composer__send')?.getAttribute('aria-label')).toBe('Send');
  });
});

describe('the card is drawn like the board (CSS pins)', () => {
  const css = readFileSync(join(import.meta.dir, '..', 'client', 'comments-overlay.css'), 'utf8');
  const rule = (sel: string) => {
    const at = css.lastIndexOf(`\n${sel} {`);
    if (at < 0) return '';
    return css.slice(at, css.indexOf('}', at));
  };

  test('the thread and the composer are one island: lg radius, the island shadow, no 1px border', () => {
    for (const sel of ['.cm-thread', '.cm-composer']) {
      const r = rule(sel);
      expect(r).toContain('--maude-hud-radius-lg');
      expect(r).toContain('--maude-hud-island-shadow');
      expect(r).not.toMatch(/border:\s*1px solid/);
      expect(r).toContain('width: 3');
    }
  });

  test('the field is bg-3 with the accent ring when focused; the send is the 26 px accent square with the sm radius', () => {
    expect(rule('.cm-composer__field')).toContain('--maude-chrome-bg-3');
    expect(css).toMatch(/\.cm-composer__field:focus-within[\s\S]*?--maude-hud-accent-tint/);
    const send = rule('.cm-thread__send'); // (one rule for `.cm-composer__send, .cm-thread__send`)
    expect(send).toContain('width: 26px');
    expect(send).toContain('--maude-hud-radius-sm');
    expect(send).not.toContain('border-radius: 50%');
  });

  test('the @ picker is a menu: island material, a face, the role at the right, the highlight in accent-muted', () => {
    const pop = rule('.cm-mention-popup');
    expect(pop).toContain('--maude-hud-radius-md');
    expect(pop).not.toContain('font-mono');
    expect(rule('.cm-mention-popup__item[aria-selected="true"]')).toContain(
      '--maude-hud-accent-muted'
    );
  });
});
