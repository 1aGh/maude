D5 final re-shoot harness (p8-c8-misc2), canvases 10 + 11 + 12.

= the newest committed harness per canvas, merged into one repo-relative directory:
  10: _c7c-harness-g4  (scenarios s10 s10cm s10c s10d s10e s10m s10k s10v; mkpairs table for 10 as in c7c)
  11/12: _c7-harness-g1112b  (round 7: s11c7 pn-move/pn-jump, s11dl pn-deeplink, s11ds7 one-system pn-ds, s12c7 keys/browse/tidy/inspector/steps/missing-gone)
  fx3.mjs / Matchday.tsx / LetakA6.tsx from _c7c-harness-g3 (the "alli" fixture s10v uses)

Changes against those (harness/fixture only, no product code):
- lib.mjs derives REPO from its own location (<repo>/.ai/plans/notes/v2-evidence/phase8-fidelity/_c8m2-harness-g4), so it runs from any checkout — the Mac mini slot included.
- No ImageMagick on the runner: fx.mjs photos + seed-home.ts cover pictures are made in Chromium (img.mjs, mkhomepics.mjs; seeded blob "plasma" and gradients in the same sizes). The
  photo fixtures therefore differ in look (not in size/name) from the stage-A `convert plasma:fractal` ones.
- The runner has no Playwright Chromium download; shoot with SHOT_CHANNEL=chrome (Google Chrome.app). chain scripts honour an exported SHOT_CHANNEL.
- fx3.mjs: cp -Rc (APFS clone) -> cpSync. s10v: fx3 import local. s11ds7 fixture: mkdesigncopy.mjs builds .scr/design-copy1 (maude-v2 system + ui/v2 + a one-system config) from the checkout.
- chain10.sh / chain1112.sh = the whole run per group; each starts with the release build of apps/studio and writes frames under .scr/impl/<NN-dir>/ (fetched back); pairs are built locally:
  `node .scr/mkpairs.mjs <NN-dir>` after copying this directory's lib/pair/mkpairs next to a populated .scr/impl and .scr/spec (REPO derives from the harness dir, so run it from the harness dir).
Needs ImageMagick (magick) for pair.mjs, local only. Never run a chain that waits on `pgrep -f run.mjs`.

D6 (p8-d6-g4): final re-shoot after stage C round 8, canvases 10 + 11 + 12.
= _c8m2-harness-g4 (11/12, and the strip / pn-move / pn-deeplink / ia-brand-steps round-8 scenarios) + the round-8 canvas-10 scenarios s10cm.mjs / s10d.mjs from _c8-harness-g4
  (co-comment-print: View > Print guides on; co-ask-edit: Viewing pressed, drag repeats until the tip shows). All paths renamed to _c10m-harness-g4.
chain1112.sh now also runs s11d (pn-switch-ai) in its default list, so chain11d.sh / chain-c8m2.sh are gone. Run: chain10.sh, then chain1112.sh (each release-builds first).
