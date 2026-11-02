/**
 * @canvas      Smoke TSX — TSX runtime smoke (single artboard, useState round-trip)
 * @ds          maude
 * @platform    web-desktop
 * @opt_out     none
 * @artboards   primary
 * @brief       Minimal canvas that exercises the dev-server pipeline end-to-end:
 *              data-cd-id injection, canvas-lib import via the virtual module,
 *              React 19 useState, and a single fixed-size artboard.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline
 * @history     _history/ui_Smoke-TSX/
 * @handoff     bunx shadcn add file://./Smoke TSX.registry.json
 *
 * Authored under the maude DS. Tokens + shared component classes load via the
 * dev-server's _shell.html harness. The frame envelope below is imported from
 * the shared canvas library (virtual specifier → `@maude/canvas-lib`).
 */

import { useState } from "react";

import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function SmokeTSX() {
  const [n, setN] = useState(0);
  return (
    <DesignCanvas>
      <DCSection id="overview" title="TSX runtime smoke">
        <DCArtboard id="primary" label="A · primary" width={696} height={404}>
          <div className="maude" style={{ padding: 32, fontFamily: "monospace" }}>
           <img
             src="assets/431f956e.jpg"
             alt=""
             style={{ maxWidth: "200px", marginTop: 16 , position: "absolute" , left: "389.96px" , top: "30px" , borderRadius: "10px" , height: "290.26px" , objectFit: "cover" , aspectRatio: "1 / 1" , width: "244.04px" }}
           />
           <h1 style={{ position: "static" , left: "2px" , top: "33px" , width: "271px" , height: "31.74px" , color: "#e60a0a" , marginTop: "0px" , marginBottom: "0px" , transform: "rotate(0.05deg)" }} data-dc-element="title">TSX smoke canvas</h1>
           <h1 style={{ position: "static" , left: "2px" , top: "33px" , width: "263.68px" , height: "37.48px" , marginTop: "0px" , marginBottom: "0px" }} data-dc-element="title">TSX smoke canvas</h1>
           <button
             type="button"
             onClick={() => setN(n + 1)}
             style={{
               padding: "8px 14px",
               border: "1px solid currentColor",
               background: "transparent",
               cursor: "pointer" }}
           >
             clicked {n}
           </button>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
