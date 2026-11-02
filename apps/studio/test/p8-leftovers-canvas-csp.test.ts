// p8-sweep-leftovers items 9 + 10 — two canvas-CSP changes, for the security pair.
//
// 9. `media-src` gains `data:`. Remotion unlocks audio with a silent `data:audio/mp3;base64,…` clip on every video
//    canvas; `media-src 'self' blob:` refused it (~10k console lines per crawler run). A `data:` URL in a media
//    element is decoded bytes — it cannot run script and goes to no host — so it is allowed for `media-src` ONLY.
//    `script-src` (and every other directive) is unchanged: no `data:` there, no `unsafe-inline`.
// 10. `webrtc 'block'` is gone. It is CSP3 but enforced nowhere we ship: Chromium (capture / export workers) logs
//    "Unrecognized Content-Security-Policy directive 'webrtc'" and ignores it; WKWebView (the desktop app) parses it
//    silently and still gathers ICE candidates — measured on macOS 26.5 with a WKWebView probe (an RTCPeerConnection
//    under `webrtc 'block'` gathered the same candidate as one without it, no `securitypolicyviolation`). The real
//    defense stays: the RTC-constructor lockout in the canvas shell (`plugins/design/templates/_shell.html`) and the
//    capture browser's `--force-webrtc-ip-handling-policy` (test/p8-secfix-m1-no-egress.test.ts).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cspForCanvasShell, cspForCapture } from '../http.ts';

const SHELL = '<!doctype html><html><head><script>const x=1;</script></head><body></body></html>';
const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `)) ?? null;

describe('canvas CSP — media-src data: (item 9)', () => {
  test("media-src is exactly 'self' blob: data:", () => {
    const media = directive(cspForCanvasShell(SHELL), 'media-src');
    expect(media).toBe("media-src 'self' blob: data:");
  });

  test('script-src still allows no data:, blob: or inline script', () => {
    const csp = cspForCanvasShell(SHELL);
    const script = directive(csp, 'script-src') ?? '';
    expect(script).toMatch(/^script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')*$/);
    expect(script).not.toContain('data:');
    expect(script).not.toContain('blob:');
    expect(script).not.toContain('unsafe-inline');
    expect(directive(csp, 'default-src')).toBe("default-src 'none'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://staticimgly.com");
    // data: appears in exactly the directives that had it plus media-src
    const withData = csp
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.includes('data:'))
      .map((d) => d.split(' ')[0]);
    expect(withData.sort()).toEqual(['font-src', 'img-src', 'media-src']);
  });
});

describe('canvas CSP — no webrtc directive (item 10)', () => {
  test('neither the canvas nor the capture CSP names webrtc', () => {
    expect(cspForCanvasShell(SHELL, 'http://localhost:4399')).not.toContain('webrtc');
    expect(cspForCapture()).not.toContain('webrtc');
  });

  test('the enforceable WebRTC lockout is still in the canvas shell', () => {
    const shell = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
      'utf8'
    );
    expect(shell).toContain(
      "for (var __k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'])"
    );
    expect(shell).toContain(
      'Object.defineProperty(window, __k, { value: undefined, configurable: false, writable: false })'
    );
  });
});
