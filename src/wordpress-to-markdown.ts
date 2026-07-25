import {
  parseFragment,
  type DefaultTreeAdapterTypes,
  type ParserError
} from 'parse5';
import {
  parseWordPressBlocks,
  protectWordPressSource,
  sourceRangeForOffsets,
  type ParsedWordPressBlock,
  type WordPressSourceRange
} from './wordpress-block-parser';
import { legacyImageParagraphSource } from './legacy-image-syntax';

export const WORDPRESS_TO_MARKDOWN_VERSION = '1.0.0';

export const WordPressConversionKind = {
  Exact: 'exact',
  Normalized: 'normalized',
  PreservedRaw: 'preserved-raw',
  Blocking: 'blocking'
} as const;

export type WordPressConversionKind = typeof WordPressConversionKind[
  keyof typeof WordPressConversionKind
];

export type WordPressRemoteSourceFormat = 'block-editor' | 'classic-html' | 'empty';

export interface WordPressConversionDiagnostic {
  kind: WordPressConversionKind;
  code: string;
  message: string;
  blockName?: string;
  range: WordPressSourceRange;
}

export interface WordPressToMarkdownResult {
  markdown: string;
  diagnostics: WordPressConversionDiagnostic[];
  fidelity: WordPressConversionKind;
  converterVersion: string;
  sourceFormat: WordPressRemoteSourceFormat;
}

type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;

interface HtmlConversionResult {
  markdown: string;
  supported: boolean;
  normalized: boolean;
  reason?: string;
}

interface HtmlRenderContext {
  failedReason?: string;
  normalized: boolean;
}

const SUPPORTED_BLOCKS = new Set([
  'core/paragraph',
  'core/heading',
  'core/list',
  'core/list-item',
  'core/quote',
  'core/code',
  'core/image',
  'core/table',
  'core/separator',
  'core/html'
]);

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol',
  'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul'
]);

