# Issues burndown 2026-11 — finální report

Pro Michala. Stav ke dni 2026-11-08, main = origin/main (`a680f7fe0`, plus další commity z tohoto reportu).

## Výsledek

Na začátku bylo v `1aGh/maude` otevřených 21 issues, teď **0**. Každé zavřené issue má komentář s commity a důkazem (test, run nebo měření). Práce šla na main v 7 vlnách. Před každou vlnou proběhla celá suite na mini (studio, hub, cli, scripts) a lokální gates (lint, tsc + coverage, actions/surfaces, parity, import coherence, nothing-deleted, styles, containment, site regen) a pak release rebuild klienta, boot check a smoke.

## Co se zavřelo a jak

| # | Co | Jak |
| --- | --- | --- |
| #113 | Checklist v canvasu | Postavený celý: e2e 6/6, fade „+N more“, převod checklist → komentář, docs + What's New. |
| #122 | Copy/paste artboardů a elementů mezi canvasy | Postavený (contract `122-cross-canvas-clipboard`). Schránka nese jen média, záměr vložení řeší shell, bezpečnostní pár zelený. |
| #127, #128 | Export videa / HEVC | Opravená příčina, cloud: scale 1 + JPEG mezisnímky, jedna video úloha s frontou, `/_render/cancel` + stav úlohy (D7). |
| #150 | MP4 export zahazoval inline SVG | Guard v serializaci, před/po živým exportem. |
| #151 | Komentář nedržel u elementu | Akce „Re-attach to element“ (D5), stabilní kotvy, ověřeno pan/zoom/reload. |
| #155 | Figma offline import | Fonty na DS stacky, contrast floor proti reálnému podkladu (D8), robustnost. |
| #156 | Kontext pluginů | Popisy agentů zkrácené (flow 4279→2168, design 11497→3611 znaků), Codex mirrory mimo `skills/` (design 43→12 skillů), video část jako opt-in plugin `design-video` (DDR-249). |
| #158 | Varování při importu souborů, které se nesynchronizují | Postaveno. |
| #163 | Otevřená produktová rozhodnutí | D1 (doporučené volby), `/_api/ai/start` vrací 410. |
| #164 | Připisování AI zápisů | Podle toho, co volání skutečně zapsalo (park-then-settle, D11), ne podle časového okna. |
| #165 | Undo vs. spolupracovníci | Odmítnutí při kolizi v legacy save mode, `rejected/stale` se dostane do undo (D9). |
| #167 | Hranice hub složky, držené soubory | Follow-upy hotové. Adopt bere jen tu verzi, která byla zobrazena (409/428). |
| #168 | Security backlog | Viz níže; jedna origin na canvas uzavřena jako pojmenovaná mezera (D10). |
| #169 | Výkon | Obrázky verzí warm p50 ≈ 259 ms (rozpočet 300). Zhruba 90 ms dřív přidával sám bench. |
| #170 | Polish shellu + docs | Včetně D3, D4, D15 (Layers/Inspector ve View, řádek AI chat). |
| #171 | Spolehlivost testů a harnessu | Opravené harnessy (22 rozbitých specs, surface L01/L02/L07). |
| #172 | Stavy boardu | Postavené všechny stavy, pro které jde napsat spec. Dva stavy podle tvého OK „not planned“ (viz níže). |
| #206 | CLI používá servery Maude Desktop | DDR-250 (A), důvěra při prvním otevření podle tvé volby A. Bezpečnostní pár zelený. |
| #208 | Linux, černá půlka okna | Opraveno, Linux shell lane v CI (D12). |
| #212 | Overview stills nebliknou do prázdna | Dvouúrovňová cache (decoded tier ~99→43 MB), persistence za bezpečnostním párem (D2). |

## Defaulty D1–D15 (všechny jsou v kg, `decision:maude/burndown-d*`; každý můžeš zvrátit)

