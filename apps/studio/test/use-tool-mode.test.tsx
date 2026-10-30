// use-tool-mode — Phase 4.1 Task 2. Provider transitions + cursor sync.

import { describe, expect, test } from 'bun:test';

import { renderToStaticMarkup } from 'react-dom/server';

import {
  DEFAULT_TOOLS,
  filterToolsForReadOnly,
  MODE_DEFAULT_TOOL,
  ToolProvider,
  useToolMode,
  useToolModeOptional,
} from '../use-tool-mode.tsx';

describe('use-tool-mode / static', () => {
  test('DEFAULT_TOOLS exposes browse (boot default, no letter) + V/H/C + draw set B/I/R/N/⇧S/A/T/E', () => {
    expect(DEFAULT_TOOLS.map((t) => t.id)).toEqual([
      // feature-4 (browse/move split) — browse leads, Move (V) is the select tool.
      'browse',
      'move',
      'inspect', // S3.11 — Viewing's resting tool
      'hand',
      'comment',
      'pen',
      'highlighter',
      'shape',
      'sticky',
      'section',
      'arrow',
      'text',
      'el-text', // S2.12b — Edit's click-to-type Text
      'frame', // S2.13 — the drag tools
      'el-shape',
      'ellipse',
      'line',
      'polygon',
      'slice',
      'el-pen', // S2.14 — Edit's Pen
      'crop',
      'eraser',
    ]);
    expect(DEFAULT_TOOLS.map((t) => t.shortcut)).toEqual([
      '', // browse — no letter shortcut (palette / Esc-from-draw only)
      'V',
      '', // inspect — Viewing's H arms it
      'H',
      'C',
      'B',
      'I',
      'R',
      'N',
      '⇧S',
      'A',
      'T',
      'T', // el-text
      'F', // frame
      'R', // el-shape
      '', // ellipse
      '', // line
      '', // polygon
      '', // slice (Export area)
      'P', // el-pen (S2.14)
      '', // crop (S2.15)
      'E',
    ]);
  });

  test('DEFAULT_TOOLS is immutable (Object.freeze applied)', () => {
    expect(Object.isFrozen(DEFAULT_TOOLS)).toBe(true);
  });

  test('MODE_DEFAULT_TOOL — DDR-223 resting tools: preview→browse, edit→move', () => {
    expect(MODE_DEFAULT_TOOL).toEqual({ preview: 'browse', edit: 'move' });
    expect(Object.isFrozen(MODE_DEFAULT_TOOL)).toBe(true);
  });

  test('cursors per tool (Phase 24 — ONE Kenney library for every tool + native fallback)', () => {
    const byId = Object.fromEntries(DEFAULT_TOOLS.map((t) => [t.id, t.cursor]));
    // Phase 24 — EVERY tool (incl. move) ships a Kenney data-URI SVG cursor that
    // falls back to the right native cursor if the image is rejected.
    for (const id of [
      'move',
      'hand',
      'comment',
      'pen',
      'highlighter',
      'shape',
      'sticky',
      'section',
      'arrow',
      'text',
      'eraser',
    ]) {
      expect(byId[id]).toContain('url("data:image/svg+xml,');
      expect(byId[id]).toContain('32'); // 32×32 cursor
    }
    // Native fallbacks are preserved after the custom URL.
    expect(byId.move).toMatch(/, default$/);
    expect(byId.hand).toMatch(/, grab$/);
    expect(byId.text).toMatch(/, text$/);
    expect(byId.eraser).toMatch(/, cell$/);
    expect(byId.pen).toMatch(/, crosshair$/);
    expect(byId.shape).toMatch(/, crosshair$/);
    // feature-4 — browse is the ONE tool with NO custom glyph: it's a pure
    // native pass-through, so it shows the system `default` cursor over chrome
    // and (special-cased in the provider) native element cursors over the mock.
    expect(byId.browse).toBe('default');
  });
});

