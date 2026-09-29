// EXP2 — "canvas stutters as soon as someone joins" (issue #131) measurement harness.
//
// Usage: node exp2-presence.mjs --port 4712 --cond C0|C1|C2|C3|C4 [--runs 3] [--instr 1]
//          [--engine chromium|webkit] [--out file.json] [--window 10000]
//
// Client A (measured) and client B (the joiner) are separate browser processes
// on the same local dev server; presence rides /_ws/collab/<slug> (Yjs awareness).
//   C0 A alone · C1 B joined idle · C2 B moves mouse ~60 Hz, nothing selected
//   C3 B moves mouse + has an element selected · C4 A idle (no pan) while B moves (+selection)
// A's gesture (identical every run, 10 s): per rAF a wheel pan (sinusoidal, so it
// doesn't drift off the board grid) + a mousemove on the host (so A also publishes
// its own cursor at the 30 Hz throttle, like a real user panning with a trackpad).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/Users/iagh/git/personal/maude/apps/studio/package.json');
const pw = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const PORT = args.port || '4712';
const COND = args.cond || 'C0';
const RUNS = Number(args.runs || 3);
const INSTR = args.instr !== '0';
const ENGINE = args.engine || 'chromium';
const WINDOW = Number(args.window || 10000);
const THROTTLE = Number(args.throttle || 1);
const FIT = args.fit === '1';
const OUT = args.out || `exp2-${COND}-${ENGINE}-instr${INSTR ? 1 : 0}-t${THROTTLE}${FIT ? '-fit' : ''}.json`;
const CHROME =
  process.env.PW_CHROME ||
  '/Users/iagh/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

// ── init script for A: gBCR counter + minimal React DevTools hook ────────────
const initA = ({ instr }) => {
  const S = (window.__e2e = {
    gbcr: 0,
    commits: 0,
    overlayRenders: 0,
    overlayChildRenders: 0,
    selChildRenders: 0,
    participantsRenders: 0,
    peersSeenMax: 0,
  });
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    S.gbcr++;
    return orig.call(this);
  };
  if (!instr) return;
  const last = { ov: undefined, pc: undefined, props: new Map() };
  const fiberOf = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  };
  const topOf = (f) => {
    let x = f;
    let n = 0;
    while (x.return && n++ < 500) x = x.return;
    return x;
  };
  const current = (f, root) => {
    if (!f) return null;
    if (topOf(f) === root.current) return f;
    if (f.alternate && topOf(f.alternate) === root.current) return f.alternate;
    return null;
  };
  const probe = (root) => {
    const ov = document.querySelector('.dc-cursor-overlay');
    if (ov) {
      const host = current(fiberOf(ov), root);
      if (host && host.return) {
        const comp = host.return;
        if (comp.memoizedState !== last.ov) {
          if (last.ov !== undefined) S.overlayRenders++;
          last.ov = comp.memoizedState;
        }
        // memo children live one level down inside the array fragments
        let peers = 0;
        const kids = [];
        for (let fr = host.child; fr; fr = fr.sibling) {
          if (fr.type == null) {
            for (let c = fr.child; c; c = c.sibling) kids.push(c); // array fragment
          } else kids.push(fr);
        }
        for (const c of kids) {
          if (c.key == null || typeof c.type === 'string') continue;
          const k = String(c.key);
          if (!k.startsWith('sel-') && !k.startsWith('asel-')) peers++;
          if (last.props.get(k) !== c.memoizedProps) {
            if (last.props.has(k)) {
              S.overlayChildRenders++;
              if (k.startsWith('sel-')) S.selChildRenders++;
            }
            last.props.set(k, c.memoizedProps);
          }
        }
        S.peersSeenMax = Math.max(S.peersSeenMax, peers);
      }
    }
    const pc = document.querySelector('.dc-participants');
    if (pc) {
      const host = current(fiberOf(pc), root);
      if (host && host.return) {
        const comp = host.return;
        if (comp.memoizedState !== last.pc) {
          if (last.pc !== undefined) S.participantsRenders++;
          last.pc = comp.memoizedState;
        }
      }
    }
  };
  let nextId = 1;
  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers,
    inject(r) {
      const id = nextId++;
      renderers.set(id, r);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      S.commits++;
      try {
        probe(root);
      } catch (e) {
        S.probeError = String(e);
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
};

async function launch() {
  if (ENGINE === 'webkit') return pw.webkit.launch({ headless: true, executablePath: process.env.PW_WEBKIT || '/Users/iagh/Library/Caches/ms-playwright/webkit-2336/pw_run.sh' });
  return pw.chromium.launch({ headless: true, executablePath: CHROME });
}

async function openCanvas(browser, init) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  if (init) await ctx.addInitScript(initA, { instr: INSTR });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('[data-testid="canvas-row-ui-team-structure"]', { timeout: 30000 });
  await page.click('[data-testid="canvas-row-ui-team-structure"]');
  await page.waitForSelector('[data-testid="canvas-frame"]', { timeout: 30000 });
  let frame;
  for (let i = 0; i < 120 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes('_canvas-shell'));
    if (!frame) await page.waitForTimeout(250);
  }
  await frame.waitForSelector('[data-dc-screen="b0"]', { timeout: 30000 });
  return { ctx, page, frame };
}

