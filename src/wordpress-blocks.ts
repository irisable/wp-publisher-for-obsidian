import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { legacyImageParagraphSource } from './legacy-image-syntax';
import { splitProtectedWordPressSources } from './wordpress-block-parser';

export const WordPressContentFormat = {
  BlockEditor: 'block-editor',
  ClassicHtml: 'classic-html'
} as const;

export type WordPressContentFormat = typeof WordPressContentFormat[keyof typeof WordPressContentFormat];

export interface WordPressImageCaption {
  title?: string;
  caption: string;
}

export interface WordPressRenderOptions {
  imageCaptions?: Readonly<Record<string, WordPressImageCaption>>;
}

interface RenderContext {
  markdown: MarkdownIt;
  tokens: Token[];
  env: Record<string, unknown>;
  options: WordPressRenderOptions;
}

const LIST_OPEN_TYPES = new Set([ 'bullet_list_open', 'ordered_list_open' ]);
const IMAGE_TYPES = new Set([ 'image', 'ob_img' ]);
const UNSAFE_LIST_BLOCK_TYPES = new Set([
  'blockquote_open',
  'code_block',
  'fence',
  'html_block',
  'math_block',
  'table_open'
]);

function serializeAttributes(attributes?: Record<string, unknown>): string {
  return attributes && Object.keys(attributes).length > 0
    ? ' ' + JSON.stringify(attributes)
    : '';
}

function wrapBlock(
  name: string,
  html: string,
  attributes?: Record<string, unknown>
): string {
  const content = html.trim();
  return `<!-- wp:${name}${serializeAttributes(attributes)} -->
${content}
<!-- /wp:${name} -->`;
}

function renderRange(context: RenderContext, start: number, end: number): string {
  return context.markdown.renderer.render(
    context.tokens.slice(start, end),
    context.markdown.options,
    context.env
  ).trim();
}

function findClosingToken(tokens: Token[], start: number): number {
  let nesting = 0;
  for (let index = start; index < tokens.length; index += 1) {
    nesting += tokens[index].nesting;
    if (nesting === 0) {
      return index;
    }
  }
  return tokens.length - 1;
}

function isSerializedWordPressPost(content: string): boolean {
  return /^<!--\s+wp:[a-z0-9-]+(?:\/[a-z0-9-]+)?(?:\s+\{[^\n]*})?\s+(?:-->|\/-->)/i
    .test(content.trim());
}

function renderCustomHtml(html: string): string {
  const content = html.trim();
  return content ? wrapBlock('html', content) : '';
}

function meaningfulInlineTokens(tokens: Token[]): Token[] {
  return tokens.filter(token => {
    return token.type !== 'text' || token.content.trim().length > 0;
  });
}

function findStandaloneImage(tokens: Token[]): Token | undefined {
  const meaningful = meaningfulInlineTokens(tokens);
  if (meaningful.length === 1 && IMAGE_TYPES.has(meaningful[0].type)) {
    return meaningful[0];
  }
  if (meaningful.length === 3
    && meaningful[0].type === 'link_open'
    && IMAGE_TYPES.has(meaningful[1].type)
    && meaningful[2].type === 'link_close'
  ) {
    return meaningful[1];
  }
  return undefined;
}

function hasUnsafeInlineContent(token: Token | undefined): boolean {
  return token?.children?.some(child => {
    return IMAGE_TYPES.has(child.type)
      || child.type === 'html_inline'
      || child.type === 'math_inline';
  }) ?? false;
}

function renderImageBlock(
  context: RenderContext,
  source: string,
  imageHtml: string,
  hasDimensions: boolean
): string {
  const imageCaption = context.options.imageCaptions?.[source];
  const titleHtml = imageCaption?.title
    ? '<strong>' + context.markdown.utils.escapeHtml(imageCaption.title) + '</strong><br>'
    : '';
  const captionHtml = imageCaption
    ? '<figcaption class="wp-element-caption">'
      + titleHtml
      + context.markdown.utils.escapeHtml(imageCaption.caption)
      + '</figcaption>'
    : '';
  const figureHtml = '<figure class="wp-block-image">'
    + imageHtml
    + captionHtml
    + '</figure>';
  return hasDimensions
    ? renderCustomHtml(figureHtml)
    : wrapBlock('image', figureHtml);
}

