// Controls an EARLIER shard of the same sweep found DEAD (or erroring) and that were fixed fail-first afterwards. The
// shard's JSON still says DEAD, because it ran before the fix; the report lists such a row as `fixed since` with the
// commit and the test that pins it, instead of hiding it or counting it as open. A row only matches while its surface
// AND control match, so a NEW dead control of the same name elsewhere is still DEAD.
export const FIXED_SINCE = [
  {
    control: /^edit-align-(top|vmiddle|bottom)$/,
    commit: 'a36ae02e3',
    what: 'Align top / middles / bottom over artboards that already share the edge now say "Already aligned."',
    test: 'apps/studio/test/artboard-arrange-client.test.tsx › boards already level: Align top says so and commits nothing',
  },
  {
    control: /^(Zoom out|timeline-zoom-fit)$/,
    surface: /timeline-size/,
    commit: 'd6211455a',
    what: 'the timeline’s Zoom out and Fit are greyed with “The whole video already fits” while the video fits',
    test: 'apps/studio/test/p8-timeline-v2-body.test.tsx › at Fit, Zoom out and Fit are greyed with the reason',
  },
  {
    control: 'settings-reset-folds-btn',
    commit: 'd6211455a',
    what: 'Settings › Advanced › Close all Advanced sections answers its click (the button says Closed)',
    test: 'apps/studio/test/v2-s11-13-advanced.test.tsx › Close all Advanced sections answers its click',
  },
];

const hit = (pat, s) => (pat instanceof RegExp ? pat.test(s) : pat === s);

/** The fix that covers this DEAD row, or undefined. */
export function fixedSince(row) {
  return FIXED_SINCE.find(
    (f) =>
      hit(f.control, String(row.control ?? '')) &&
      (!f.surface || hit(f.surface, String(row.surface ?? '')))
  );
}