- **D1** #163: doporučené volby. Esc ponechá napsaný text. Preview nesbaluje panely. Lišta „Previewing“ jen s Back. „Add comment“ v hlavní skupině. `/_api/ai/start` je zrušené. Sticky do sekce adoptuje jen tažení.
- **D2** #212: persistence stillů s limity velikosti/typu, klíč vybírá shell, rozsah per canvas.
- **D3** #170: přepínač `PREVIEW_EASES` odstraněn i s mrtvou cestou.
- **D4** #170: `dsPreview` blokující drop v Assets bereme jako bug, opraveno.
- **D5** #151: „Re-attach to element“ v menu komentáře.
- **D6** #128: výchozí scale 1, když kratší strana ≥ 1080 px, jinak 2.
- **D7** #128: cloud video scale 1, JPEG mezisnímky, jedna mp4 úloha naráz. Velikost render instance beze změny (jinak by to byla změna v Cloudflare).
- **D8** #155: Figma fonty na DS stacky; contrast floor proti skutečnému podkladu.
- **D9** #165: odmítnutí při kolizi a `rejected/stale` do undo. Obrací to rozhodnutí z 29. 10.
- **D10** #168: jedna origin na canvas → spike ukázal, že čisté řešení neexistuje, takže mezera zůstává pojmenovaná a změřená. Výjimky ux-patterns jen podle ID pravidla, nikdy pro blockery (potvrdil jsi).
- **D11** #164: spike, pak build připisování podle hash diffu.
- **D12** #208: Linux je podporovaný cíl, má CI lane.
- **D13** #172: postavit, co má spec; zbytek „not planned“ s tvým OK.
- **D14** release: návrh **2.1.0** (rozdělení `design-video` je pro uživatele viditelné). Tag nedělám.
- **D15** #170: Layers a Inspector přesunuté z Advanced do View; ve View přibyl řádek AI chat.

## Tvoje rozhodnutí v tomto běhu

- #206 důvěra při prvním otevření: **A**. Zeptat se jednou u každé nové složky, známé složky a jejich worktrees se otevírají bez ptaní, přepínač je v Settings.
- #168 ux-patterns: výjimky jen podle ID, nikdy blockery, critics hlásí výjimky.
- #172: tag držení se slovesem a ghost „Mobile next“ zavřené jako not planned.
- #168 F1: chip pro obrázek ponechán.
- Loopback: **klíč od každého volajícího**.
- Placené generování: **nechat otevřené, omezit útratu**.

## Co přibylo navíc (vyplynulo z bezpečnostních review #206/#122-C)

- **Loopback klíč (fáze 2 + 2b):**
  - Server spuštěný z appky nebo z terminálu odpovídá jen tomu, kdo má jeho klíč. Stránka ho dostane z Tauri, terminálový prohlížeč přes jednorázový odkaz, helpery přes `studio_curl` / `studioHeaders`.
  - Proběhla tři kola review (defender + attacker + re-review). Všechny high a medium nálezy jsou zavřené testy, které bez opravy padají:
    - capability pro canvas jen s přihlášením;
    - AI nikdy nedostane session;
    - „osoba“ = session stránky (platba, push, sdílení);
    - náhodné session uložené na serveru;
    - launch odkazy mimo cesty, které AI čte (zavřelo to i libovolné čtení/mazání souborů přes `screenshot --url-file`);
    - odmítnutí `maude-launch` v URL guardu;
    - redakce v logu;
    - oddělený rozpočet session pro helpery.
  - Zbytková rizika jsou v contractu §7.9.
- **Spend cap:**
  - Odhad na jednu úlohu (obrázek $0.10 až video $3.50). Limity $2 za session, $10 za den a potvrzení nad $1, nastavitelné v Settings › Advanced › Generation spend.
  - Schválit platbu nebo změnit limity umí jen osoba v appce, ne AI ani helper.
- **Surface harness:**
  - L01/L02/L07 jsou zelené.
  - Harness odhalil produktový bug: autorův strom se po přejmenování nebo přesunu prázdné složky neobnovoval. Opraveno.

## Gates na finálním tipu (T9.1)

| Gate | Stav |
| --- | --- |
| Celá studio suite (mini) | 24048/24049 na `f0389aad3`; jediný červený byl zastaralý pin, opraven. |
| Hub, cli, scripts | 2215/2215 · 801/801 · 397/398 (jediný fail je test „version not below stable tag“, který na mini nemá tagy; v CI prochází). |
| check-client-boots (zdroj + postavená `.app`) | OK |
| check-bundle-completeness --smoke | OK, až po opravě. Smoke našel, že `server-up` z debug `.app` bral package root z `target/debug` (c7ba1cea8). |
| Live render smoke (opening card) | OK po každé dávce |
| Desktop e2e | **Červené.** Zelené: tabs 12, home 15, relaunch 5, cli-reuse 5, ai-runs 5, generate-takes 3, shell-panels 5, surface L01 14/14; default lane 49/55. **Oprava:** původně jsem psal, že červené nejsou platné (okno „vidět v 1 z 88 vzorků“). Moje sonda ale počítala jen window layer 0 a testovací okno je na layeru 5. Rerun s oknem prokazatelně na obrazovce červené potvrdil: edit-multi, edit-pen, export-formats (8), exports-panel, video-ai-cut-stop (ráno ještě prošel), shell-menus (drift po D15), clip 122-C a onboarding. Jde o regrese z dnešních merge. Opravuje je builder. **Tag čeká na opravu.** |
| Perf sweep Safari + Chromium | **Tip není horší než v2.0.8** (v rámci rozptylu). Kopie mascot canvasu (88 artboardů), 2560×1340, 3 načtení × 3 průchody, bez boot cover sweepu; okno Safari bylo vidět v 95 z 96 vzorků. p95 Safari tip/base: overview 54/51, fit 17/16, zoom cykly 45/56, po zoomu 15/27 ms. Chromium (headless): po zoomu 18,6/34,6 ms. Prázdné snímky 0. Nová lane `perf.sh --sweep` je commitnutá. Retina (dpr 2) v Tauri neměřena. |
| Bezpečnostní pár | #206/#122-C, W2.2 stills, #164, loopback fáze 2 (3 kola) |
| gen:roadmap / gen:stats | OK. CI drift byl lokální tag `v0.5.0`, který na originu chybí (opraveno 19b765f54). |

