export interface TextReplacement {
  startIndex: number;
  endIndex: number;
  replacement: string;
}

/** Apply disjoint replacements ordered by their original positions. */
export function applyTextReplacements(
  content: string,
  replacements: readonly TextReplacement[]
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of replacements) {
    parts.push(content.slice(cursor, edit.startIndex), edit.replacement);
    cursor = edit.endIndex;
  }
  parts.push(content.slice(cursor));
  return parts.join('');
}