function renderParagraph(
  context: RenderContext,
  start: number,
  end: number
): string {
  const inline = context.tokens.slice(start + 1, end).find(token => token.type === 'inline');
  const children = inline?.children ?? [];
  const image = findStandaloneImage(children);
  if (image) {
    const imageHtml = context.markdown.renderer.renderInline(
      children,
      context.markdown.options,
      context.env
    );
    return renderImageBlock(
      context,
      image.attrGet('src') ?? '',
      imageHtml,
      Boolean(image.attrGet('width') || image.attrGet('height'))
    );
  }

  const legacySource = legacyImageParagraphSource(inline?.content ?? '');
  if (legacySource) {
    const imageHtml = '<img src="'
      + context.markdown.utils.escapeHtml(legacySource)
      + '" alt="">';
    return renderImageBlock(context, legacySource, imageHtml, false);
  }

  const html = renderRange(context, start, end + 1);
  return hasUnsafeInlineContent(inline)
    ? renderCustomHtml(html)
    : wrapBlock('paragraph', html);
}

function renderHeading(
  context: RenderContext,
  start: number,
  end: number
): string {
  const token = context.tokens[start];
  const inline = context.tokens.slice(start + 1, end).find(item => item.type === 'inline');
  const renderedHtml = renderRange(context, start, end + 1);
  if (hasUnsafeInlineContent(inline)) {
    return renderCustomHtml(renderedHtml);
  }
  const level = Number(token.tag.slice(1));
  const html = Number.isInteger(level)
    ? renderedHtml.replace(
      `<h${level}>`,
      `<h${level} class="wp-block-heading">`
    )
    : renderedHtml;
  return wrapBlock('heading', html, Number.isInteger(level) ? { level } : undefined);
}

function isNativeListSafe(tokens: Token[], start: number, end: number): boolean {
  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];
    if (token.type === 'paragraph_open' && !token.hidden) {
      return false;
    }
    if (UNSAFE_LIST_BLOCK_TYPES.has(token.type)) {
      return false;
    }
    if (token.type === 'inline' && hasUnsafeInlineContent(token)) {
      return false;
    }
  }
  return true;
}

function renderListItem(
  context: RenderContext,
  start: number,
  end: number
): string {
  const openLevel = context.tokens[start].level;
  const parts: string[] = [];
  let rangeStart = start + 1;
  let index = rangeStart;

  const flushRange = (rangeEnd: number): void => {
    if (rangeEnd <= rangeStart) {
      return;
    }
    const html = renderRange(context, rangeStart, rangeEnd);
    if (html) {
      parts.push(html);
    }
  };

  while (index < end) {
    const token = context.tokens[index];
    if (LIST_OPEN_TYPES.has(token.type) && token.level === openLevel + 1) {
      flushRange(index);
      const listEnd = findClosingToken(context.tokens, index);
      parts.push(renderList(context, index, listEnd));
      index = listEnd + 1;
      rangeStart = index;
      continue;
    }
    index += 1;
  }
  flushRange(end);

  return wrapBlock('list-item', `<li>${parts.join('\n')}</li>`);
}

