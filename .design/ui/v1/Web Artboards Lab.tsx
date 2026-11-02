// @opt_out full
// @ds maude
// Throwaway verification fixture for feature-3-web-artboards.
//   web-hero  — kind="web", flow-first (flex) content, for the breakpoint
//               chip ("≤ 1280px") + "Duplicate at width…" clone.
//   web-grid  — kind="web", carries a display:grid container (data-cd-id
//               "wal-grid") for the grid-template-columns/rows edit-css
//               round-trip.
// Regenerable — delete and re-author from the web-artboards scenario spec.
import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function WebArtboardsLab() {
  return (
    <DesignCanvas>
      <DCArtboard kind="web" id="web-hero" label="Web hero" width={1280} height={720}>
        <header
          data-cd-id="wal-hero-nav"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 48px',
            fontFamily: 'var(--font-sans, system-ui)',
            color: 'var(--fg-0)',
          }}
        >
          <strong>Acme</strong>
          <nav style={{ display: 'flex', gap: 24, color: 'var(--fg-2)' }}>
            <span>Product</span>
            <span>Pricing</span>
            <span>About</span>
          </nav>
        </header>
        <section
          data-cd-id="wal-hero-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            padding: 48,
            fontFamily: 'var(--font-sans, system-ui)',
            color: 'var(--fg-0)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 44 }}>Build responsibly.</h1>
          <p style={{ margin: 0, color: 'var(--fg-2)', maxWidth: 560 }}>
            A flow-first landing artboard. Drag the width handle to test reflow — the
            breakpoint chip tracks the live width.
          </p>
          <button
            style={{
              alignSelf: 'flex-start',
              padding: '12px 24px',
              borderRadius: 8,
              background: 'var(--accent)',
              color: 'var(--bg-0)',
              border: 'none',
            }}
          >
            Get started
          </button>
        </section>
      </DCArtboard>

      <DCArtboard kind="web" id="web-grid" label="Web grid" width={900} height={500}>
        <div
          className="wal-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: 'auto auto',
            gap: 16,
            padding: 24,
            fontFamily: 'var(--font-sans, system-ui)',
            color: 'var(--fg-0)',
          }}
        >
          <div style={{ padding: 24, background: 'var(--bg-1)', borderRadius: 8 }}>Cell 1</div>
          <div style={{ padding: 24, background: 'var(--bg-1)', borderRadius: 8 }}>Cell 2</div>
          <div style={{ padding: 24, background: 'var(--bg-1)', borderRadius: 8 }}>Cell 3</div>
          <div style={{ padding: 24, background: 'var(--bg-1)', borderRadius: 8 }}>Cell 4</div>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
