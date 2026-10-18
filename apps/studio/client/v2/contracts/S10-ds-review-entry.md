# S10 → S2 / S8 / S1 / S5 / S6: entries into the DS review

Frozen by S10.0 from `S10-slices.md` §2.2 (verbatim below). This is the file S2.12 / S2.17, S8's brand import, S1's
Trash / Version history, S5's AI-run origins and S6's Home door code against.

**Pending ids (S10.0):** `ds.review-update`, `ds.go-to` and `ds.instance-update` are on `PENDING_MENU_IDS`
(`client/v2/shell/project-menu-model.js`) with their owning S10 task, pinned by `test/project-menu-model.test.ts`.
They are NOT in the action registry yet, so `actions.parity.json` `pendingMax` stays 0 (the agent-path ratchet
counts registered actions only). Rows that depend on them render **hidden** until the id is registered; the day S10
registers one it must leave `PENDING_MENU_IDS` (the test goes red until it does). `ds.make` is registered by
S10.13 and is not on the list.

S10.0 freezes this section verbatim as `apps/studio/client/v2/contracts/S10-ds-review-entry.md` and registers the
ids below as **pending** (so S2.12 / S2.17 can render their rows hidden and pin them with a test, per S2 Q13).

| Entry | Registry id / route | Params | Effect | Caller |
| --- | --- | --- | --- | --- |
| Push an override into the system | `ds.review-update` | `{ canvas, elementId, target: { kind: 'typeRole', role } \| { kind: 'component', name, variant? } }` | Turns the element's overrides into `dsPending` entries (`tokens` for a type role, `components[name][selector][prop]` for a master), then opens "Update N canvases" with the change listed. Pending until S10.8 lands: the row is hidden | S2.12 "Update <Heading> for every canvas…", S2.17 |
| Go to the master / token | `ds.go-to` | `{ ds?, section?: 'brand'\|'colour'\|'type'\|'space'\|'motion'\|'components'\|'patterns', token?: '--name', component?: 'Button' }` | Opens `<ds.path>/design-system.tsx` (or the v1 view if unconverted), focuses artboard `ds-<section>`, and selects `[data-ds-token="--name"]` or `[data-ds-master="Button"]` | S2.17 "Go to main component", the inspector "Uses <name>" link, ⌘K token hits |
| Update-available block (10) | inspector slot `updateAvailable` (S2 instance kind renders `<DsUpdateAvailable canvas elementId/>` from `client/v2/ds/update-available.jsx`) | — | Shows "Update available" + the diff line + **Update** (`ds.instance-update`) + **Detach** (S2's `component.detach`) | S2.17 mounts, S10.8 provides |
| Propose tokens from an import | `POST /_api/ds/pending` | `{ ds, tokens: {"--name": {light, dark?, valueNames?, add?}}, components?, by: {kind:'import', name} }` | Converted system: merged into `dsPending` ("N changes waiting"). Unconverted: 409 `ds-not-converted` (S8 keeps today's `import-brand` file write) | S8 brand import |
| Instance placed on a left-out canvas | — | — | ⇧I adds `data-ds-rev="head"` when `meta.dsRev` is set (V2-1.6 §5.8). S10 exports `dsRevForPlacement(meta)` from `client/v2/ds/pins.js` | S2.16 |
| Token tombstones in Trash | `GET /_api/ds/state` → `trashed[]` `{kind:'token', system, css, label, replacement, at, by}` | — | S1's Trash index lists them; **Restore** = `ds.restore-token` | S1 (Trash) |
| Version history labels | `head.json` `log[].summary` + `actionId` | — | S1 shows `summary` for DS actions | S1 |
| AI runs | `askAI(text, { send: true, origin })`, `origin` += `'ds-make' \| 'ds-upgrade' \| 'ds-restyle' \| 'ds-review'` | — | The run is the person's gesture; it goes through every composer gate | S5 (composer) |
| Home starter / empty row door | `ds.make` | `{ project? }` | Opens the three-input sheet (13) | S6 Home starters, S10.13 empty row |