// A's 10 s measured window, run inside a frame (canvas iframe does the gesture;
// shell frame only samples rAF/longtasks).
const measureSrc = ({ windowMs, gesture }) =>
  new Promise((resolve) => {
    const S = window.__e2e || {};
    const base = {
      gbcr: S.gbcr || 0,
      commits: S.commits || 0,
      overlayRenders: S.overlayRenders || 0,
      overlayChildRenders: S.overlayChildRenders || 0,
      selChildRenders: S.selChildRenders || 0,
      participantsRenders: S.participantsRenders || 0,
    };
    const frames = [];
    let longtasks = 0;
    let longtaskMs = 0;
    let po;
    try {
      po = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          longtasks++;
          longtaskMs += e.duration;
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch {}
    const host = document.querySelector('.dc-canvas');
    const rect = host ? host.getBoundingClientRect() : { left: 0, top: 0, width: 1600, height: 1000 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const world = document.querySelector('.dc-world');
    const tf0 = world ? getComputedStyle(world).transform : '';
    let lastT = 0;
    let i = 0;
    const t0 = performance.now();
    const tick = (t) => {
      if (lastT) frames.push(t - lastT);
      lastT = t;
      if (gesture && host) {
        const ph = i / 60;
        host.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: Math.round(14 * Math.sin(ph * 1.3)),
            deltaY: Math.round(10 * Math.cos(ph * 0.9)),
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
          })
        );
        host.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: cx + 200 * Math.sin(ph),
            clientY: cy + 150 * Math.cos(ph * 1.7),
            bubbles: true,
          })
        );
      }
      i++;
      if (performance.now() - t0 < windowMs) requestAnimationFrame(tick);
      else finish();
    };
    const finish = () => {
      try {
        po && po.disconnect();
      } catch {}
      const s = frames.slice().sort((a, b) => a - b);
      const pct = (p) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100 : null);
      const S2 = window.__e2e || {};
      resolve({
        frames: s.length,
        p50: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
        max: s.length ? Math.round(s[s.length - 1] * 100) / 100 : null,
        over33: frames.filter((f) => f > 33.4).length,
        longtasks,
        longtaskMs: Math.round(longtaskMs),
        gbcr: (S2.gbcr || 0) - base.gbcr,
        commits: (S2.commits || 0) - base.commits,
        overlayRenders: (S2.overlayRenders || 0) - base.overlayRenders,
        overlayChildRenders: (S2.overlayChildRenders || 0) - base.overlayChildRenders,
        selChildRenders: (S2.selChildRenders || 0) - base.selChildRenders,
        participantsRenders: (S2.participantsRenders || 0) - base.participantsRenders,
        peersSeenMax: S2.peersSeenMax || 0,
        foreignCursorsInDom: document.querySelectorAll('.dc-cursor').length,
        peerSelectionsInDom: document.querySelectorAll('.dc-peer-selection').length,
        panApplied: world ? getComputedStyle(world).transform !== tf0 : null,
        probeError: S2.probeError || null,
      });
    };
    requestAnimationFrame(tick);
  });

