# Maude v2.0.0 redesign — postup (design-first)

Created 2026-10-05. Status (2026-10-06): Fáze 0 hotová; DS `maude-v2` zbootstrapovaný (critici: signature 4.2, a11y/copy/graphic blokery opraveny); Fáze 2 rozjetá — 13 canvasů v `.design/ui/v2/` (00 Index + 01–12, ~265 artboardů, kit `_kit.tsx`), pravidla v `system/maude-v2/CONTRACT.md` §6–§7, otevřené otázky v [v2-open-questions.md](./v2-open-questions.md). Vše se nejdřív navrhuje jako canvasy v Maude; implementace až po `/flow:setup-prd`.

## Zadání (Michalova slova, zkráceně)

- Předělat UI tak, aby podporovalo **desktop project tabs** a bylo **kompletně user-friendly**.
- Pocit spíš **Figma / Framer / Notion** — pro designéry, ne pro kodéry.
- Dnes spousta funkcí, lidé neví jak je použít, „vypadá to jako řízení jaderné elektrárny“.
- **Jednoduchost** + možnost zobrazit „advanced“; vše lehké, bez zbytečného nastavování, prostě to funguje.
- Uživatel vždy **najde správný canvas**, může použít **ACP panel v jednoduchém módu**, aplikace působí **autonomně** — „zvládne to za mě“.
- Dokumentace: výchozí předpoklad = nainstaluj desktop a tvoř. Vše ostatní je advanced.

## Rozhodnutí (2026-10-05)

| Otázka | Rozhodnutí |
| --- | --- |
| Design system | **Nový `maude-v2` vedle** stávajícího `maude` (`/design:setup-ds maude-v2`). Starý zůstává referencí, dokud klient nepřejde. Důvod: hard-rules `maude` (dense, mono first-class, IDE heritage, „profíci“) jdou proti zadání. |
| Project tabs | **Navrhnout obě varianty** v showcase canvasu — nativní macOS window tabs (dle `feature-desktop-project-tabs-and-identity-profiles`, DDR-109) vs vlastní tab strip à la Figma (vč. Home). Rozhodnout nad vizuálem; vlastní strip by znovu otevřel architektonické rozhodnutí plánu. |
| Brand | **Logo zůstává** — DS kotvit přes `--from-brand` na `system/maude/assets/logos`. |
| Rozsah v2 | **Desktop app + studio** a **docs + web maude.sh**. Hub/cloud admin mimo scope. |

## Fáze

0. **Audit + principy** — inventura funkcí → Core / Contextual / Advanced / Automatic (bez nastavení); 5 klíčových cest (install → první canvas < 2 min · najdu canvas · zeptám se AI · sdílím · vrátím se do projektu); 5–7 principů v2. Výstup: `/design:board` + kg decision. Baseline screenshoty současného UI.
1. **DS `maude-v2`** — plný `/design:setup-ds maude-v2 "<brief verbatim>" --from-brand <logo>` (Stage 1 vize odpovídá Michal, Stage 3 moodboard 3 směry, LOCK).
2. **Shell + klíčové obrazovky** (`/design:new`, multi-artboard, stavy):
   1. Desktop showcase — shell v2 + project tabs (obě varianty) + profil per tab. Tier-0 prior pro vše ostatní.
   2. Home / launcher — first-run, recents, nový projekt, otevřít složku.
   3. Canvas finder — navigátor, náhledy, Cmd+K, pinned/recents.
   4. Canvas workspace — minimální toolbar, kontextový inspector, Simple/Advanced.
   5. AI panel (ACP) simple mode — jedno pole, návrhy, chip s výběrem; model/permissions/slash = advanced.
   6. Share — jedno tlačítko, pod ním cloud/sync/hub.
   7. Ambientní stav — git/sync/server jako tichý indikátor, ne panely.
   8. Settings — pár basics + Advanced.
3. **Docs + web** — nová IA: Getting started = install desktop; zbytek pod „Advanced / Explore Maude“.
4. **Critic + validace** — `/design:critic` (IA, copy, a11y) per obrazovka; ideálně test s jedním nekóderem.
5. **Handoff** — `/flow:setup-prd "Maude v2.0.0"`; UI část plánu project tabs přepsat na v2 shell (Rust/backend část platí).
