import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

const sec = (i: number, bg: string, title: string) => (
  <section data-cd-id={`sec-${i}`} style={{ height: 1000, background: bg, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", gap: 16 }}>
    <h2 style={{ fontSize: 72, margin: 0 }}>{title}</h2>
    <p style={{ fontSize: 22, maxWidth: 640, margin: 0 }}>Alligators Brno — americký fotbal pro všechny. Přijď na trénink, zapiš se na Combine a staň se součástí týmu.</p>
  </section>
);

export default function ClubPage() {
  return (
    <DesignCanvas>
      <DCSection id="club" title="Klubový web" subtitle="Jedna dlouhá stránka">
        <DCArtboard id="page" label="Klub · Desktop" width={1440} height={6000} kind="web">
          <div style={{ width: 1440, fontFamily: "system-ui, sans-serif", color: "#fff" }}>
            {sec(1, "#123524", "Alligators Brno")}
            {sec(2, "#1f4d36", "Combine 2026")}
            {sec(3, "#2f6b48", "Trenéři")}
            {sec(4, "#3e8a5c", "Hráči")}
            {sec(5, "#1f4d36", "Zápasy")}
            {sec(6, "#123524", "Kontakt")}
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
