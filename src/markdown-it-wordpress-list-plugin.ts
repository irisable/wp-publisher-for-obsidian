import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

interface ListItemContext {
  level: number;
  openParagraphIndex?: number;
  paragraphPairs: Array<{ open: number, close: number }>;
}

/** Remove paragraph wrappers only when a list item has one direct paragraph. */
export function normalizeListParagraphTokens(tokens: Token[]): void {
  const listItems: ListItemContext[] = [];

  tokens.forEach((token, index) => {
    if (token.type === 'list_item_open') {
      listItems.push({
        level: token.level,
        paragraphPairs: []
      });
      return;
    }

    const listItem = listItems[listItems.length - 1];
    if (!listItem) {
      return;
    }

    const directChildLevel = listItem.level + 1;
    if (token.type === 'paragraph_open' && token.level === directChildLevel) {
      listItem.openParagraphIndex = index;
      return;
    }

    if (token.type === 'paragraph_close'
      && token.level === directChildLevel
      && listItem.openParagraphIndex !== undefined
    ) {
      listItem.paragraphPairs.push({
        open: listItem.openParagraphIndex,
        close: index
      });
      delete listItem.openParagraphIndex;
      return;
    }

    if (token.type === 'list_item_close' && token.level === listItem.level) {
      if (listItem.paragraphPairs.length === 1) {
        const paragraph = listItem.paragraphPairs[0];
        tokens[paragraph.open].hidden = true;
        tokens[paragraph.close].hidden = true;
      }
      listItems.pop();
    }
  });
}

/** Keep WordPress themes from adding paragraph margins to simple list items. */
export function markdownItWordPressListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'wordpress_list_spacing', state => {
    normalizeListParagraphTokens(state.tokens);
  });
}
