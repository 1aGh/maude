// The shell's inbound-postMessage comment relays must stay scoped to the
// ACTIVE canvas.
//
// Threat: the origin check at the top of app.jsx's `onMessage` compares against
// the single shared `canvasOrigin`, so EVERY open canvas iframe passes it —
// including ones in background tabs. `comment-submit` / `comment-patch` /
// `comment-delete` relay straight onto the privileged WS, so without a
// per-message `e.source === activeWin` gate a background canvas can write
// comments onto a file it names itself, with no user gesture. That mattered
// little while comments were an inert store; the ACP panel's one-click
// "Implement N comments" action turns open comments into a feed the agent acts
// on, which is what promoted the seam to worth-closing.
//
// This is a SOURCE-STRUCTURE test, not a behavioural one: `App()` is a
// 14k-line component that cannot be mounted in isolation, and the twenty other
// `e.source === activeWin` gates in the same handler have no coverage at all.
// Asserting on the source keeps the guard cheap and honest about its reach —
// it catches a gate being deleted, a `file:` pin regressing to the
// caller-supplied value, and (the last test) a gate that is written but cannot
// execute. It claims nothing beyond that: it does not prove the relay behaves
// correctly, only that the control is present and reachable.

import { describe, expect, test } from 'bun:test';

import { clientFiles, fileContaining } from './_client-source.ts';

/**
 * The body of one `else if (m.dgn === '<name>' …)` branch, up to the next one —
 * read in whichever client file holds the handler (app.jsx's `onMessage`
 * before the V2-0.2 split; the dgn-listener hook after it).
 */
function branch(name: string): string {
  const { src: SRC } = fileContaining(`m.dgn === '${name}'`);
  const start = SRC.indexOf(`m.dgn === '${name}'`);
  expect(start, `branch for ${name} not found in the client`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + name.length);
  const end = rest.indexOf('} else if (m.dgn ===');
  return rest.slice(0, end === -1 ? 2000 : end);
}

describe('canvas → shell comment relays are scoped to the active canvas', () => {
  // The comment relays, plus the three shell-control branches that were
  // ungated alongside them: `key` (V2-2.4's forwarded chords — reload / panel toggles /
  // Export + Handoff dialogs), and `open-export` / `open-timeline-request`,
  // which reach the same dialogs from the in-canvas toolbar and context menu.
  // All five are actions a user takes INSIDE the canvas in view; none has a
  // reason to be honoured from a background frame.
  for (const name of [
    'comment-submit',
    'comment-patch',
    'comment-delete',
    'key',
    'open-export',
    'open-timeline-request',
  ]) {
    test(`${name} is gated on e.source === activeWin`, () => {
      expect(branch(name)).toContain('e.source === activeWin');
    });
  }

  test('comment-submit pins the target file to activePath, never the payload', () => {
    const body = branch('comment-submit');
    // The file the comment lands on is the one the user is looking at.
    expect(body).toContain('file: activePath');
    // A canvas-supplied target would let a background iframe pick the victim.
    expect(body).not.toContain('file: p.file');
  });

  test('comment-patch / comment-delete only accept ids owned by the active canvas', () => {
    // A bare id would otherwise reach any comment in the project — and these
    // two verbs change or remove somebody else's note (ws.ts refuses both for a
    // viewer session for exactly that reason).
    expect(branch('comment-patch')).toContain('ownsActiveComment(m.id)');
    expect(branch('comment-delete')).toContain('ownsActiveComment(m.id)');
  });

  // The above only prove the gate is WRITTEN. This proves it can RUN.
  //
  // House style declares `const activeWin` block-locally inside each `else if`
  // branch, so a branch that compares against `activeWin` without declaring it
  // reads exactly like a working gate while throwing `ReferenceError` at
  // runtime — fail-closed, but it takes the legitimate path down with it and
  // silently reopens the moment anything introduces an outer binding. That is
  // not hypothetical: the first cut of this fix shipped it, and every
  // string-matching assertion above stayed green.
  test('every activeWin comparison has a declaration, derived from activePath', () => {
    const undeclared: string[] = [];
    let uses = 0;
    // Every client file, each scanned on its own: a branch boundary in one
    // file must never stand in for the start of a usage's branch in another.
    for (const { src: SRC } of clientFiles()) {
      // Line comments are blanked first — the prose in this handler quotes the
      // gate expression, and a comment is not a use.
      const CODE = SRC.split('\n')
        .map((l) => l.replace(/^\s*\/\/.*$/, ''))
        .join('\n');
      const BRANCH_START = /\b(?:else )?if \(m\.dgn ===/g;
      const starts = [...CODE.matchAll(BRANCH_START)].map((m) => m.index ?? 0);

      // Both idioms count: the `===` gate used by the comment relays and the
      // `!== … return` early-exit form five other branches use. Checking only
      // one lets a branch convert to the other and slip the check.
      for (const use of [...CODE.matchAll(/e\.source [!=]== activeWin/g)].map(
        (m) => m.index ?? 0
      )) {
        uses++;
        // Nearest branch boundary at or before this usage.
        const open = starts.filter((s) => s < use).pop() ?? 0;
        // `= activePath` is the load-bearing half: a declaration that derives the
        // window from the MESSAGE (`iframesRef.current.get(m.file)`) instead of
        // from app state satisfies a bare `const activeWin` check while handing
        // the attacker the very comparison the gate exists to make.
        if (!/const activeWin =\s*\n?\s*activePath/.test(CODE.slice(open, use))) {
          undeclared.push(
            CODE.slice(open, open + 60)
              .split('\n')[0]!
              .trim()
          );
        }
      }
    }
    // The handler was found at all — an empty scan approves everything.
    expect(uses).toBeGreaterThan(0);

    expect(
      undeclared,
      `activeWin used without a block-local declaration in: ${undeclared.join(' | ')}`
    ).toEqual([]);
  });
});
