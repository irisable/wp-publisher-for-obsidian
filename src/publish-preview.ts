export interface WordPressBlockStats {
  blockCount: number;
  customHtmlCount: number;
}

/** Summarize serialized Gutenberg comments without parsing the rendered HTML. */
export function getWordPressBlockStats(content: string): WordPressBlockStats {
  const blockNames = Array.from(
    content.matchAll(/<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s|-->)/gi),
    match => match[1].toLowerCase()
  );
  return {
    blockCount: blockNames.length,
    customHtmlCount: blockNames.filter(name => name === 'html').length
  };
}