## Not planned (s důvodem)

- #172 tag držení se slovesem a ghost „Mobile next“: nemají produktový význam, neutrální kroužky zůstávají (tvoje OK).
- #168 jedna origin na každý canvas: spike ukázal, že čisté řešení neexistuje. Neprůhledné framy ztrácejí capability pro subresource, `*.localhost` stojí ~220 ms na frame ve WebKitu a origin podle portu funguje jen lokálně. Mezera je pojmenovaná: session jen pro jeden canvas připojí jen aktivní frame.

## Známé mezery a follow-upy

- **Nesoulad verzí CLI a appky (release note):**
  - Helpery jdou s CLI `maude`, ne s pluginy. Starší globální `maude` z npm v terminálu (třeba ve StudyFi repech) proti novějšímu desktop serveru dostane u helperů 401.
  - Opačně (nové CLI, starý server) to funguje.
  - Do release notes: „aktualizuj CLI spolu s appkou“.
- Loopback zbytková rizika (§7.9):
  - kontrola, že terminálový server klíč skutečně drží, ještě chybí;
  - kdo má klíč, může pořád vystupovat jako osoba (řešilo by to nativní potvrzení v Rustu);
  - WebKit Sec-Fetch-Site na nejstarším podporovaném macOS ověřit e2e;
  - cookies v terminálovém prohlížeči přecházejí mezi localhost porty.
- Desktop e2e reruny s viditelným oknem (viz výše).
- #212 Retina eviction není změřená. Pinch na touchpadu v Linuxu není ověřený.
- Element, který po restore zmizí: chybí volba protokolu.
- `acl-l17-people` se nepodařilo reprodukovat. Hardening `webkit-asset-drop` není ověřený.
- Přejmenované obrázky (ne content-addressed) se při vložení mezi projekty nepřenesou.
- Figma: limity layoutu na úrovni instance.
- Edit-video: pocit z ovládání chce tvoje oko.
- Zaznamenané v2 gate records se po přechodu na podpis HMAC pod klíčem stroje čtou jako stale, dokud je někdo znovu nenahraje.
- Onboarding e2e: když se krok 1 sám přeskočí, kroky 2–5 se nepřeskočí (mezera v harnessu).

## Návrh release

**2.1.0** (D14). Obsahuje všechno výše.
- Hlavní body release notes:
  - plugin `design-video` (opt-in v terminálu);
  - loopback klíč a spend cap;
  - checklist v canvasu;
  - copy/paste mezi canvasy;
  - CLI používá servery desktopu;
  - Linux;
  - stills.
- Nutná poznámka: **aktualizuj CLI spolu s appkou**.
- Fleet, render ani Cloudflare/Stripe se bez tagu nemění. **Tag nedělám, je to tvoje rozhodnutí.**

## Moje chyba, kterou musíš vědět

Verifikátor perf sweepu při úklidu spustil `pkill -f chrom`. Shodil tím pomocné procesy `chrome_crashpad_handler` jiných Electron aplikací (Claude, Slack, 1Password). Claude je za minutu znovu spustil. Zkontroluj prosím, jestli Slack nebo 1Password o něco nepřišly. Pravidlo „zabíjet jen vlastní PID“ jsem do preamble pro buildery zdůraznil.

## Co od tebe potřebuju

1. OK (nebo ne) na tag `v2.1.0`, případně nejdřív rc.
2. Nechat okno Maude chvíli vpředu kvůli rerunu WebKit e2e (nebo mi dovolit ho na chvíli ovládat).
3. Případné zvrácení kteréhokoli z D1–D15.
