# r4 — Michal's findings on READY TO TRY (12) (2026-11-01)

Source: Michal via the keeper, screenshots `76c768b0…/images/25.png … 44.png`. Every item is closed only when it is
seen working in the **release `.app`** (not only a unit test); the "verified" column says how.

Order (keeper, Michal): builders in parallel → quality (figga / mini) → `.app` to Michal **before** chain4 → his
findings → chain4 + re-attests. Budget: the week is at 79 % (cap 85 %, checkpoint at 82 %); what does not fit continues
after the reset on 2026-11-06 09:00.

Status: `open` · `building` · `merged` · `verified-app` · `needs-decision` · `after-reset`.

| # | Michal (verbatim) | triage | status | commit | verified in the release .app |
| --- | --- | --- | --- | --- | --- |
| 1 | "video v canvasu neni jak prehrat" | bug: the r3 `<video controls>` placed on an artboard has no way to play it in Edit (the canvas takes the click); give it a play affordance (Space plays the selected video as on a video artboard; Preview / Present play it) | in the .app d93355276 — for Michal (D) | cf9996b11
| 2 | "drag and drop z finder ani z assets porad nefunguje. Nefunguje ani ve view mode abych mohl neco pridat do canvasu jako annotation" | bug, **third time**. r3's WKWebView probe was green, the release app is not: reproduce in the release `.app` first (Finder → canvas, Assets → artboard, Edit and Preview), find what the probe does not reproduce (tab webviews already `disable_drag_drop_handler()`), then a guard that drives a real OS drag into the packaged app | in the .app d93355276 — for Michal (A) | cd8860ab7 8eae46bae
| 3 | "v inspectoru tahnuti uz funguje ale oznacuju zaroven i texty" | bug: scrub drag selects text → `user-select: none` + `preventDefault` on pointerdown for the drag | in the .app d93355276 — for Michal (D) | 1690909ff
| 4 | "color picker bych udelal jak ma Figma, at tam jsou tabs jednotlivych backgrounds" | design: tabs per paint kind (Solid · Gradient · Image · Video, + Custom / Libraries = Variables) — **decided** (kg `v2-michal-r4-color-picker-figma`, "ano udelej to stejne jako ve figme"): exactly Figma's — Solid · Gradient · Pattern · Image · Video (Shader only if it makes sense), Custom / Libraries (= DS tokens), hue + alpha, eyedropper, Hex + %, On this page, gradient stops; no mock first | in the .app d93355276 — for Michal (F) | c2d0f7e59 d870138bd
| 5 | "zoomovani na canvasu treba v desitgn system maude-v2 je extreme sekany, panning ujde ale ten zoom je fakt hroznej" | perf bug on a real large canvas (the DS canvas): measure zoom on THAT canvas (perf.sh on `.design/system/maude-v2`), find the cost (likely the r3 DS row re-flow or label rules re-running per zoom step). **Confirmed by the gate:** the Chromium LOD lane at fa52b24c6 is p95 83 vs 34 ms (64 artboards, < 25 %), PASS at 08b35c8db → r3 regression, suspect 4ab29ab09 | merged (K) — not in .app 13; cause: the per-frame --dc-zoom variable inherited into every design (WebKit restyled every artboard each zoom frame, 90–240 ms); reset on .dc-artboard-body → 18 ms incl. the first zoom | 317cc80ef
| 6 | "light/dark na design systemu prepne jen ty uvodni artboardy zbytek necha v light. … tlacitko dark/light … i na normalnich canvases … vyhodili pryc uplne to follow chrome a DS default z advanced" | bug + design (decided): the DS toggle must switch every artboard; a global Light/Dark switch on every canvas; drop "Follow chrome" / "DS default" from Advanced; the DS sets the default — **decided** (kg `v2-michal-r4-global-light-dark`, "nahore na stejnem miste jako to ma design system"): the same floating pill at the top of every canvas | in the .app d93355276 — for Michal (G) | b43113f7d 3e7568a65 3ef57da30
| 7 | "design system view skrz cmd+k … empty state … tlacitko create design system a to otevre ai chat" | gap: empty state gets "Create a design system" → opens the AI chat with the setup-ds prompt | in the .app d93355276 — for Michal (B) | 310472fbf
| 8 | "v alligators jsem se chtel prihlasit ale vsechny pole jsou disabled a i ty placeholders se prekryvaji s ikonami v inputech" | bug: hub sign-in form fields disabled + placeholder under the leading icon | in the .app d93355276 — for Michal (C) | c4e1f5585
| 9 | "sign in with maude cloud … vyskocil kod ale maude desktop zadny code neukazuje … at se udela automaticky redirect a nebo at se teda ten kod pro overeni nekam zada" | design + security: the device-flow code is the anti-phishing check — options (show the code in the app to match, or a loopback redirect that needs no code) go to Michal via the keeper — **decided (a)** (kg `v2-michal-r4-cloud-signin-show-code`): Maude shows the same code in the app; the device flow stays | in the .app d93355276 — for Michal (C) | 99b37ffa4
| 10 | "nechal jsem si vytvorit design system Ale vytvoril se staticky page … Proc se to neudelalo rovnou? … kdyz ho teda pervedu na canvas, tak se nic nestane, musim kliknout na jiny canvas a zpatky" | bug: the AI chat's setup-ds made a v1 static DS page → check which plugin copy the ACP session loads (DDR-168 bundled) and that setup-ds writes the v2 DS canvas directly; Convert must refresh the open view | in the .app d93355276 — for Michal (B) | 1e57e42e0 e412f8c9f
| 11 | "u convert to scheme, by mohlo byt lepe vysvetlene proc … cela stranka se lockne, ai sice pracuje, ale ja nic nemuzu, jen cancel" | copy + bug: say why the schema matters; the AI conversion must not lock the whole page (lock only the DS being converted) | in the .app d93355276 — for Michal (B) | 310472fbf
| 12 | "more menu v levem menu se otevre ale cekal bych ze se zavre kdyz kliknu mimo, muzu ho zavrit jen pomoci esc" | bug: outside click closes it | in the .app d93355276 — for Michal (D) | f0c9a1bdd
| 13 | "copy link canvasu zkopiruje jen deeplink … pokud je canvas pripojeny na cloud mel by se vzdy zkopirovat spit https odkaz" | design-light: a cloud-linked canvas copies its https share link (the page offers "Open in Maude" / browser); a local one keeps the deep link | in the .app d93355276 — for Michal (I) | see r4/link-image merge
| 14 | "ve view mode esc switchne na edit mode kdyz nemam nic vybraneho" | bug: Esc with nothing selected must not leave Preview (the esc ladder's last step) | in the .app d93355276 — for Michal (D) | e6070a28f
| 15 | "stamp v annotations se neda nijak smazat ani presunout" | bug: a stamp can be selected, moved and deleted like a sticker | in the .app d93355276 — for Michal (H) | f559084cb
| 16 | "kdyz chci pridat sticker tak taham pod mysi jen prazdny thumbnail … az po … par vterinach objevy realny obrazek" | bug: preload the sticker image when picked; the drag image is the real sticker | in the .app d93355276 — for Michal (H) | 6c439d8fc
| 17 | "kdyz pridavam blank section cekal bych ze muzu udelat drag … a hned po vlozeni sekce bych prepl automaticky zpatky na cursor/select" | gap: Section tool draws by drag (click = default size) and returns to Select | in the .app d93355276 — for Michal (H) | 2f4ca5a81
| 18 | "kdyz vytvorim novy objekt v section tak se potom hybe spolu se seciton ale kdyz tam pretahnu nejaky uz vytvoreny objekt, tak se nehybe" | bug: dropping an existing object into a section re-parents it into the section | in the .app d93355276 — for Michal (H) | 085be89ba
| 44 | (screenshot 44) a broken image "?" in the Ahoj2 canvas | bug, to look at: which element, why the picture does not load | in the .app d93355276 — for Michal (I) — not reproduced; guard: retry then "Picture not found" + path | see r4/link-image merge

## r5 — Michal's findings on READY TO TRY (13) (2026-11-02)

Screenshots `32b76e01…/images/45.png … 48.png`. After r5: quality → a short check of each item in the release .app → the FINAL chain4 + all re-attests + the final .app + PR.md (Michal: "Pak at uz lead udela finalni e2e testy"). #5 (zoom) is already in feat (317cc80ef) and ships with r5.

| # | Michal (verbatim) | triage | status | commit | verified in the release .app |
| --- | --- | --- | --- | --- | --- |
| r5-1 | "video nejde pretahnout z finder ani z assets drag and drop. A neni jak vlozit video do preview mode (annotations). Respektive ono se tam pretahne ale potom je to takhle rozbite a kdyz chci odzoomovat tak se video zobrazi pres celou obrazovku" | bug: a video (Finder or Assets tile) must drop like a picture in Edit (r3 video place) and in Preview as an annotation VIDEO (not an `<img>` → "Picture not found"); the zoom-out blow-up of the box | merged (L) — Assets video tiles drag; Preview drop is an annotation video; a failed clip says Video not found inside its own box (no blow-up); why Michal's .mov failed is not confirmed | 833516f57
| r5-2 | "video lze prehrat jen v presentation mode" | bug: a placed video plays on the canvas in Edit (Space / a play control) and in Preview (its controls) | merged (L) — a play button on a placed video in Edit and Preview | 1cd9a33a3
| r5-3 | "v color picker libraries bych nedaval ty taby (color, gradient, image) a udelal bych to jako list radky z nazvy … ne takhle jako galerie" | design: Libraries = a list of rows (swatch + token name), grouped, no paint-kind tabs inside it | merged (M) | 528c28b0a
| r5-4 | "prepninani mezi taby v color picker nekdy samo zavre popoup kartu" | bug: switching tabs sometimes closes the popover | merged (M) | 528c28b0a
| r5-5 | "v gradient picker nejde tahat s temi kulickami ve vyberu pomeru gradientu" | bug: gradient stops cannot be dragged | merged (M) | 528c28b0a
| r5-6 | "v color picker image, mam moznost jen vybrat z pocitace nebo pridat link, ale nemam vubec moznost vybrat z mych assets" | gap: the Image tab picks from the project's Assets too | merged (M) | 528c28b0a
| r5-7 | "dark/light mode mi nejak v canvases nefunguje treba tenhle maude '02 onboarding'" | bug: the global Light/Dark pill does not switch `.design/ui/v2/02 Onboarding.tsx` (find why: hardcoded colours, its own theme attr, no DS link) | merged (N) — engine selector bug, every kit canvas should switch; boards authored theme="dark" now follow the pill (r4-G) | a04f8e0b1
| r5-8 | "chybi mi tam file path nekde, klidne bych ho dal na ten pill kde je light/dark prepinac a taky do more menu v listu canvases jako 'copy relative path'" | gap: the canvas path on the Light|Dark pill (click copies it) + "Copy relative path" in a Canvases row's ⋯ menu | merged (N) | a04f8e0b1

## Final state (2026-11-02, product 71ec8ec75)

Every r4 row (1–18, img 44) and every r5 row (r5-1 … r5-8) is merged and is in the **final release `.app` built at
71ec8ec75** (`.claude/worktrees/freeze/apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`, 2.0.0-rc.1,
`MAUDE_NO_AUTO_UPDATE=1`). What has checked them since:

- **The desktop e2e lanes, green 3× at 71ec8ec75 (V2-8.3).** They drive the real debug app: the drop guard, scrub,
  menus closing on an outside click, Esc in Preview, the picker (edit-shapes), the theme pill, the name dialog,
  stamps and stickers, section adopt.
- **`check-real-drop`**, the OS drag into the packaged app. It moves the mouse, so it ran under Michal's "muzes".
- **The a11y matrix (V2-8.7, 318/318 states) and perf (V2-8.8 / 8.14; #5 zoom: WebKit p95 21 ms).**
- **Not yet:** Michal's own look in the final `.app`. The "for Michal" rows above are his to confirm; anything he
  finds becomes an rc follow-up.
