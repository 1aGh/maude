// usage: node mont.mjs <dir> <regex> <stride> <tile> <geometry> [max]  → ../contact.png
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const [dir, re, stride = '1', tile = '4', geom = '400x250', max = '24'] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => new RegExp(re).test(f)).sort().filter((_, i) => i % Number(stride) === 0).slice(0, Number(max));
execFileSync('magick', ['montage', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-label', '%t', ...files.map((f) => join(dir, f)), '-tile', `${tile}x`, '-geometry', `${geom}+2+2`, join(import.meta.dirname, '../contact.png')]);
console.log(files.join(' '));
