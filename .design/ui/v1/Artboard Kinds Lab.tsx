// @opt_out full
// @ds maude
// Throwaway verification fixture for feature-1-artboard-kinds-foundation.
// Three DCArtboards, all default (digital) kind, for exercising the
// Inspector "Kind" picker + context-menu "Artboard kind" submenu +
// per-kind chrome chip. Regenerable — delete and re-author from the
// artboard-kinds scenario spec if absent.
import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function ArtboardKindsLab() {
  return (
    <DesignCanvas>
      <DCArtboard gap={16} padding={16} kind="print" print={{"paper":"a4"}} background="var(--bg-0)" id="ak-alpha" label="Alpha" width={816} height={1145}>
        <p style={{ color: 'var(--fg-2)' , position: "absolute" , left: "58px" , top: "179px" }}>Switch my kind via the Inspector picker.</p>
        <div style={{ padding: 32, fontFamily: 'var(--font-sans, system-ui)', color: 'var(--fg-0)' , position: "absolute" , left: "353px" , top: "27px" }}>
          <h2 className="akl-title" data-cd-id="akl-alpha-title" style={{ margin: 0 }}>Alpha board</h2>
        </div>
        <img src="assets/99267681.jpg" alt="" style={{ width: "414.3px", height: "581.45px", objectFit: 'cover', borderRadius: 8 , position: "absolute" , left: "131px" , top: "275px" }} />
      </DCArtboard>
      <DCArtboard id="ak-beta" label="Beta" width={600} height={400}>
        <div style={{ padding: 32, fontFamily: 'var(--font-sans, system-ui)', color: 'var(--fg-0)' }}>
          <h2 className="akl-title" data-cd-id="akl-beta-title" style={{ margin: 0 }}>Beta board</h2>
          <p style={{ color: 'var(--fg-2)' }}>Switch my kind via the right-click submenu.</p>
        </div>
      </DCArtboard>
      <DCArtboard id="ak-gamma" label="Gamma" width={600} height={400}>
        <div style={{ padding: 32, fontFamily: 'var(--font-sans, system-ui)', color: 'var(--fg-0)' }}>
          <h2 className="akl-title" data-cd-id="akl-gamma-title" style={{ margin: 0 }}>Gamma board</h2>
          <p style={{ color: 'var(--fg-2)' }}>Baseline digital board (no chip expected).</p>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
