export interface WordPressSourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface WordPressSourceRange {
  start: WordPressSourcePosition;
  end: WordPressSourcePosition;
}

export interface ParsedWordPressBlock {
  blockName: string | null;
  attrs: Record<string, unknown>;
  innerBlocks: ParsedWordPressBlock[];
  innerHtml: string;
  raw: string;
  range: WordPressSourceRange;
  innerRange: WordPressSourceRange;
  selfClosing: boolean;
}

export interface WordPressBlockParseDiagnostic {
  code:
    | 'invalid-block-delimiter'
    | 'invalid-block-attributes'
    | 'unexpected-block-close'
    | 'mismatched-block-close'
    | 'unclosed-block';
  message: string;
  range: WordPressSourceRange;
}

export interface WordPressBlockParseResult {
  blocks: ParsedWordPressBlock[];
  diagnostics: WordPressBlockParseDiagnostic[];
  valid: boolean;
}

export const WORDPRESS_PROTECTED_SOURCE_VERSION = 1;

export interface WordPressProtectedSourceSegment {
  kind: 'markdown' | 'wordpress-source';
  content: string;
  label?: string;
}

export interface WordPressProtectedSourceSplitResult {
  segments: WordPressProtectedSourceSegment[];
  errors: string[];
}

interface BlockDelimiter {
  kind: 'open' | 'close' | 'self-close';
  blockName: string;
  attrs: Record<string, unknown>;
}

interface BlockFrame {
  blockName: string;
  attrs: Record<string, unknown>;
  startOffset: number;
  openEndOffset: number;
  innerBlocks: ParsedWordPressBlock[];
}

const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const BLOCK_OPEN_PATTERN = /^wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+(\{[\s\S]*\}))?\s*(\/)?$/i;
const BLOCK_CLOSE_PATTERN = /^\/wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)$/i;
const PROTECTED_OPEN_PATTERN = /^%% wp-source:v1(?:\s+([a-z0-9_\/-]+))?\s*$/i;
const PROTECTED_CLOSE_PATTERN = /^%%\s*$/;
const MARKDOWN_FENCE_PATTERN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

