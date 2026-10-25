// V2-8.5 c7 (08 ak-mixed-fit, 01 cf-frames-text): a Layers row for an element nobody named says what it SAYS —
// its words, a picture's alt or file — and only without words falls back to the plain word (Heading / Image / Frame).
import { describe, expect, test } from 'bun:test';
import { displayLayerName, fileWords, snippetOf } from '../layer-name.ts';

describe('snippetOf', () => {
  test('short words stay whole, whitespace collapses', () => {
    expect(snippetOf('  Calm   software ')).toBe('Calm software');
  });

  test('a long sentence is cut at a word and ends in an ellipsis', () => {
    const s = snippetOf('A small studio for product design and brand systems in Brno');
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(29);
    expect(s).toBe('A small studio for product…');
  });
});

describe('fileWords', () => {
  test('a file name reads as words', () => {
    expect(fileWords('./photos/hero_photo-2.JPG?v=3')).toBe('Hero photo 2');
    expect(fileWords('/_api/asset/Hr%C3%A1%C4%8D-foto.png')).toBe('Hráč foto');
  });

  test('a data: URI, a hash or a bare number says nothing', () => {
    expect(fileWords('data:image/png;base64,AAAA')).toBe('');
    expect(fileWords('/a/3f9c2b7e1d0a4c55.png')).toBe('');
    expect(fileWords('/a/1234.jpg')).toBe('');
    expect(fileWords(null)).toBe('');
  });
});

describe('displayLayerName', () => {
  test('a text says its words (01 cf-frames-text)', () => {
    expect(displayLayerName({ tag: 'H1', text: 'Calm software, made in Brno' })).toBe(
      'Calm software, made in Brno'
    );
    expect(displayLayerName({ tag: 'button', text: ' See the work ' })).toBe('See the work');
  });

  test('a picture says its alt, then its file; neither: Image (08 ak-mixed-fit)', () => {
    expect(displayLayerName({ tag: 'img', alt: 'Hype trailer still', src: 'x.png' })).toBe(
      'Hype trailer still'
    );
    expect(displayLayerName({ tag: 'img', alt: '', src: './assets/hype-trailer.jpg' })).toBe(
      'Hype trailer'
    );
    expect(displayLayerName({ tag: 'img', src: 'data:image/png;base64,AA' })).toBe('Image');
  });

  test('a Frame is never named after what it holds; words-less text keeps the plain word', () => {
    expect(displayLayerName({ tag: 'div', text: 'Hype trailer · 16:9' })).toBe('Frame');
    expect(displayLayerName({ tag: 'h2', text: '   ' })).toBe('Heading');
    expect(displayLayerName({ tag: 'div', role: 'button', text: 'Go' })).toBe('Button');
  });
});
