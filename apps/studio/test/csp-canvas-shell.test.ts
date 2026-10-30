// cspForCanvasShell — A6 (DDR-060 F1 re-audit) CSP hardening for the segregated
// canvas origin. Asserts the exfil-relevant directives are present and that
// `frame-ancestors` is only emitted when the main origin is known (so the legit
// cross-origin embed is never accidentally blocked).

import { describe, expect, test } from 'bun:test';

import { cspForCanvasShell } from '../http.ts';

const SHELL = '<!doctype html><html><head><script>const x=1;</script></head><body></body></html>';

describe('cspForCanvasShell — A6 hardening', () => {
  test('locks down the dangerous lanes', () => {
    const csp = cspForCanvasShell(SHELL);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    // No eval / no inline-script escape hatch.
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  test('no webrtc directive — enforced nowhere we ship (p8-leftovers-canvas-csp); the _shell.html lockout is the control', () => {
    expect(cspForCanvasShell(SHELL)).not.toContain('webrtc');
  });

  test("adds form-action 'none'", () => {
    expect(cspForCanvasShell(SHELL)).toContain("form-action 'none'");
  });

  test('hashes inline scripts (no unsafe-inline for script-src)', () => {
    const csp = cspForCanvasShell(SHELL);
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  });

  test('frame-ancestors allowlists the main origin when known', () => {
    const csp = cspForCanvasShell(SHELL, 'http://localhost:4399');
    expect(csp).toContain("frame-ancestors 'self' http://localhost:4399");
  });

  test('frame-ancestors carries every advertised loopback spelling (localhost + 127.0.0.1)', () => {
    const csp = cspForCanvasShell(SHELL, 'http://localhost:4399 http://127.0.0.1:4399');
    expect(csp).toContain("frame-ancestors 'self' http://localhost:4399 http://127.0.0.1:4399");
  });

  test('frame-ancestors is OMITTED when the main origin is unknown (would block the legit embed)', () => {
    const csp = cspForCanvasShell(SHELL);
    expect(csp).not.toContain('frame-ancestors');
  });

  // fix-photo-editor-followup-debt Task 22 — the narrow, documented
  // `connect-src` exception for @imgly/background-removal's model-weight CDN.
  // Regression guard against both directions of drift: the exception being
  // silently reverted, AND further hosts creeping in beside it.
  test('connect-src carries the exact staticimgly.com exception, no more', () => {
    const csp = cspForCanvasShell(SHELL);
    expect(csp).toContain("connect-src 'self' https://staticimgly.com");
    const connectSrc = csp.split('; ').find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toBe("connect-src 'self' https://staticimgly.com");
  });
});
