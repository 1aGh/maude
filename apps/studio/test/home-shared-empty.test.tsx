// W5 (2.0.5) — Home › "Shared with you" with nothing shared reads as an intentional empty state, not as
// failed thumbnails: no ghost tiles on that shelf, one quiet glyph + the words, no tilt, no clipping, a
// bounded height (the card stays as short as Recent canvases and Projects). The ghost tiles Projects
// still uses are flat decoration — never rotated or transformed (they looked like skewed thumbnails).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4479/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { SharedWithYou } from '../client/home/Shelves.jsx';

const CSS = readFileSync(join(import.meta.dir, '..', 'client', 'home', 'home.css'), 'utf8');

/** every declaration block whose selector list mentions `needle` */
function blocks(needle: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(CSS); m; m = re.exec(CSS)) {
    if ((m[1] as string).includes(needle)) out.push(m[2] as string);
  }
  return out;
}

function mountEmpty() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(
      createElement(SharedWithYou, {
        rows: [],
        invites: [],
        newCount: 0,
        canOpen: true,
        busyKey: null,
        onOpen: () => {},
        onJoin: () => {},
        onLeave: () => {},
      })
    );
  });
  return host;
}

describe('Shared with you, nothing shared yet (W5)', () => {
  test('the words, one glyph, no ghost tiles, no button', () => {
    const host = mountEmpty();
    const card = host.querySelector('[data-testid="home-shared-empty"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Nothing shared with you yet.');
    expect(card.textContent).toContain('When someone shares a project with you, it shows up here.');
    // no placeholder tiles that could read as failed thumbnails
    expect(card.querySelector('.home-ghosts')).toBeNull();
    expect(card.querySelectorAll('i').length).toBe(0);
    // one quiet 18 px glyph from the empty kit, hidden from assistive tech
    expect(card.querySelectorAll('.es-glyph').length).toBe(1);
    expect(card.querySelector('.es-glyph svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('button')).toBeNull();
    // the compact modifier is what bounds its height and clips nothing
    expect(card.className).toContain('home-shelf-row--lone');
    // nothing on it is transformed inline either
    for (const el of card.querySelectorAll('[style]')) {
      expect(el.getAttribute('style')).not.toMatch(/rotate|skew|transform/i);
    }
  });
});

describe('the empty shelves’ stylesheet (W5)', () => {
  test('ghost tiles are never rotated, skewed or transformed (no thumbnail look, no clipping at the edge)', () => {
    const ghost = blocks('.home-ghosts');
    expect(ghost.length).toBeGreaterThan(0);
    for (const b of ghost) expect(b).not.toMatch(/\b(rotate|skew|transform|translate|scale)\b/);
    // and no nth-child tilt rule survives
    expect(CSS).not.toMatch(/\.home-ghosts\s*>\s*i:nth-child\([^)]*\)\s*\{[^}]*rotate/);
    // decoration, not a picture: no solid fill
    const tile = blocks('.home-ghosts > i').join('\n');
    expect(tile).toMatch(/background:\s*transparent/);
  });

  test('the lone shelf card has a bounded height and clips nothing visible', () => {
    const lone = blocks('.home-shelf-row--lone').join('\n');
    expect(lone).toMatch(/overflow:\s*hidden/);
    // no fixed or minimum height: it is as tall as its two lines
    expect(lone).not.toMatch(/\b(min-)?height\s*:/);
    const inner = blocks('.home-shelf-row--lone .es-e').join('\n');
    expect(inner).not.toMatch(/\b(min-)?height\s*:/);
    // the glyph sits beside the words, not above them (one row)
    expect(inner).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\)/);
  });

  test('the two columns stack at narrow widths so the card is never squeezed', () => {
    expect(CSS).toMatch(
      /@media \(max-width: 720px\)\s*\{\s*\.home-two\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
    );
  });
});
