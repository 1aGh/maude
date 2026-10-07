# v2 triage (Fáze 0) — rozhodnuto 2026-10-05

> **Pravidlo: nic se nemaže.** „Automatické“ a „Schovat / sloučit“ znamená pryč z viditelného chrome, nikdy odstranění funkce. Vše zůstává v menu / ⌘K / Advanced / Diagnostice.

Zdroj: [v2-feature-inventory.md](./v2-feature-inventory.md) (2026-10-05). Rozhoduje Michal; tohle je výchozí návrh.

Čtyři vrstvy:
- **Core** — vždy vidět, bez učení.
- **Kontextové** — objeví se samo, když dává smysl (výběr, typ artboardu, stav).
- **Advanced** — existuje, ale schované za přepínačem „Advanced“ / sekcí „Pro“.
- **Automatické** — aplikace to dělá sama; žádné tlačítko, žádné nastavení, nanejvýš tichý indikátor.

## Core (vždy vidět)

- Plocha canvasu + **project tabs** (+ Home).
- **Najdi canvas**: navigátor s náhledy, hledání, nedávné, připnuté; Cmd+K jako univerzální vstup.
- **Zúžená paleta nástrojů**: Select · Hand · Comment · Pen · Shape · Sticky · Text (Highlighter, Section, Arrow, Eraser, Insert → overflow „více“).
- **AI panel — jednoduchý režim**: jedno pole, chip s aktuálním výběrem, 2–3 návrhy podle kontextu.
- **Share** (jedno tlačítko), Undo/Redo, zoom.

## Kontextové

- **Inspector** jen při výběru, výchozí slovník **Designer** (Figma pojmy).
- Artboard knobs (velikost, preset, druh) při výběru artboardu.
- Toolbar anotací, Photo úpravy, výběr média — při výběru daného typu.
- **Timeline** jen u video artboardu.
- **Komentáře** jako panel jen když nějaké jsou / při Comment nástroji.
- Permission / elicitation dotazy AI — inline v AI panelu, ne modál.
- Diff / porovnání jen při konfliktu nebo z historie verzí.
- Export z výběru (pravé tlačítko / Share ▸ Export).

## Advanced (za přepínačem)

- Inspector **raw CSS** režim, Copy CSS, `data-cd-id`, Tag/Class.
- Layers jako samostatný panel; pozice panelů vlevo/vpravo.
- **Git**: větve, „Add to shared“/PR, SHA, M/A/D/U badge, fetch, nová větev.
- **AI knobs**: Model, Effort, Permission mode, Fast mode, transcript view, kontext %/tokeny, slash commands.
- DS view s token ladders a cestami.
- Skryté soubory, print guides, runtime/gitignored sekce.
- Export detaily (dpi, PDF kvalita/text/marks/bleed), AI handoff.
- **Připojení**: AI provider klíče, Figma token, vlastní hub server (adresa + token), whisper/Gemma/ffmpeg enginy.
- Sync diagnostika (Resync, Download all, held/rate-limited, trash prune, ownership `.design/`).

## Automatické (zmizí z viditelného UI, zůstává dostupné)

- **Ukládání a verze** — automaticky; uživatel vidí jen „Verze“ (historie s náhledem + Obnovit), jako Figma version history.
- **Sync / cloud** — běží samo, tichý stav u Share / u projektu; Sync panel (vč. diagnostiky) celý dostupný v menu ▸ Diagnostika.
- Server, port, live/reconnecting, `localhost:PORT`, PID — mimo chrome, dostupné v menu ▸ Diagnostika; chyba lidskou řečí.
- Reload canvasu, refresh stromu, „Repo state changed — reload?“ — dělá se samo.
- Readiness / instalace Claude Code — auto-setup při prvním otevření AI panelu.
- Volba enginů (transcription, keyframes) — vždy Auto.
- Minimap, zoom controls, auto-open inspector — rozumné defaulty, ne přepínače.
- Téma podle systému (jedna volba v Settings, ne 3 místa).
- What's new toast → jen tichá tečka; tours → kontextové hinty u první akce.

## Schovat / sloučit (z inventury) — NIC SE NEMAŽE

- 6menu in-app menubar → **jedno menu pod ikonou** (Figma-style) + Cmd+K; nativní macOS menu zůstává.
- Status bar (ACTIVE / COMMENTS / CHANGES / LIVE / HUB SYNC / verze), mode stamp IDLE/CANVAS, cesta, „N ARTBOARDS“, SKU → z chrome do menu ▸ Diagnostika / Advanced.
- Dva exportní dialogy → jeden. Share dialog se 3 odkazy → „Kopírovat odkaz“ (+ advanced).
- Dvojí „Share“ (odkaz vs GitHub invite) → jeden Share s „Pozvat lidi“.
- Duplicitní přepínače View menu × Settings → jen jedno místo.
- Kolize zkratek T/H/N (shell vs canvas) a Tools menu ≠ paleta → jeden zdroj.
- Settings 7 záložek → **Obecné** + **Připojení** + **Advanced**.

## Rozhodnutí Michala (2026-10-05)

1. **Git → jen zobrazení historie verzí.** Ukládání je automatické; uživatel vidí historii. Větve, PR, SHA, fetch → Advanced.
2. **Jedno menu pod ikonou jako ve Figmě.** In-app menubar se 6 menu mizí; vše je pod jedním tlačítkem (logo/ikona) + Cmd+K. Nativní macOS menu zůstává.
3. **Timeline jen při vybraném video artboardu.**
4. **Advanced lokálně v každém panelu** (rozbalení „Advanced“ / „Více“ v daném panelu), žádný globální „Advanced mode“.
5. **Nic nemazat.** Žádné tools, akce ani debug tools (sync atd.) se neodstraňují — jen se schovávají do menu / ⌘K / Advanced; přístup zůstává.
6. **Nový podnět: levý a pravý panel jako floating karty à la FigJam**, sbalitelné do jednoduchého icon buttonu. Canvas jde od okraje k okraji; chrome plave nad ním.

## Principy v2 (odvozené)

0. **Nic se nemaže, jen přesouvá.** Každý nástroj, akce i debug tool zůstává dosažitelný (menu pod ikonou ▸ Diagnostika, ⌘K, Advanced v panelu). Redesign mění viditelnost, ne funkčnost.
1. **Canvas je celé okno.** Chrome plave nad prací (floating panely, sbalitelné do ikony), nikdy ji neorámuje.
2. **Jedno místo pro každou věc.** Žádné duplicitní přepínače, dialogy ani „Share“ dvakrát.
3. **Výchozí hodnoty místo nastavení.** Co jde rozhodnout automaticky, nemá ovládání.
4. **Stav se ukazuje, neovládá.** Sync, ukládání, server = tichý indikátor; ozve se jen chyba, lidskou řečí.
5. **Kontext přivolá nástroj.** Inspector, Timeline, Photo, komentáře se objeví, když dávají smysl.
6. **Advanced je vrstva uvnitř panelu,** ne jiný režim aplikace.
7. **Designérský jazyk.** Verze, ne commity; Share, ne branch; žádné cesty, porty, slash příkazy v chrome.
