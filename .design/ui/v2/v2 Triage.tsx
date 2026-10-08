/**
 * @canvas      v2 Triage — brief board
 * @ds          maude
 * @platform    desktop
 * @kind        brief-board
 * @stack       React 19 · TSX · Bun.build
 * @history     .design/_history/ui-v2_triage
 *
 * Annotation-only brief board (Phase 22). This canvas is born EMPTY on purpose:
 * one framed reference artboard you fill with sticky notes (N), text (T), and
 * arrows (A) describing what each screen should do. When you run `/design:new`
 * again while this board is the active canvas, Claude reads those annotations as
 * a VERBATIM brief and inserts the matching generated artboards right here, below
 * this frame — the board becomes a living brief you sketch and Claude fills in.
 *
 * The annotation layer lives in a sibling `<slug>.annotations.json` (NEVER in this
 * file), so your notes stay floating on top across every regeneration. No design
 * system tokens or classes are wired in — the board is a neutral surface; the
 * generated artboards bring the DS with them on ingest.
 */

import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function V2Triage() {
  return (
    <DesignCanvas>
      <DCSection id="brief-board" title="Brief">
        <DCArtboard id="brief" label="v2 Triage" width={1280} height={240}>
          <div
            style={{
              boxSizing: "border-box",
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "14px",
              padding: "48px",
              textAlign: "center",
              fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
              color: "#9aa0a6",
              background: "#ffffff",
              border: "1.5px dashed #d4d8dd",
            }}
          >
            <div style={{ fontSize: "22px", fontWeight: 600, color: "#5f6571" }}>
              v2 Triage
            </div>
            <div style={{ fontSize: "14px", color: "#8a9099" }}>Maude v2.0.0 — triage funkcí, principy, rozhodnutí a klíčové cesty</div>
            <div style={{ fontSize: "13px", maxWidth: "460px", lineHeight: 1.55 }}>
              Drop sticky notes (N), text (T) &amp; arrows (A) here describing what
              each screen should do — then run <code>/design:new</code> again to have
              Claude read your notes and lay the matching artboards out right here.
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