function renderList(
  context: RenderContext,
  start: number,
  end: number
): string {
  if (!isNativeListSafe(context.tokens, start, end)) {
    return renderCustomHtml(renderRange(context, start, end + 1));
  }

  const open = context.tokens[start];
  const ordered = open.type === 'ordered_list_open';
  const startValue = Number(open.attrGet('start'));
  const attributes: Record<string, unknown> = {};
  if (ordered) {
    attributes.ordered = true;
  }
  if (ordered && Number.isSafeInteger(startValue) && startValue > 1) {
    attributes.start = startValue;
  }

  const items: string[] = [];
  let index = start + 1;
  while (index < end) {
    const token = context.tokens[index];
    if (token.type === 'list_item_open' && token.level === open.level + 1) {
      const itemEnd = findClosingToken(context.tokens, index);
      items.push(renderListItem(context, index, itemEnd));
      index = itemEnd + 1;
      continue;
    }
    index += 1;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttribute = attributes.start ? ` start="${attributes.start}"` : '';
  const html = `<${tag} class="wp-block-list"${startAttribute}>
${items.join('\n')}
</${tag}>`;
  return wrapBlock('list', html, attributes);
}

function renderQuote(
  context: RenderContext,
  start: number,
  end: number
): string {
  const innerBlocks = renderBlocksAtLevel(
    context,
    start + 1,
    end,
    context.tokens[start].level + 1
  );
  const html = [
    '<blockquote class="wp-block-quote">',
    ...innerBlocks,
    '</blockquote>'
  ].join('\n');
  return wrapBlock('quote', html);
}

function renderTable(
  context: RenderContext,
  start: number,
  end: number
): string {
  const table = renderRange(context, start, end + 1);
  return wrapBlock(
    'table',
    `<figure class="wp-block-table">${table}</figure>`,
    { hasFixedLayout: false }
  );
}

function renderCode(context: RenderContext, index: number): string {
  const content = context.markdown.utils.escapeHtml(context.tokens[index].content);
  return wrapBlock('code', `<pre class="wp-block-code"><code>${content}</code></pre>`);
}

function renderTopLevelRange(
  context: RenderContext,
  start: number,
  end: number
): string {
  switch (context.tokens[start].type) {
    case 'paragraph_open':
      return renderParagraph(context, start, end);
    case 'heading_open':
      return renderHeading(context, start, end);
    case 'bullet_list_open':
    case 'ordered_list_open':
      return renderList(context, start, end);
    case 'blockquote_open':
      return renderQuote(context, start, end);
    case 'table_open':
      return renderTable(context, start, end);
    default:
      return renderCustomHtml(renderRange(context, start, end + 1));
  }
}

function renderStandaloneToken(context: RenderContext, index: number): string {
  const token = context.tokens[index];
  switch (token.type) {
    case 'code_block':
    case 'fence':
      return renderCode(context, index);
    case 'hr':
      return wrapBlock('separator', '<hr class="wp-block-separator has-alpha-channel-opacity"/>');
    default:
      return renderCustomHtml(renderRange(context, index, index + 1));
  }
}

function renderBlocksAtLevel(
  context: RenderContext,
  start: number,
  end: number,
  level: number
): string[] {
  const blocks: string[] = [];
  let index = start;
  while (index < end) {
    const token = context.tokens[index];
    if (token.level !== level || token.nesting === -1) {
      index += 1;
      continue;
    }
    if (token.nesting === 1) {
      const closingIndex = findClosingToken(context.tokens, index);
      const block = renderTopLevelRange(context, index, closingIndex);
      if (block) {
        blocks.push(block);
      }
      index = closingIndex + 1;
      continue;
    }

    const block = renderStandaloneToken(context, index);
    if (block) {
      blocks.push(block);
    }
    index += 1;
  }
  return blocks;
}

function renderMarkdownSegmentToWordPressBlocks(
  markdown: string,
  parser: MarkdownIt,
  options: WordPressRenderOptions
): string {
  const env: Record<string, unknown> = {};
  const tokens = parser.parse(markdown, env);
  const context: RenderContext = { markdown: parser, tokens, env, options };
  return renderBlocksAtLevel(context, 0, tokens.length, 0).join('\n\n');
}

export function renderMarkdownToWordPressBlocks(
  markdown: string,
  parser: MarkdownIt,
  options: WordPressRenderOptions = {}
): string {
  if (isSerializedWordPressPost(markdown)) {
    return markdown.trim();
  }
  const protectedSources = splitProtectedWordPressSources(markdown);
  if (protectedSources.errors.length > 0) {
    throw new Error(protectedSources.errors.join(' '));
  }
  return protectedSources.segments
    .map(segment => segment.kind === 'wordpress-source'
      ? segment.content
      : renderMarkdownSegmentToWordPressBlocks(segment.content, parser, options)
    )
    .filter(Boolean)
    .join('\n\n');
}

export function renderWordPressPostContent(
  markdown: string,
  parser: MarkdownIt,
  format: WordPressContentFormat,
  options: WordPressRenderOptions = {}
): string {
  return format === WordPressContentFormat.ClassicHtml
    ? parser.render(markdown)
    : renderMarkdownToWordPressBlocks(markdown, parser, options);
}
