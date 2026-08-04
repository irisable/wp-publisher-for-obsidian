import type MarkdownIt from 'markdown-it';

/** Avoid Gutenberg preserving markdown-it's formatting newline as text. */
export function markdownItWordPressBreakPlugin(md: MarkdownIt): void {
  md.renderer.rules.hardbreak = (_tokens, _idx, options) => {
    return options.xhtmlOut ? '<br />' : '<br>';
  };
}
