/**
 * @canvas      Retention 7 Dni, whiteboard
 * @ds          studyfi-v3
 * @platform    desktop
 * @kind        canvas (whiteboard host)
 * @stack       React 19 · TSX · Bun.build
 * @history     .design/_history/ui-ai-studymate-retention-retention_7_dni
 *
 * 7denní onboarding pro retention – přepis brainstormingu z tabule (22.–25. 9. 2026)
 * a souhrnu `studyfi-7denni-onboarding.md`. Board sám žije v párovém
 * `.annotations.svg`: Day 0 (kroky 1–2 → 5 větví A–E), sekce plánů A–E se sloupci
 * po dnech, přechody mezi plány jako čárkované koleje v mezerách mezi sloupci,
 * průřezová pravidla dole. Tenhle canvas nese jen hlavičku.
 */

import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

function Header({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div
      lang="cs"
      style={{
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "10px",
        padding: "40px 48px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        background: "#ffffff",
        color: "#1e1e1e",
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: 600, letterSpacing: "0.08em", color: "#5f6571" }}>
        {kicker}
      </div>
      <div style={{ fontSize: "40px", fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ fontSize: "16px", color: "#5f6571" }}>{sub}</div>
    </div>
  );
}

export default function Retention7Dni() {
  return (
    <DesignCanvas>
      <DCSection id="retention-7-dni" title="Retention · 7denní onboarding">
        <DCArtboard id="header" label="7denní onboarding pro retention" width={3320} height={200}>
          <Header
            kicker="RETENTION · 7DENNÍ ONBOARDING · BRAINSTORM 22.–25. 9. 2026 · PLÁNY A–E"
            title="Dostat nové uživatele do Day 7"
            sub="PostHog 22. 9. 2026 (signup kohorta 27. 7.–14. 9., N = 23 871, tier Engaged): D0 31 % · D1 6,5 % · D2 3,0 % · D7 1,3 % (nejvolnější definice D1 14 % · D7 3,7 %). Upload v D0 = 3× vyšší D7. Krok 2 „S čím ti mám pomoct?“ větví onboarding do plánů A–E; čárkované koleje = přechody mezi plány. Čísla z tabule (75 / 15–20 / 7 %) neověřena."
          />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