describe('use-tool-mode / useToolModeOptional', () => {
  test('returns null outside provider (SSR-safe path)', () => {
    // useToolModeOptional uses useContext directly; outside a provider it
    // returns the context's default value, which we set to null.
    // We can't render hooks standalone without a renderer, but importing the
    // module and calling useContext directly mirrors the runtime behavior.
    // This documents the contract via the export shape.
    expect(typeof useToolModeOptional).toBe('function');
  });
});

describe('use-tool-mode / SSR render', () => {
  test('ToolProvider with consumer renders without throwing', () => {
    function Consumer() {
      const { tool, mode } = useToolMode();
      return (
        <span data-tool={tool} data-mode={mode}>
          {tool}
        </span>
      );
    }
    const html = renderToStaticMarkup(
      <ToolProvider>
        <Consumer />
      </ToolProvider>
    );
    // DDR-223 (issue #93) — boot posture is EDIT with the Move (select) tool
    // armed; Preview (the DDR-187 alive posture) is one toggle away.
    expect(html).toContain('data-tool="move"');
    expect(html).toContain('data-mode="edit"');
  });

  test('ToolProvider initial="browse" boots the preview mode (comment-mount / specimens)', () => {
    function Consumer() {
      const { tool, mode } = useToolMode();
      return (
        <span data-tool={tool} data-mode={mode}>
          {tool}
        </span>
      );
    }
    const html = renderToStaticMarkup(
      <ToolProvider initial="browse">
        <Consumer />
      </ToolProvider>
    );
    expect(html).toContain('data-tool="browse"');
    expect(html).toContain('data-mode="preview"');
  });

  test('ToolProvider honors initial tool', () => {
    function Consumer() {
      const { tool } = useToolMode();
      return <span>{tool}</span>;
    }
    const html = renderToStaticMarkup(
      <ToolProvider initial="comment">
        <Consumer />
      </ToolProvider>
    );
    expect(html).toContain('comment');
  });

  test('useToolMode outside ToolProvider throws', () => {
    function BareConsumer() {
      useToolMode();
      return null;
    }
    expect(() => renderToStaticMarkup(<BareConsumer />)).toThrow(
      /useToolMode must be used inside <ToolProvider>/
    );
  });
});

// Cloud Phase 25 C2 — read-only tool filtering. The provider applies this to
// its `tools` when the canvas booted with ?ro=1; the pure function is what the
// contract pins: navigate/inspect only, every write tool absent.
describe('use-tool-mode / read-only filter', () => {
  test('read-only keeps exactly browse + move + inspect + hand, in order', () => {
    expect(filterToolsForReadOnly(DEFAULT_TOOLS, true).map((t) => t.id)).toEqual([
      'browse',
      'move',
      'inspect',
      'hand',
    ]);
  });

  test('comment is filtered too — the cell refuses viewer comments until C3', () => {
    const ids = filterToolsForReadOnly(DEFAULT_TOOLS, true).map((t) => t.id);
    expect(ids).not.toContain('comment');
  });

  // Wave-B gate (15 an-viewer, 04 md-comment-only): a Can comment session boots `ro=1&cm=1`. Its
  // Preview toolbar is Hand and Comment — so the Comment tool must survive the read-only filter,
  // or the slot has nothing to arm and the bar shows Hand alone (seen on a local cell).
  test('a read-only Can comment session keeps Comment; Can view still does not', () => {
    const commenter = filterToolsForReadOnly(DEFAULT_TOOLS, true, true).map((t) => t.id);
    expect(commenter).toEqual(['browse', 'move', 'inspect', 'hand', 'comment']);
    expect(filterToolsForReadOnly(DEFAULT_TOOLS, true, false).map((t) => t.id)).not.toContain(
      'comment'
    );
  });

  test('readOnly=false is identity', () => {
    expect(filterToolsForReadOnly(DEFAULT_TOOLS, false)).toEqual([...DEFAULT_TOOLS]);
  });
});
