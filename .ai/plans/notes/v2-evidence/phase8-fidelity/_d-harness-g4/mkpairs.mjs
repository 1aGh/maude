// usage: node mkpairs.mjs <dir> [id,id...]   — builds pairs for every id in table[dir] that has an impl image for the theme
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { pair } from './pair.mjs';

const WIN = '1440x860+1+41'; // the window body of a Stage artboard (below the native tab strip, above the note)
const TOP = '1440x40+1+1'; // the native tab strip row of a Stage artboard
// id -> { spec: crop of the spec | WIN, impl: crop of the impl | undefined, label?, implFile?: base name of the impl image }
export const table = {
  '10-share-and-collaboration': {
    'co-share-sheet': { spec: WIN },
    'co-share-roles': { spec: '440x560+150+135', impl: '450x540+985+55' },
    'co-browser-view': { spec: WIN },
    'co-presence': { spec: WIN },
    'co-comment-thread': { spec: WIN },
    'co-comment-video': { spec: WIN },
    'co-comment-print': { spec: WIN },
    'co-sync-offline': { spec: WIN },
    'co-sync-back': { spec: WIN },
    'co-conflict': { spec: WIN },
    'co-trashed': { spec: WIN },
    'co-local-cloud': { spec: '390x290+60+95', impl: '470x230+960+50' },
    'co-ask-edit': { spec: '740x520+100+100', implFile: 'co-ask-edit-tip' },
    'co-access-ends': { spec: '430x400+505+120', impl: '900x620+270+240' },
    'co-share-advanced': { spec: '430x790+70+160', impl: '470x760+960+50' },
  },
  '11-projects-and-navigation': {
    'pn-tab-b': { spec: TOP, implFile: 'strip-b' },
    'pn-tab-b20': { spec: TOP, implFile: 'strip-b20' },
    'pn-switch-ai': { spec: WIN, implFile: 'pn-switch-ai-keys' },
    'pn-switch-ai-strip': { spec: TOP, specFile: 'pn-switch-ai', implFile: 'strip-ai' },
    'pn-relaunch': { spec: WIN },
    'pn-relaunch-strip': { spec: TOP, specFile: 'pn-relaunch', implFile: 'strip-relaunch' },
    'pn-home': { spec: WIN },
    'pn-home-search': { spec: WIN },
    'pn-ds': { spec: '270x430+30+160', impl: '260x560+15+60' },
    'pn-ds-search': { specFile: 'pn-ds', spec: '560x280+365+160', impl: '640x400+400+100' },
    'pn-organise': { spec: WIN },
    'pn-move': { spec: WIN },
    'pn-trash': { spec: WIN },
    'pn-jump': { spec: WIN },
    'pn-k-across': { spec: WIN },
    'pn-k-close': { spec: '600x380+735+115', impl: '640x400+400+90' },
    'pn-history': { spec: WIN },
    'pn-compare': { spec: WIN },
    'pn-deeplink': { spec: WIN },
  },
  '12-import-and-assets': {
    'ia-drop-photos': { spec: WIN },
    'ia-placed': { spec: WIN },
    'ia-assets-panel': { spec: WIN },
    'ia-assets-keys': { spec: WIN },
    'ia-assets-browse': { spec: WIN },
    'ia-assets-find': { spec: '225x470+30+100', impl: '240x600+12+65' },
    'ia-assets-tidy': { spec: '340x660+413+148', impl: '240x700+12+65' },
    'ia-asset-details': { spec: '320x620+49+165', impl: '240x780+15+65' },
    'ia-photo-inspector': { spec: WIN },
    'ia-photo-steps': { spec: '320x520+49+130', impl: '310x790+1130+65' },
    'ia-gen-ask': { spec: WIN },
    'ia-figma-sheets': { spec: '380x290+625+125', impl: '540x300+450+290' },
    'ia-figma-sheets-connect': { specFile: 'ia-figma-sheets', spec: '380x330+625+420', impl: '460x260+490+300' },
    'ia-brand-steps': { spec: '440x330+45+125', impl: '510x270+465+300' },
    'ia-brand-steps-1': { specFile: 'ia-brand-steps', spec: '440x330+45+125', impl: '510x270+465+300' },
    'ia-brand-steps-2': { specFile: 'ia-brand-steps', spec: '440x240+500+125', impl: '510x270+465+300' },
    'ia-brand-steps-3': { specFile: 'ia-brand-steps', spec: '440x260+955+125', impl: '510x200+465+340' },
    'ia-missing-gone': { spec: WIN },
    'ia-advanced': { spec: '430x540+49+148', impl: '240x780+15+65' },
  },
};

if (process.argv[1].endsWith('mkpairs.mjs')) {
  const [dir, only] = process.argv.slice(2);
  const ids = only ? only.split(',') : Object.keys(table[dir]);
  for (const id of ids) {
    const e = table[dir][id];
    if (!e) { console.log('no table row', id); continue; }
    for (const theme of ['dark', 'light']) {
      const implPath = join(REPO, '.scr/impl', dir, `${e.implFile || id}-${theme}.png`);
      const specPath = e.specFile ? join(REPO, '.scr/spec', dir, `${e.specFile}-${theme}.png`) : undefined;
      if (!existsSync(implPath)) { console.log('no impl', id, theme); continue; }
      try {
        pair(dir, id, theme, { specCrop: e.spec, implCrop: e.impl, label: e.label || '', implPath, specPath });
        console.log('pair', id, theme);
      } catch (err) { console.log('FAIL', id, theme, String(err.message).split('\n')[0]); }
    }
  }
}
