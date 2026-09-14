import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

// Execute the actual shell handler against DOM media elements. Native E2E
// additionally verifies decoded frames; these tests control arrival/error order.
const shell = readFileSync(
  new URL('../../../plugins/design/templates/_shell.html', import.meta.url),
  'utf8'
);
const marker = "} else if (msg.mode === 'asset') {";
const start = shell.indexOf(marker) + marker.length;
const end = shell.indexOf('\n            }\n          } catch (e)', start);
if (start < marker.length || end < start) throw new Error('Missing asset handler');
let window: Window;
let arrival: (file?: string) => void;
beforeEach(() => {
  window = new Window({ url: 'http://localhost:4399/_canvas-shell.html' });
  const handle = new Function(
    'document',
    'location',
    'withCap',
    'designRel',
    `
    const pendingMediaHeals = new WeakMap();
    return function(msg) { ${shell.slice(start, end)} };
  `
  )(window.document, window.location, (s: string) => s, '.design');
  arrival = (file = 'assets/late.mp4') => handle({ file, version: 123 });
});
function media(
  tag = 'video',
  src = '/.design/assets/late.mp4?t=cap&other=yes#t=0.2',
  child = false
) {
  const el = window.document.createElement(tag) as unknown as HTMLMediaElement;
  const target = child ? window.document.createElement('source') : el;
  target.setAttribute('src', src);
  if (child) el.append(target as unknown as Node);
  let loads = 0;
  el.load = () => {
    loads++;
  };
  window.document.body.append(el as never);
  const state = (error: boolean, readyState = 0, networkState = 3) => {
    Object.defineProperties(el, {
      error: { configurable: true, value: error ? { code: 4 } : null },
      readyState: { configurable: true, value: readyState },
      networkState: { configurable: true, value: networkState },
    });
  };
  state(true);
  return { el, target, state, loads: () => loads };
}
for (const tag of ['video', 'audio']) {
  test(`arrival retries failed ${tag} and preserves URL credentials/fragment`, () => {
    const m = media(tag);
    arrival();
    const url = new URL(m.target.getAttribute('src')!, window.location.href);
    expect(m.loads()).toBe(1);
    expect(url.searchParams.get('t')).toBe('cap');
    expect(url.searchParams.get('other')).toBe('yes');
    expect(url.searchParams.get('v')).toBe('123');
    expect(url.hash).toBe('#t=0.2');
  });
}
test('a failed source child retries its parent once', () => {
  const m = media('video', '/.design/assets/late.mp4', true);
  m.state(false, 0, 3);
  arrival();
  expect(m.loads()).toBe(1);
  expect(m.target.getAttribute('src')).toContain('v=123');
});
test('healthy playing media keeps its source, position and load state', () => {
  const m = media();
  m.state(false, 4, 1);
  m.el.currentTime = 1.4;
  const src = m.target.getAttribute('src');
  arrival();
  expect(m.loads()).toBe(0);
  expect(m.target.getAttribute('src')).toBe(src);
  expect(m.el.currentTime).toBe(1.4);
});
test('unrelated paths, filename suffixes and external origins are untouched', () => {
  const items = [
    media('video', '/.design/other/late.mp4'),
    media('video', '/.design/assets/late.mp4.backup'),
    media('video', 'https://other.example/.design/assets/late.mp4'),
  ];
  arrival();
  expect(items.map((m) => m.loads())).toEqual([0, 0, 0]);
});
test('arrival before an outstanding 404 retries on the later error only once', () => {
  const m = media();
  m.state(false, 0, 2);
  arrival();
  arrival();
  expect(m.loads()).toBe(0);
  m.state(true);
  m.el.dispatchEvent(new window.Event('error') as unknown as Event);
  expect(m.loads()).toBe(1);
  m.el.dispatchEvent(new window.Event('error') as unknown as Event);
  expect(m.loads()).toBe(1);
});
test('successful initial load cancels the deferred error retry', () => {
  const m = media();
  m.state(false, 0, 2);
  arrival();
  m.state(false, 1, 1);
  m.el.dispatchEvent(new window.Event('loadedmetadata') as unknown as Event);
  m.state(true);
  m.el.dispatchEvent(new window.Event('error') as unknown as Event);
  expect(m.loads()).toBe(0);
});
test('changing source after arrival never restores the earlier asset', () => {
  const m = media();
  m.state(false, 0, 2);
  arrival();
  m.target.setAttribute('src', '/.design/assets/new.mp4');
  m.state(true);
  m.el.dispatchEvent(new window.Event('error') as unknown as Event);
  expect(m.loads()).toBe(0);
  expect(m.target.getAttribute('src')).toBe('/.design/assets/new.mp4');
});
