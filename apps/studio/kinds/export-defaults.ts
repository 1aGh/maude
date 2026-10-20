// apps/studio/kinds/export-defaults.ts — S7.21: the default Export preset each artboard kind offers (08: the
// inspector's "Export" button reads "PNG · 1×" on a fixed size or a web page, "Print PDF" on paper, "MP4" on a video;
// two kinds at once read "2 files…").
//
// S7 places no export button of its own (S8 owns the Export section, C21): a kind's inspector body passes through
// `exportDefaults(kind)` and the section draws it. One table, so the words of the Export section's placeholder
// (`export-slot.jsx`), the S8 chip and a test cannot drift. Pure data: no IO, no React.
//
// decision:maude/v2-S7.21-export-defaults-one-table

export type ExportKind = 'digital' | 'web' | 'print' | 'video';

export interface ExportDefault {
  /** The button's words. */
  word: string;
  /** The exporter format the word stands for. */
  format: 'png' | 'pdf' | 'mp4';
  /** png only: the scale the word says. */
  scale?: number;
}

const png1: ExportDefault = Object.freeze({ word: 'PNG · 1×', format: 'png', scale: 1 });

const TABLE: Readonly<Record<ExportKind, ExportDefault>> = Object.freeze({
  digital: png1,
  web: png1,
  print: Object.freeze({ word: 'Print PDF', format: 'pdf' }) as ExportDefault,
  video: Object.freeze({ word: 'MP4', format: 'mp4' }) as ExportDefault,
});

/** The kind an unknown or absent `data-dc-kind` stands for: `digital`, the implicit one. */
export const kindOrDefault = (kind: unknown): ExportKind =>
  typeof kind === 'string' && Object.hasOwn(TABLE, kind) ? (kind as ExportKind) : 'digital';

/** The default preset of one artboard kind. */
export const exportDefaults = (kind: unknown): ExportDefault => TABLE[kindOrDefault(kind)];

/** What the Export row says for the artboards selected: one kind's word, or "N files…" for several boards. */
export function exportWords(kinds: readonly unknown[]): string {
  if (kinds.length > 1) return `${kinds.length} files…`;
  return exportDefaults(kinds[0]).word;
}