// B: continuous ~60 Hz mouse movement inside its canvas (in-page, so it is not
// throttled by the Node<->browser round trip).
const startMoverSrc = () => {
  const host = document.querySelector('.dc-canvas');
  const r = host.getBoundingClientRect();
  let i = 0;
  window.__mover = setInterval(() => {
    i++;
    host.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: r.left + r.width / 2 + 300 * Math.sin(i / 20),
        clientY: r.top + r.height / 2 + 200 * Math.cos(i / 27),
        bubbles: true,
      })
    );
  }, 16);
  return true;
};

async function oneRun(run) {
  const bA = await launch();
  const A = await openCanvas(bA, true);
  if (THROTTLE > 1 && ENGINE === 'chromium') {
    const cdp = await A.ctx.newCDPSession(A.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  await A.page.waitForTimeout(2500);
  // _active.json is shared per project on a local server, so a previous run's
  // selection is restored into every client. Clear it so A starts unselected.
  await A.frame.locator('.dc-canvas').press('Escape');
  await A.page.waitForTimeout(600);
  if (FIT) {
    await A.frame.evaluate(() => {
      const host = document.querySelector('.dc-canvas');
      for (const t of [document, host]) t.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', metaKey: true, bubbles: true, cancelable: true }));
    });
    await A.page.waitForTimeout(1200);
  }
  let bB = null;
  let B = null;
  if (COND !== 'C0') {
    bB = await launch();
    B = await openCanvas(bB, false);
    await B.page.waitForTimeout(1500);
    if (COND === 'C3' || COND === 'C4') {
      // select a heading inside artboard b0 (select tool is default)
      const h = B.frame.locator('[data-dc-screen="b0"] h2').first();
      await h.click();
      await B.page.waitForTimeout(800);
      // B's click also lands in A's local selection via the shared _active.json
      // (a local-server-only artefact). A drops it; B keeps its own selection.
      for (let k = 0; k < 6; k++) {
        await A.frame.locator('.dc-canvas').press('Escape');
        await A.page.waitForTimeout(800);
        const own = await A.frame.evaluate(() => document.querySelectorAll('.dc-cv-halo--selected,.dc-cv-halo--selected-member').length);
        if (!own) break;
      }
    }
    if (COND !== 'C1') await B.frame.evaluate(startMoverSrc);
    await A.page.waitForTimeout(1500);
  }
  const pre = await A.frame.evaluate(() => ({ ownHalos: document.querySelectorAll('.dc-cv-halo--selected,.dc-cv-halo--selected-member').length, peerSel: document.querySelectorAll('.dc-peer-selection').length }));
  const shellP = A.page.evaluate(measureSrc, { windowMs: WINDOW, gesture: false });
  const canvasP = A.frame.evaluate(measureSrc, { windowMs: WINDOW, gesture: COND !== 'C4' });
  const [canvas, shell] = await Promise.all([canvasP, shellP]);
  const res = { run, cond: COND, engine: ENGINE, instr: INSTR, throttle: THROTTLE, fit: FIT, pre, canvas, shell: { frames: shell.frames, p50: shell.p50, p95: shell.p95, max: shell.max, longtasks: shell.longtasks, longtaskMs: shell.longtaskMs, gbcr: shell.gbcr } };
  console.log(JSON.stringify(res));
  if (B) await B.frame.evaluate(() => clearInterval(window.__mover)).catch(() => {});
  await bA.close();
  if (bB) await bB.close();
  return res;
}

const results = [];
for (let r = 1; r <= RUNS; r++) results.push(await oneRun(r));
writeFileSync(OUT, JSON.stringify(results, null, 2));
