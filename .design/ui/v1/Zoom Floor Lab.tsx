// @opt_out full
// @ds maude
// Throwaway verification fixture for issue #91 (canvas zoom floor). One
// artboard far wider than the default viewport (20000 x 800, ~20x a 1000px
// host width) — the exact "board wider than a screenful of artboards" shape
// from the dogfood report (.ai/logs/rca/issue-91-canvas-zoom-floor.md). The
// ideal "fit to screen" zoom for this board is well under the OLD 0.1 floor,
// so it's a direct visual repro of the bug + fix. Numbered markers every
// 1000px let a screenshot at low zoom confirm the whole span is framed.
// Regenerable — delete and re-author from this description if absent.
import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

const MARKERS = Array.from({ length: 20 }, (_, i) => i);

export default function ZoomFloorLab() {
  return (
    <DesignCanvas>
      <DCArtboard
        id="zfl-wide"
        label="Wide board"
        width={20000}
        height={800}
        background="var(--bg-1)"
      >
        {MARKERS.map((i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${i * 1000 + 20}px`,
              top: '340px',
              width: 200,
              height: 120,
              borderRadius: 12,
              background: i % 2 === 0 ? 'var(--accent-1, #6b6bff)' : 'var(--accent-2, #ff6b6b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontFamily: 'var(--font-sans, system-ui)',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            {i}
          </div>
        ))}
      </DCArtboard>
    </DesignCanvas>
  );
}