function normalizeBlockName(name: string): string {
  return name.includes('/') ? name.toLowerCase() : 'core/' + name.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDelimiter(rawComment: string): {
  delimiter?: BlockDelimiter;
  error?: 'invalid-block-delimiter' | 'invalid-block-attributes';
} {
  const body = rawComment.slice(4, -3).trim();
  const close = body.match(BLOCK_CLOSE_PATTERN);
  if (close) {
    return {
      delimiter: {
        kind: 'close',
        blockName: normalizeBlockName(close[1]),
        attrs: {}
      }
    };
  }
  const open = body.match(BLOCK_OPEN_PATTERN);
  if (open) {
    let attrs: Record<string, unknown> = {};
    if (open[2]) {
      try {
        const parsed = JSON.parse(open[2]);
        if (!isRecord(parsed)) {
          return { error: 'invalid-block-attributes' };
        }
        attrs = parsed;
      } catch {
        return { error: 'invalid-block-attributes' };
      }
    }
    return {
      delimiter: {
        kind: open[3] ? 'self-close' : 'open',
        blockName: normalizeBlockName(open[1]),
        attrs
      }
    };
  }
  if (/^\/?wp:/i.test(body)) {
    return { error: 'invalid-block-delimiter' };
  }
  return {};
}

function lineStarts(source: string): number[] {
  const starts = [ 0 ];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionAt(starts: number[], offset: number): WordPressSourcePosition {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  return {
    offset,
    line: lineIndex + 1,
    column: offset - starts[lineIndex] + 1
  };
}

function sourceRangeFromLineStarts(
  sourceLength: number,
  starts: number[],
  startOffset: number,
  endOffset: number
): WordPressSourceRange {
  const safeStart = Math.max(0, Math.min(sourceLength, startOffset));
  const safeEnd = Math.max(safeStart, Math.min(sourceLength, endOffset));
  return {
    start: positionAt(starts, safeStart),
    end: positionAt(starts, safeEnd)
  };
}

export function sourceRangeForOffsets(
  source: string,
  startOffset: number,
  endOffset: number
): WordPressSourceRange {
  return sourceRangeFromLineStarts(
    source.length,
    lineStarts(source),
    startOffset,
    endOffset
  );
}

function freeformBlock(
  source: string,
  startOffset: number,
  endOffset: number,
  rangeForOffsets: (
    startOffset: number,
    endOffset: number
  ) => WordPressSourceRange
): ParsedWordPressBlock | undefined {
  const raw = source.slice(startOffset, endOffset);
  if (!raw.trim()) {
    return undefined;
  }
  const range = rangeForOffsets(startOffset, endOffset);
  return {
    blockName: null,
    attrs: {},
    innerBlocks: [],
    innerHtml: raw,
    raw,
    range,
    innerRange: range,
    selfClosing: false
  };
}

/** Parse Gutenberg comment grammar while retaining exact source slices. */
export function parseWordPressBlocks(source: string): WordPressBlockParseResult {
  const starts = lineStarts(source);
  const rangeForOffsets = (
    startOffset: number,
    endOffset: number
  ): WordPressSourceRange => {
    return sourceRangeFromLineStarts(source.length, starts, startOffset, endOffset);
  };
  const blocks: ParsedWordPressBlock[] = [];
  const diagnostics: WordPressBlockParseDiagnostic[] = [];
  const stack: BlockFrame[] = [];
  let rootCursor = 0;
  let match: RegExpExecArray | null;

  COMMENT_PATTERN.lastIndex = 0;
  while ((match = COMMENT_PATTERN.exec(source)) !== null) {
    const startOffset = match.index;
    const endOffset = startOffset + match[0].length;
    const parsed = parseDelimiter(match[0]);
    if (parsed.error) {
      diagnostics.push({
        code: parsed.error,
        message: parsed.error === 'invalid-block-attributes'
          ? 'A WordPress block contains invalid JSON attributes.'
          : 'A WordPress block delimiter is malformed.',
        range: rangeForOffsets(startOffset, endOffset)
      });
      continue;
    }
    const delimiter = parsed.delimiter;
    if (!delimiter) {
      continue;
    }

    if (delimiter.kind === 'open') {
      if (stack.length === 0) {
        const freeform = freeformBlock(source, rootCursor, startOffset, rangeForOffsets);
        if (freeform) blocks.push(freeform);
      }
      stack.push({
        blockName: delimiter.blockName,
        attrs: delimiter.attrs,
        startOffset,
        openEndOffset: endOffset,
        innerBlocks: []
      });
      continue;
    }

    if (delimiter.kind === 'self-close') {
      if (stack.length === 0) {
        const freeform = freeformBlock(source, rootCursor, startOffset, rangeForOffsets);
        if (freeform) blocks.push(freeform);
      }
      const range = rangeForOffsets(startOffset, endOffset);
      const block: ParsedWordPressBlock = {
        blockName: delimiter.blockName,
        attrs: delimiter.attrs,
        innerBlocks: [],
        innerHtml: '',
        raw: source.slice(startOffset, endOffset),
        range,
        innerRange: rangeForOffsets(endOffset, endOffset),
        selfClosing: true
      };
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.innerBlocks.push(block);
      } else {
        blocks.push(block);
        rootCursor = endOffset;
      }
      continue;
    }

    const frame = stack[stack.length - 1];
    if (!frame) {
      diagnostics.push({
        code: 'unexpected-block-close',
        message: 'A WordPress block closes without a matching opening delimiter.',
        range: rangeForOffsets(startOffset, endOffset)
      });
      continue;
    }
    if (frame.blockName !== delimiter.blockName) {
      diagnostics.push({
        code: 'mismatched-block-close',
        message: `Expected ${frame.blockName} to close, but found ${delimiter.blockName}.`,
        range: rangeForOffsets(startOffset, endOffset)
      });
      continue;
    }

    stack.pop();
    const block: ParsedWordPressBlock = {
      blockName: frame.blockName,
      attrs: frame.attrs,
      innerBlocks: frame.innerBlocks,
      innerHtml: source.slice(frame.openEndOffset, startOffset),
      raw: source.slice(frame.startOffset, endOffset),
      range: rangeForOffsets(frame.startOffset, endOffset),
      innerRange: rangeForOffsets(frame.openEndOffset, startOffset),
      selfClosing: false
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.innerBlocks.push(block);
    } else {
      blocks.push(block);
      rootCursor = endOffset;
    }
  }

  stack.forEach(frame => {
    diagnostics.push({
      code: 'unclosed-block',
      message: `The WordPress block ${frame.blockName} is not closed.`,
      range: rangeForOffsets(frame.startOffset, source.length)
    });
  });

  if (stack.length === 0) {
    const freeform = freeformBlock(source, rootCursor, source.length, rangeForOffsets);
    if (freeform) blocks.push(freeform);
  }

  return {
    blocks,
    diagnostics,
    valid: diagnostics.length === 0
  };
}

function textToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToText(value: string): string {
  if (!value || value.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(value)) {
    throw new Error('The protected WordPress source payload is not valid base64.');
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function safeProtectedLabel(label: string | undefined): string | undefined {
  const normalized = label?.trim().toLowerCase();
  return normalized && /^[a-z0-9_\/-]+$/.test(normalized) ? normalized : undefined;
}

/** Encode arbitrary WordPress source into a non-executing Obsidian comment. */
export function protectWordPressSource(source: string, label?: string): string {
  const safeLabel = safeProtectedLabel(label);
  const payload = textToBase64(source).match(/.{1,76}/g)?.join('\n') ?? '';
  return [
    `%% wp-source:v${WORDPRESS_PROTECTED_SOURCE_VERSION}${safeLabel ? ' ' + safeLabel : ''}`,
    payload,
    '%%'
  ].join('\n');
}

function lineRecords(markdown: string): Array<{ text: string; start: number; end: number }> {
  const records: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  while (start < markdown.length) {
    const newline = markdown.indexOf('\n', start);
    const end = newline === -1 ? markdown.length : newline + 1;
    records.push({
      text: markdown.slice(start, newline === -1 ? end : newline).replace(/\r$/, ''),
      start,
      end
    });
    start = end;
  }
  if (markdown.length === 0) {
    return [];
  }
  return records;
}

/** Split protected sources without recognizing marker text inside Markdown fences. */
export function splitProtectedWordPressSources(
  markdown: string
): WordPressProtectedSourceSplitResult {
  const lines = lineRecords(markdown);
  const segments: WordPressProtectedSourceSegment[] = [];
  const errors: string[] = [];
  let markdownStart = 0;
  let fence: { marker: '`' | '~'; length: number } | null = null;

  const flushMarkdown = (end: number): void => {
    if (end > markdownStart) {
      segments.push({ kind: 'markdown', content: markdown.slice(markdownStart, end) });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.text.match(MARKDOWN_FENCE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[2][0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: fenceMatch[2].length };
      } else if (fence.marker === marker && fenceMatch[2].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) {
      continue;
    }
    const open = line.text.match(PROTECTED_OPEN_PATTERN);
    if (!open) {
      continue;
    }

    let closeIndex = index + 1;
    while (closeIndex < lines.length
      && !PROTECTED_CLOSE_PATTERN.test(lines[closeIndex].text)
    ) {
      closeIndex += 1;
    }
    if (closeIndex >= lines.length) {
      errors.push(`Protected WordPress source at line ${index + 1} is not closed.`);
      continue;
    }
    const payload = lines
      .slice(index + 1, closeIndex)
      .map(record => record.text.trim())
      .join('');
    try {
      const source = base64ToText(payload);
      flushMarkdown(line.start);
      segments.push({
        kind: 'wordpress-source',
        content: source,
        ...(safeProtectedLabel(open[1]) ? { label: safeProtectedLabel(open[1]) } : {})
      });
      markdownStart = lines[closeIndex].end;
      index = closeIndex;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  flushMarkdown(markdown.length);
  return { segments, errors };
}