const SCRIPT_LIKE_TAGS = new Set([
  'applet', 'audio', 'embed', 'iframe', 'object', 'script', 'style', 'svg',
  'template', 'video'
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set([ 'href', 'title' ]),
  blockquote: new Set([ 'class' ]),
  figcaption: new Set([ 'class' ]),
  figure: new Set([ 'class' ]),
  h1: new Set([ 'class' ]),
  h2: new Set([ 'class' ]),
  h3: new Set([ 'class' ]),
  h4: new Set([ 'class' ]),
  h5: new Set([ 'class' ]),
  h6: new Set([ 'class' ]),
  hr: new Set([ 'class' ]),
  img: new Set([ 'alt', 'height', 'src', 'title', 'width' ]),
  ol: new Set([ 'class', 'start' ]),
  pre: new Set([ 'class' ]),
  td: new Set([ 'align', 'style' ]),
  th: new Set([ 'align', 'style' ]),
  ul: new Set([ 'class' ])
};

const ALLOWED_CLASSES: Record<string, Set<string>> = {
  blockquote: new Set([ 'wp-block-quote' ]),
  figcaption: new Set([ 'wp-element-caption', 'wp-block-image-caption' ]),
  figure: new Set([ 'wp-block-image', 'wp-block-table' ]),
  h1: new Set([ 'wp-block-heading' ]),
  h2: new Set([ 'wp-block-heading' ]),
  h3: new Set([ 'wp-block-heading' ]),
  h4: new Set([ 'wp-block-heading' ]),
  h5: new Set([ 'wp-block-heading' ]),
  h6: new Set([ 'wp-block-heading' ]),
  hr: new Set([ 'wp-block-separator', 'has-alpha-channel-opacity' ]),
  ol: new Set([ 'wp-block-list' ]),
  pre: new Set([ 'wp-block-code' ]),
  ul: new Set([ 'wp-block-list' ])
};

const BLOCK_DELIMITER_PATTERN = /<!--\s*\/?wp:[a-z0-9-]+(?:\/[a-z0-9-]+)?(?:\s+\{[\s\S]*?\})?\s*\/?-->/gi;

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function isTextNode(node: HtmlNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function isCommentNode(node: HtmlNode): node is DefaultTreeAdapterTypes.CommentNode {
  return node.nodeName === '#comment';
}

function attributes(element: HtmlElement): Record<string, string> {
  return Object.fromEntries(element.attrs.map(attribute => [
    attribute.name.toLowerCase(),
    attribute.value
  ]));
}

function elementChildren(element: HtmlElement, tagName?: string): HtmlElement[] {
  return element.childNodes.filter((node): node is HtmlElement => {
    return isElement(node) && (!tagName || node.tagName === tagName);
  });
}

function firstDescendant(element: HtmlElement, tagName: string): HtmlElement | undefined {
  for (const child of element.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === tagName) return child;
    const nested = firstDescendant(child, tagName);
    if (nested) return nested;
  }
  return undefined;
}

function textContent(node: HtmlNode | HtmlElement): string {
  if (isTextNode(node as HtmlNode)) {
    return (node as DefaultTreeAdapterTypes.TextNode).value;
  }
  if ('childNodes' in node) {
    return node.childNodes.map(child => textContent(child)).join('');
  }
  return '';
}

function validAllowedClass(tagName: string, value: string): boolean {
  const allowed = ALLOWED_CLASSES[tagName];
  if (!allowed) return false;
  const classes = value.trim().split(/\s+/).filter(Boolean);
  return classes.length > 0 && classes.every(className => allowed.has(className));
}

function validAttribute(element: HtmlElement, name: string, value: string): boolean {
  const allowed = ALLOWED_ATTRIBUTES[element.tagName] ?? new Set<string>();
  if (!allowed.has(name)) return false;
  if (name === 'class') return validAllowedClass(element.tagName, value);
  if (name === 'style') {
    return /^\s*text-align\s*:\s*(?:left|right|center)\s*;?\s*$/i.test(value);
  }
  if (name === 'align') return /^(?:left|right|center)$/i.test(value);
  if (name === 'start' || name === 'width' || name === 'height') {
    return /^[1-9]\d*$/.test(value);
  }
  return true;
}

function meaningfulChildren(element: HtmlElement): HtmlNode[] {
  return element.childNodes.filter(node => {
    if (isTextNode(node)) return Boolean(node.value.trim());
    if (isCommentNode(node)) return Boolean(node.data.trim());
    return true;
  });
}

function parentTagName(element: HtmlElement): string | undefined {
  const parent = element.parentNode;
  return parent && 'tagName' in parent ? parent.tagName : undefined;
}

function inspectImageElement(element: HtmlElement): string | undefined {
  const attrs = attributes(element);
  if (!attrs.src) return 'An image without a source URL cannot be represented safely.';
  if (/[\u0000-\u0020\u007f\\]/.test(attrs.src)) {
    return 'An image source URL contains characters that are unsafe in Markdown.';
  }
  if (attrs.height && !attrs.width) {
    return 'An image height without a width cannot be represented by the current Markdown syntax.';
  }
  if (/[\r\n]/.test(attrs.alt ?? '') || /[\r\n]/.test(attrs.title ?? '')) {
    return 'Multiline image text cannot be represented safely.';
  }
  if (!attrs.width
    && /^(?:\d+(?:x\d+)?|.*\|\d+(?:x\d+)?)$/.test(attrs.alt ?? '')
  ) {
    return 'The image alt text is ambiguous with Obsidian dimension syntax.';
  }
  return undefined;
}

function inspectLinkElement(element: HtmlElement): string | undefined {
  const attrs = attributes(element);
  if (!attrs.href) return 'A link without a destination cannot be represented safely.';
  if (/[\u0000-\u0020\u007f\\]/.test(attrs.href)) {
    return 'A link destination contains characters that are unsafe in Markdown.';
  }
  if (/[\r\n]/.test(attrs.title ?? '')) {
    return 'A multiline link title cannot be represented safely.';
  }
  return undefined;
}

function inspectListStructure(element: HtmlElement): string | undefined {
  if (element.tagName === 'ul' || element.tagName === 'ol') {
    const invalidChild = meaningfulChildren(element).find(child => {
      return !isElement(child) || child.tagName !== 'li';
    });
    return invalidChild
      ? 'A list contains content outside a list item.'
      : undefined;
  }
  if (element.tagName !== 'li') return undefined;
  const parent = parentTagName(element);
  if (parent !== 'ul' && parent !== 'ol') {
    return 'A list item appears outside a list.';
  }
  let reachedNestedList = false;
  for (const child of meaningfulChildren(element)) {
    if (isElement(child) && (child.tagName === 'ul' || child.tagName === 'ol')) {
      reachedNestedList = true;
    } else if (reachedNestedList) {
      return 'Content after a nested list would be reordered by Markdown.';
    }
  }
  return undefined;
}

function inspectImageCaption(caption: HtmlElement): string | undefined {
  const children = meaningfulChildren(caption);
  if (children.length === 0) return undefined;
  const first = children[0];
  if (!isElement(first) || first.tagName !== 'strong') {
    return children.every(isTextNode)
      ? undefined
      : 'A formatted image caption cannot be represented by wp-media metadata.';
  }
  if (!first.childNodes.every(isTextNode)) {
    return 'A formatted attachment title cannot be represented by wp-media metadata.';
  }
  const remainder = children.slice(1);
  if (remainder.length === 0) return undefined;
  if (!isElement(remainder[0]) || remainder[0].tagName !== 'br') {
    return 'An attachment title and caption must be separated by a line break.';
  }
  return remainder.slice(1).every(isTextNode)
    ? undefined
    : 'A formatted image caption cannot be represented by wp-media metadata.';
}

function inspectFigureStructure(figure: HtmlElement): string | undefined {
  const children = meaningfulChildren(figure);
  const figureClass = attributes(figure).class;
  const tables = children.filter(child => isElement(child) && child.tagName === 'table');
  if (tables.length > 0) {
    if (tables.length !== 1 || children.length !== 1) {
      return 'A table figure contains additional content that GFM cannot represent.';
    }
    return figureClass && figureClass !== 'wp-block-table'
      ? 'A table figure uses an incompatible WordPress class.'
      : undefined;
  }

  const images = children.filter(child => isElement(child) && child.tagName === 'img');
  const captions = children.filter(child => isElement(child) && child.tagName === 'figcaption');
  if (images.length !== 1
    || captions.length > 1
    || children.some(child => {
      return !isElement(child) || (child.tagName !== 'img' && child.tagName !== 'figcaption');
    })
  ) {
    return 'An image figure is not a single direct image with an optional caption.';
  }
  if (captions[0] && children.indexOf(captions[0]) < children.indexOf(images[0])) {
    return 'An image caption appears before its image.';
  }
  if (figureClass && figureClass !== 'wp-block-image') {
    return 'An image figure uses an incompatible WordPress class.';
  }
  return captions[0] ? inspectImageCaption(captions[0] as HtmlElement) : undefined;
}

function inspectElementStructure(element: HtmlElement): string | undefined {
  if (element.tagName === 'img') return inspectImageElement(element);
  if (element.tagName === 'a') return inspectLinkElement(element);
  if (element.tagName === 'figure') return inspectFigureStructure(element);
  if (element.tagName === 'ul'
    || element.tagName === 'ol'
    || element.tagName === 'li'
  ) {
    return inspectListStructure(element);
  }
  if (element.tagName === 'figcaption' && parentTagName(element) !== 'figure') {
    return 'A caption appears outside a figure.';
  }
  if ((element.tagName === 'thead'
      || element.tagName === 'tbody'
      || element.tagName === 'tfoot')
    && parentTagName(element) !== 'table'
  ) {
    return 'A table section appears outside a table.';
  }
  if (element.tagName === 'tr'
    && ![ 'table', 'thead', 'tbody', 'tfoot' ].includes(parentTagName(element) ?? '')
  ) {
    return 'A table row appears outside a table section.';
  }
  if ((element.tagName === 'th' || element.tagName === 'td')
    && parentTagName(element) !== 'tr'
  ) {
    return 'A table cell appears outside a row.';
  }
  return undefined;
}

function inspectHtmlNode(node: HtmlNode, tableDepth = 0): string | undefined {
  if (isTextNode(node)) {
    return /[^\S\t\n\f\r ]/u.test(node.value)
      ? 'Unicode whitespace is preserved as raw source to avoid semantic collapse.'
      : undefined;
  }
  if (isCommentNode(node)) {
    return node.data.trim() ? 'HTML comments cannot be represented safely in Markdown.' : undefined;
  }
  if (!isElement(node)) {
    return 'The HTML fragment contains an unsupported document node.';
  }
  if (SCRIPT_LIKE_TAGS.has(node.tagName)) {
    return `The <${node.tagName}> element is preserved as inert source.`;
  }
  if (!ALLOWED_TAGS.has(node.tagName)) {
    return `The <${node.tagName}> element is outside the conversion allowlist.`;
  }
  if (node.tagName === 'table' && tableDepth > 0) {
    return 'Nested tables cannot be represented without loss.';
  }
  const structuralReason = inspectElementStructure(node);
  if (structuralReason) return structuralReason;
  for (const attribute of node.attrs) {
    if (!validAttribute(node, attribute.name.toLowerCase(), attribute.value)) {
      return `The ${attribute.name} attribute on <${node.tagName}> cannot be represented without loss.`;
    }
  }
  const nextTableDepth = tableDepth + (node.tagName === 'table' ? 1 : 0);
  for (const child of node.childNodes) {
    const reason = inspectHtmlNode(child, nextTableDepth);
    if (reason) return reason;
  }
  return undefined;
}

function escapeMarkdownText(value: string): string {
  let escaped = value.replace(/([\\`*_[\]~<>#$%^=])/g, '\\$1');
  escaped = escaped.replace(
    /^(\s{0,3})(#{1,6}|>|[+-])(?=\s)/,
    '$1\\$2'
  );
  escaped = escaped.replace(
    /^(\s{0,3})(\d+)([.)])(?=\s)/,
    '$1$2\\$3'
  );
  return escaped.replace(/^(\s{0,3})(-{3,})(?=\s*$)/, '$1\\$2');
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/([\\`*_[\]~<>#$%^=])/g, '\\$1');
}

function markdownDestination(value: string): string {
  return /^[^\s()<>]+$/.test(value)
    ? value
    : '<' + value.replace(/</g, '%3C').replace(/>/g, '%3E') + '>';
}

function markdownTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function inlineCode(value: string): string {
  const runs = value.match(/`+/g)?.map(run => run.length) ?? [ 0 ];
  const fence = '`'.repeat(Math.max(...runs) + 1);
  const padding = /^\s|\s$/.test(value) ? ' ' : '';
  return fence + padding + value + padding + fence;
}

function fencedCode(value: string): string {
  const runs = value.match(/`+/g)?.map(run => run.length) ?? [ 0 ];
  const fence = '`'.repeat(Math.max(3, Math.max(...runs) + 1));
  const body = value.endsWith('\n') ? value : value + '\n';
  return fence + '\n' + body + fence;
}

function normalizeInline(value: string): string {
  return value
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\\\n */g, '\\\n')
    .trim();
}

function cleanMarkdown(value: string): string {
  return value
    .split('\n')
    .map(line => line.replace(/[\t ]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderInlineNodes(nodes: HtmlNode[], context: HtmlRenderContext): string {
  return normalizeInline(nodes.map(node => renderHtmlNode(node, context, true)).join(''));
}

function preserveInlineBoundaryWhitespace(
  element: HtmlElement,
  rendered: string,
  context: HtmlRenderContext
): string {
  const raw = textContent(element);
  const leading = /^\s/.test(raw) ? ' ' : '';
  const trailing = /\s$/.test(raw) ? ' ' : '';
  if (leading || trailing) context.normalized = true;
  if (!rendered && raw) return ' ';
  return leading + rendered + trailing;
}

function renderImageElement(image: HtmlElement): string {
  const attrs = attributes(image);
  const alt = attrs.alt ?? '';
  const dimensions = attrs.width && attrs.height
    ? `|${attrs.width}x${attrs.height}`
    : attrs.width
      ? `|${attrs.width}`
      : '';
  const title = attrs.title ? ` "${markdownTitle(attrs.title)}"` : '';
  return `![${escapeMarkdownAlt(alt)}${dimensions}](${markdownDestination(attrs.src ?? '')}${title})`;
}

function renderLegacyImageParagraph(
  paragraph: HtmlElement,
  context: HtmlRenderContext
): string | undefined {
  if (paragraph.childNodes.some(node => !isTextNode(node))) return undefined;

  const source = legacyImageParagraphSource(textContent(paragraph));
  if (!source) return undefined;

  context.normalized = true;
  return `![](${markdownDestination(source)})`;
}

function metadataValueSafe(value: string): boolean {
  return !/[\r\n]/.test(value) && !value.includes('%%');
}

function renderImageFigure(
  figure: HtmlElement,
  context: HtmlRenderContext
): string {
  const image = firstDescendant(figure, 'img');
  if (!image) {
    context.failedReason = 'An image figure does not contain an <img> element.';
    return '';
  }
  const captionElement = firstDescendant(figure, 'figcaption');
  let mediaTitle: string | undefined;
  let caption: string | undefined;
  if (captionElement) {
    const significant = meaningfulChildren(captionElement);
    if (significant[0] && isElement(significant[0]) && significant[0].tagName === 'strong') {
      mediaTitle = textContent(significant[0]).trim();
      const rest = significant.slice(1);
      if (rest[0] && isElement(rest[0]) && rest[0].tagName === 'br') {
        rest.shift();
      }
      caption = textContent({
        ...captionElement,
        childNodes: rest
      }).trim() || undefined;
    } else {
      caption = textContent(captionElement).trim() || undefined;
    }
  }
  const imageTitle = attributes(image).title;
  if (mediaTitle && imageTitle && mediaTitle !== imageTitle) {
    context.failedReason = 'The attachment title and Markdown image title differ.';
    return '';
  }
  if ((mediaTitle && !metadataValueSafe(mediaTitle))
    || (caption && !metadataValueSafe(caption))
  ) {
    context.failedReason = 'Multiline image metadata cannot be represented safely.';
    return '';
  }
  const markdown = renderImageElement(image);
  if (!mediaTitle && !caption) return markdown;
  return [
    markdown,
    '%% wp-media',
    ...(mediaTitle ? [ 'title: ' + mediaTitle ] : []),
    ...(caption ? [ 'caption: ' + caption ] : []),
    '%%'
  ].join('\n');
}

function renderListItem(
  item: HtmlElement,
  marker: string,
  context: HtmlRenderContext
): string {
  const nestedLists: HtmlElement[] = [];
  const bodyNodes = item.childNodes.filter(node => {
    if (isElement(node) && (node.tagName === 'ul' || node.tagName === 'ol')) {
      nestedLists.push(node);
      return false;
    }
    return true;
  });
  const body = cleanMarkdown(bodyNodes.map(node => renderHtmlNode(node, context, false)).join(''));
  const continuation = ' '.repeat(marker.length);
  const bodyLines = (body || '').split('\n');
  const lines = [ marker + (bodyLines[0] ?? '') ];
  bodyLines.slice(1).forEach(line => lines.push(continuation + line));
  nestedLists.forEach(list => {
    const nested = cleanMarkdown(renderList(list, context));
    nested.split('\n').forEach(line => lines.push(continuation + line));
  });
  return lines.join('\n').trimEnd();
}

function renderList(list: HtmlElement, context: HtmlRenderContext): string {
  const ordered = list.tagName === 'ol';
  const start = Number(attributes(list).start ?? '1');
  const items = elementChildren(list, 'li');
  return items.map((item, index) => {
    const marker = ordered ? `${Number.isSafeInteger(start) ? start + index : index + 1}. ` : '- ';
    return renderListItem(item, marker, context);
  }).join('\n');
}

function tableRows(section: HtmlElement): HtmlElement[] {
  return elementChildren(section, 'tr');
}

function tableCells(row: HtmlElement): HtmlElement[] {
  return row.childNodes.filter((node): node is HtmlElement => {
    return isElement(node) && (node.tagName === 'th' || node.tagName === 'td');
  });
}

function tableCellMarkdown(cell: HtmlElement, context: HtmlRenderContext): string {
  const markdown = renderInlineNodes(cell.childNodes, context);
  if (markdown.includes('\n')) {
    context.failedReason = 'Multiline table cells cannot be represented by the current publisher.';
    return '';
  }
  return markdown.replace(/\|/g, '\\|') || ' ';
}

function tableAlignment(cell: HtmlElement | undefined): string {
  if (!cell) return '---';
  const attrs = attributes(cell);
  const value = attrs.align
    ?? attrs.style?.match(/text-align\s*:\s*(left|right|center)/i)?.[1];
  if (value === 'center') return ':---:';
  if (value === 'right') return '---:';
  if (value === 'left') return ':---';
  return '---';
}

function renderTable(table: HtmlElement, context: HtmlRenderContext): string {
  const heads = elementChildren(table, 'thead');
  const feet = elementChildren(table, 'tfoot');
  if (heads.length > 1 || feet.length > 1) {
    context.failedReason = 'Tables with multiple head or foot sections cannot be represented safely.';
    return '';
  }

  const rowsFromSection = (section: HtmlElement): HtmlElement[] => {
    if (meaningfulChildren(section).some(child => {
      return !isElement(child) || child.tagName !== 'tr';
    })) {
      context.failedReason = 'A table section contains content outside a row.';
      return [];
    }
    return tableRows(section);
  };
  let headerRows = heads[0] ? rowsFromSection(heads[0]) : [];
  const bodyRows: HtmlElement[] = [];
  table.childNodes.forEach(child => {
    if (!isElement(child)) return;
    if (child.tagName === 'tr') bodyRows.push(child);
    if (child.tagName === 'tbody' || child.tagName === 'tfoot') {
      bodyRows.push(...rowsFromSection(child));
    }
  });
  if (context.failedReason) return '';
  if (headerRows.length === 0 && bodyRows.length > 0) {
    headerRows = [ bodyRows.shift() as HtmlElement ];
    context.normalized = true;
  }
  if (headerRows.length !== 1) {
    context.failedReason = 'Tables with zero or multiple header rows cannot be represented safely.';
    return '';
  }

  const cellsForRow = (row: HtmlElement): HtmlElement[] => {
    if (meaningfulChildren(row).some(child => {
      return !isElement(child) || (child.tagName !== 'th' && child.tagName !== 'td');
    })) {
      context.failedReason = 'A table row contains content outside a cell.';
      return [];
    }
    return tableCells(row);
  };
  const headerCells = cellsForRow(headerRows[0]);
  if (headerCells.length === 0) {
    context.failedReason = 'The table header is empty.';
    return '';
  }
  const bodyCells = bodyRows.map(cellsForRow);
  if (context.failedReason) return '';
  const width = headerCells.length;
  if (bodyCells.some(cells => cells.length !== width)) {
    context.failedReason = 'Every table row must contain the same number of cells.';
    return '';
  }
  const row = (cells: HtmlElement[]): string => {
    return '| ' + cells.map(cell => tableCellMarkdown(cell, context)).join(' | ') + ' |';
  };
  const markdown = [
    row(headerCells),
    '| ' + headerCells.map(tableAlignment).join(' | ') + ' |',
    ...bodyCells.map(row)
  ].join('\n');
  return context.failedReason ? '' : markdown;
}

function renderHtmlNode(
  node: HtmlNode,
  context: HtmlRenderContext,
  inline: boolean
): string {
  if (isTextNode(node)) {
    if (!inline && !node.value.trim()) {
      return '';
    }
    return escapeMarkdownText(node.value.replace(/\s+/g, ' '));
  }
  if (!isElement(node)) return '';
  const childrenInline = (): string => renderInlineNodes(node.childNodes, context);
  const childrenBlock = (): string => node.childNodes
    .map(child => renderHtmlNode(child, context, false))
    .join('');

  switch (node.tagName) {
    case 'strong':
    case 'b': {
      const body = childrenInline();
      return preserveInlineBoundaryWhitespace(
        node,
        body ? '**' + body + '**' : '',
        context
      );
    }
    case 'em':
    case 'i': {
      const body = childrenInline();
      return preserveInlineBoundaryWhitespace(
        node,
        body ? '*' + body + '*' : '',
        context
      );
    }
    case 'code':
      return node.parentNode && 'tagName' in node.parentNode && node.parentNode.tagName === 'pre'
        ? textContent(node)
        : inlineCode(textContent(node));
    case 'a': {
      const attrs = attributes(node);
      const title = attrs.title ? ` "${markdownTitle(attrs.title)}"` : '';
      return preserveInlineBoundaryWhitespace(
        node,
        `[${childrenInline()}](${markdownDestination(attrs.href ?? '')}${title})`,
        context
      );
    }
    case 'br':
      return '\\\n';
    case 'span':
      return childrenInline();
    case 'img':
      return renderImageElement(node);
    case 'p': {
      const legacyImage = renderLegacyImageParagraph(node, context);
      return (legacyImage ?? childrenInline()) + '\n\n';
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return '#'.repeat(Number(node.tagName[1])) + ' ' + childrenInline() + '\n\n';
    case 'ul':
    case 'ol':
      return renderList(node, context) + (inline ? '' : '\n\n');
    case 'li':
      return renderListItem(node, '- ', context);
    case 'blockquote': {
      const body = cleanMarkdown(childrenBlock());
      return body.split('\n').map(line => line ? '> ' + line : '>').join('\n') + '\n\n';
    }
    case 'pre':
      return fencedCode(textContent(node)) + '\n\n';
    case 'hr':
      return '---\n\n';
    case 'figure': {
      const table = firstDescendant(node, 'table');
      if (table) return renderTable(table, context) + '\n\n';
      return renderImageFigure(node, context) + '\n\n';
    }
    case 'table':
      return renderTable(node, context) + '\n\n';
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'tr':
    case 'th':
    case 'td':
    case 'figcaption':
      return childrenBlock();
    default:
      return '';
  }
}

function convertHtml(html: string): HtmlConversionResult {
  const parseErrors: ParserError[] = [];
  const fragment = parseFragment(html, {
    sourceCodeLocationInfo: true,
    onParseError: error => parseErrors.push(error)
  });
  if (parseErrors.length > 0) {
    return {
      markdown: '',
      supported: false,
      normalized: false,
      reason: `HTML parsing reported ${parseErrors[0].code}.`
    };
  }
  for (const child of fragment.childNodes) {
    const reason = inspectHtmlNode(child);
    if (reason) {
      return { markdown: '', supported: false, normalized: false, reason };
    }
  }
  const context: HtmlRenderContext = { normalized: false };
  const markdown = cleanMarkdown(
    fragment.childNodes.map(node => renderHtmlNode(node, context, false)).join('')
  );
  return context.failedReason
    ? {
      markdown: '',
      supported: false,
      normalized: context.normalized,
      reason: context.failedReason
    }
    : {
      markdown,
      supported: true,
      normalized: context.normalized
    };
}

function attrsSupported(block: ParsedWordPressBlock): boolean {
  const keys = Object.keys(block.attrs);
  switch (block.blockName) {
    case 'core/heading': {
      const levelOptions = block.attrs.levelOptions;
      return keys.every(key => {
        return key === 'level' || key === 'levelOptions' || key === 'className';
      })
        && (block.attrs.level === undefined
          || (Number.isInteger(block.attrs.level)
            && Number(block.attrs.level) >= 1
            && Number(block.attrs.level) <= 6))
        && (levelOptions === undefined
          || (Array.isArray(levelOptions)
            && levelOptions.length > 0
            && levelOptions.every(level => {
              return Number.isInteger(level) && Number(level) >= 1 && Number(level) <= 6;
            })))
        && (block.attrs.className === undefined
          || block.attrs.className === 'wp-block-heading');
    }
    case 'core/list':
      return keys.every(key => {
        return key === 'ordered' || key === 'start' || key === 'values';
      })
        && (block.attrs.ordered === undefined || typeof block.attrs.ordered === 'boolean')
        && (block.attrs.start === undefined
          || (Number.isSafeInteger(block.attrs.start) && Number(block.attrs.start) > 0))
        && (block.attrs.values === undefined || block.attrs.values === '');
    case 'core/table':
      return keys.every(key => key === 'hasFixedLayout')
        && (block.attrs.hasFixedLayout === undefined || block.attrs.hasFixedLayout === false);
    default:
      return keys.length === 0;
  }
}

function headingMarkupMatchesLevel(
  block: ParsedWordPressBlock,
  html: string
): boolean {
  const parseErrors: ParserError[] = [];
  const fragment = parseFragment(html, {
    sourceCodeLocationInfo: true,
    onParseError: error => parseErrors.push(error)
  });
  if (parseErrors.length > 0) return false;
  const children = fragment.childNodes.filter(node => {
    if (isTextNode(node)) return Boolean(node.value.trim());
    if (isCommentNode(node)) return Boolean(node.data.trim());
    return true;
  });
  if (children.length !== 1 || !isElement(children[0])) return false;
  if (!/^h[1-6]$/.test(children[0].tagName)) return false;
  const actualLevel = Number(children[0].tagName[1]);
  const expectedLevel = block.attrs.level === undefined
    ? 2
    : Number(block.attrs.level);
  return actualLevel === expectedLevel;
}

function attrsRequireNormalization(block: ParsedWordPressBlock): boolean {
  const currentBlockRequiresNormalization = (block.blockName === 'core/heading'
      && block.attrs.levelOptions !== undefined)
    || (block.blockName === 'core/list'
      && block.attrs.values !== undefined);
  return currentBlockRequiresNormalization
    || block.innerBlocks.some(attrsRequireNormalization);
}

function unsupportedDescendant(block: ParsedWordPressBlock): ParsedWordPressBlock | undefined {
  for (const child of block.innerBlocks) {
    if (!child.blockName || !SUPPORTED_BLOCKS.has(child.blockName) || !attrsSupported(child)) {
      return child;
    }
    const nested = unsupportedDescendant(child);
    if (nested) return nested;
  }
  return undefined;
}

function diagnosticForBlock(
  block: ParsedWordPressBlock,
  kind: WordPressConversionKind,
  code: string,
  message: string
): WordPressConversionDiagnostic {
  return {
    kind,
    code,
    message,
    ...(block.blockName ? { blockName: block.blockName } : {}),
    range: block.range
  };
}

function exactTreeDiagnostics(block: ParsedWordPressBlock): WordPressConversionDiagnostic[] {
  return [
    diagnosticForBlock(
      block,
      WordPressConversionKind.Exact,
      'converted-supported-block',
      `${block.blockName ?? 'Freeform HTML'} converted without a known semantic loss.`
    ),
    ...block.innerBlocks.flatMap(exactTreeDiagnostics)
  ];
}

function convertParsedBlock(block: ParsedWordPressBlock): {
  markdown: string;
  diagnostics: WordPressConversionDiagnostic[];
} {
  if (!block.blockName) {
    const converted = convertHtml(block.raw);
    if (!converted.supported) {
      return {
        markdown: protectWordPressSource(block.raw, 'freeform-html'),
        diagnostics: [ diagnosticForBlock(
          block,
          WordPressConversionKind.PreservedRaw,
          'preserved-freeform-html',
          converted.reason ?? 'Freeform HTML was preserved as inert source.'
        ) ]
      };
    }
    return {
      markdown: converted.markdown,
      diagnostics: [ diagnosticForBlock(
        block,
        WordPressConversionKind.Normalized,
        'normalized-freeform-html',
        'Freeform HTML was normalized to Markdown.'
      ) ]
    };
  }

  const unsupportedChild = unsupportedDescendant(block);
  const unsupportedReason = !SUPPORTED_BLOCKS.has(block.blockName)
    ? `${block.blockName} is not in the safe conversion set.`
    : !attrsSupported(block)
      ? `${block.blockName} has unsupported attributes: ${Object.keys(block.attrs).join(', ') || '(none)'}.`
      : unsupportedChild
        ? `${block.blockName} contains unsupported child ${unsupportedChild.blockName ?? 'freeform HTML'}.`
        : undefined;
  if (unsupportedReason) {
    return {
      markdown: protectWordPressSource(block.raw, block.blockName),
      diagnostics: [ diagnosticForBlock(
        block,
        WordPressConversionKind.PreservedRaw,
        'preserved-unsupported-block',
        unsupportedReason
      ) ]
    };
  }

  const html = block.innerHtml.replace(BLOCK_DELIMITER_PATTERN, '');
  if (block.blockName === 'core/heading'
    && !headingMarkupMatchesLevel(block, html)
  ) {
    return {
      markdown: protectWordPressSource(block.raw, block.blockName),
      diagnostics: [ diagnosticForBlock(
        block,
        WordPressConversionKind.PreservedRaw,
        'preserved-invalid-heading',
        'The heading markup does not contain exactly one heading at the declared level.'
      ) ]
    };
  }
  if (block.blockName === 'core/separator') {
    if (block.selfClosing && !html.trim()) {
      return { markdown: '---', diagnostics: exactTreeDiagnostics(block) };
    }
    const separator = convertHtml(html);
    if (separator.supported && separator.markdown === '---') {
      return { markdown: '---', diagnostics: exactTreeDiagnostics(block) };
    }
    return {
      markdown: protectWordPressSource(block.raw, block.blockName),
      diagnostics: [ diagnosticForBlock(
        block,
        WordPressConversionKind.PreservedRaw,
        'preserved-invalid-separator',
        separator.reason ?? 'The separator block contains additional content.'
      ) ]
    };
  }

  const converted = convertHtml(html);
  if (!converted.supported) {
    return {
      markdown: protectWordPressSource(block.raw, block.blockName),
      diagnostics: [ diagnosticForBlock(
        block,
        WordPressConversionKind.PreservedRaw,
        'preserved-unsupported-html',
        converted.reason ?? `${block.blockName} contains HTML outside the allowlist.`
      ) ]
    };
  }
  const normalized = block.blockName === 'core/html'
    || converted.normalized
    || attrsRequireNormalization(block);
  return {
    markdown: converted.markdown,
    diagnostics: normalized
      ? [ diagnosticForBlock(
        block,
        WordPressConversionKind.Normalized,
        'normalized-supported-html',
        `${block.blockName} was normalized to equivalent Markdown.`
      ) ]
      : exactTreeDiagnostics(block)
  };
}

function resultFidelity(diagnostics: WordPressConversionDiagnostic[]): WordPressConversionKind {
  if (diagnostics.some(item => item.kind === WordPressConversionKind.Blocking)) {
    return WordPressConversionKind.Blocking;
  }
  if (diagnostics.some(item => item.kind === WordPressConversionKind.PreservedRaw)) {
    return WordPressConversionKind.PreservedRaw;
  }
  if (diagnostics.some(item => item.kind === WordPressConversionKind.Normalized)) {
    return WordPressConversionKind.Normalized;
  }
  return WordPressConversionKind.Exact;
}

export function convertWordPressToMarkdown(
  content: string,
  sourceFormat: WordPressRemoteSourceFormat
): WordPressToMarkdownResult {
  if (sourceFormat === 'empty' || !content.trim()) {
    return {
      markdown: '',
      diagnostics: [],
      fidelity: WordPressConversionKind.Exact,
      converterVersion: WORDPRESS_TO_MARKDOWN_VERSION,
      sourceFormat
    };
  }

  if (sourceFormat === 'classic-html') {
    const converted = convertHtml(content);
    const range = sourceRangeForOffsets(content, 0, content.length);
    const diagnostics: WordPressConversionDiagnostic[] = [ converted.supported
      ? {
        kind: WordPressConversionKind.Normalized,
        code: 'normalized-classic-html',
        message: 'Classic editor HTML was normalized to Markdown.',
        range
      }
      : {
        kind: WordPressConversionKind.PreservedRaw,
        code: 'preserved-classic-html',
        message: converted.reason ?? 'Classic HTML was preserved as inert source.',
        range
      } ];
    return {
      markdown: converted.supported
        ? converted.markdown
        : protectWordPressSource(content, 'classic-html'),
      diagnostics,
      fidelity: resultFidelity(diagnostics),
      converterVersion: WORDPRESS_TO_MARKDOWN_VERSION,
      sourceFormat
    };
  }

  const parsed = parseWordPressBlocks(content);
  if (!parsed.valid) {
    const diagnostics: WordPressConversionDiagnostic[] = parsed.diagnostics.map(item => ({
      kind: WordPressConversionKind.Blocking,
      code: item.code,
      message: item.message,
      range: item.range
    }));
    return {
      markdown: protectWordPressSource(content, 'malformed-blocks'),
      diagnostics,
      fidelity: WordPressConversionKind.Blocking,
      converterVersion: WORDPRESS_TO_MARKDOWN_VERSION,
      sourceFormat
    };
  }

  const converted = parsed.blocks.map(convertParsedBlock);
  const diagnostics = converted
    .flatMap(item => item.diagnostics)
    .sort((left, right) => left.range.start.offset - right.range.start.offset);
  return {
    markdown: converted.map(item => item.markdown).filter(Boolean).join('\n\n'),
    diagnostics,
    fidelity: resultFidelity(diagnostics),
    converterVersion: WORDPRESS_TO_MARKDOWN_VERSION,
    sourceFormat
  };
}
