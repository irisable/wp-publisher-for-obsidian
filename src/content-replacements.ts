export interface TextReplacement {
  original: string;
  replacement: string;
}

/** Apply successful media replacements without rebuilding the note around them. */
export function applyTextReplacements(
  content: string,
  replacements: readonly TextReplacement[]
): string {
  return replacements.reduce(
    (updated, item) => updated.replace(item.original, item.replacement),
    content
  );
}
