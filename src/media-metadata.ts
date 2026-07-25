export interface MediaMetadata {
  title?: string;
  altText?: string;
  caption?: string;
  description?: string;
}

export type MediaMetadataMap = Record<string, MediaMetadata>;

export interface MarkdownImageReference {
  original: string;
  syntax: 'markdown' | 'obsidian';
  src: string;
  altText?: string;
  markdownTitle?: string;
  width?: string;
  height?: string;
  srcIsUrl: boolean;
  startIndex: number;
  endIndex: number;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

export interface ImageCaptionMetadata {
  title?: string;
  caption: string;
}

export function imageCaptionsFromMetadata(
  metadataMap: MediaMetadataMap | undefined
): Record<string, ImageCaptionMetadata> {
  const captions: Record<string, ImageCaptionMetadata> = {};
  Object.entries(metadataMap ?? {}).forEach(([ source, metadata ]) => {
    const caption = optionalText(metadata.caption);
    const title = optionalText(metadata.title);
    if (caption) {
      captions[source] = {
        ...(title ? { title } : {}),
        caption
      };
    }
  });
  return captions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMediaPath(value: string): string {
  let normalized = value.trim().replace(/\\/g, '/');
  if (normalized.startsWith('[[') && normalized.endsWith(']]')) {
    normalized = normalized.slice(2, -2).trim();
  }
  if (normalized.startsWith('<') && normalized.endsWith('>')) {
    normalized = normalized.slice(1, -1).trim();
  }
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  try {
    return decodeURI(normalized);
  } catch {
    return normalized;
  }
}

function normalizeMetadata(value: unknown): MediaMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const metadata: MediaMetadata = {};
  const title = optionalText(value.title);
  const altText = optionalText(value.altText) ?? optionalText(value.alt);
  const caption = optionalText(value.caption);
  const description = optionalText(value.description);
  if (title) metadata.title = title;
  if (altText) metadata.altText = altText;
  if (caption) metadata.caption = caption;
  if (description) metadata.description = description;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

interface SourceLine {
  start: number;
  end: number;
  text: string;
}

interface MediaMetadataBlock {
  start: number;
  end: number;
  metadata: MediaMetadata;
}

export interface ExtractedMediaMetadata {
  content: string;
  metadataMap: MediaMetadataMap;
}

function sourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < content.length) {
    const newline = content.indexOf('\n', start);
    const end = newline >= 0 ? newline + 1 : content.length;
    lines.push({
      start,
      end,
      text: content.slice(start, newline >= 0 ? newline : content.length)
        .replace(/\r$/, '')
    });
    start = end;
  }
  return lines;
}

function parseMetadataLines(lines: readonly SourceLine[]): MediaMetadata {
  const raw: Record<string, string> = {};
  lines.forEach(line => {
    const match = line.text.match(
      /^\s*(title|alt(?:[\s_-]*text)?|caption|description)\s*[:：]\s*(.*?)\s*$/i
    );
    if (!match) return;
    const normalizedKey = match[1].toLowerCase().replace(/[\s_-]/g, '');
    const key = normalizedKey === 'alt' || normalizedKey === 'alttext'
      ? 'altText'
      : normalizedKey;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    raw[key] = value;
  });
  return normalizeMetadata(raw) ?? {};
}

function mediaMetadataBlocks(content: string): MediaMetadataBlock[] {
  const lines = sourceLines(content);
  const blocks: MediaMetadataBlock[] = [];
  let fence: { character: string; length: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (fence) {
      const closingFence = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closingFence
        && closingFence[1][0] === fence.character
        && closingFence[1].length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      fence = {
        character: openingFence[1][0],
        length: openingFence[1].length
      };
      continue;
    }
    if (!/^\s*%%\s+wp-media\s*$/i.test(line)) {
      continue;
    }

    let closingIndex = index + 1;
    while (closingIndex < lines.length
      && !/^\s*%%\s*$/.test(lines[closingIndex].text)
    ) {
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) {
      continue;
    }
    blocks.push({
      start: lines[index].start,
      end: lines[closingIndex].end,
      metadata: parseMetadataLines(lines.slice(index + 1, closingIndex))
    });
    index = closingIndex;
  }
  return blocks;
}

function resolveCaptionAltReference(
  metadata: MediaMetadata,
  image: MarkdownImageReference
): MediaMetadata {
  if (metadata.caption !== '=alt') {
    return metadata;
  }
  const resolved = { ...metadata };
  const caption = optionalText(metadata.altText) ?? optionalText(image.altText);
  if (caption) {
    resolved.caption = caption;
  } else {
    delete resolved.caption;
  }
  return resolved;
}

/** Extract image-adjacent metadata comments and remove them from publish content. */
export function extractMediaMetadataBlocks(content: string): ExtractedMediaMetadata {
  const images = getMarkdownImages(content);
  const blocks = mediaMetadataBlocks(content);
  const metadataMap: MediaMetadataMap = {};

  blocks.forEach(block => {
    let image: MarkdownImageReference | undefined;
    for (let index = images.length - 1; index >= 0; index -= 1) {
      const candidate = images[index];
      if (candidate.endIndex <= block.start
        && /^\s*$/.test(content.slice(candidate.endIndex, block.start))
      ) {
        image = candidate;
        break;
      }
    }
    const path = image ? normalizeMediaPath(image.src) : '';
    const metadata = image
      ? resolveCaptionAltReference(block.metadata, image)
      : block.metadata;
    if (path && Object.keys(metadata).length > 0) {
      metadataMap[path] = { ...metadataMap[path], ...metadata };
    }
  });

  let publishContent = content;
  blocks.slice().reverse().forEach(block => {
    publishContent = publishContent.slice(0, block.start)
      + publishContent.slice(block.end);
  });
  return { content: publishContent, metadataMap };
}

function fileTitle(fileName: string): string | undefined {
  const normalized = fileName.trim();
  const extensionIndex = normalized.lastIndexOf('.');
  const title = extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized;
  return title || undefined;
}

interface MediaMetadataLookupParams {
  metadataMap?: MediaMetadataMap;
  sourcePath: string;
  vaultPath: string;
  fileName: string;
}

function configuredMediaMetadata(
  params: MediaMetadataLookupParams
): MediaMetadata | undefined {
  const candidates = [ params.sourcePath, params.vaultPath, params.fileName ]
    .map(normalizeMediaPath);
  return candidates
    .map(candidate => params.metadataMap?.[candidate])
    .find((metadata): metadata is MediaMetadata => metadata !== undefined);
}

export function resolveMediaMetadata(params: MediaMetadataLookupParams & {
  inlineAltText?: string;
  inlineTitle?: string;
}): MediaMetadata {
  const automatic: MediaMetadata = {};
  const title = optionalText(params.inlineTitle) ?? fileTitle(params.fileName);
  const altText = optionalText(params.inlineAltText);
  if (title) automatic.title = title;
  if (altText) automatic.altText = altText;

  const configured = configuredMediaMetadata(params);
  return configured ? { ...automatic, ...configured } : automatic;
}

export function resolveImageCaptionMetadata(
  params: MediaMetadataLookupParams & {
    metadata: MediaMetadata;
    inlineTitle?: string;
  }
): ImageCaptionMetadata | undefined {
  const caption = optionalText(params.metadata.caption);
  if (!caption) {
    return undefined;
  }
  const configured = configuredMediaMetadata(params);
  const title = optionalText(configured?.title) ?? optionalText(params.inlineTitle);
  return {
    ...(title ? { title } : {}),
    caption
  };
}

const METADATA_FIELDS = [ 'title', 'altText', 'caption', 'description' ] as const;

export function mediaMetadataNeedsUpdate(
  applied: MediaMetadata | undefined,
  requested: MediaMetadata
): boolean {
  return METADATA_FIELDS.some(field => (
    requested[field] !== undefined && requested[field] !== applied?.[field]
  ));
}

export function mergeMediaMetadata(
  applied: MediaMetadata | undefined,
  requested: MediaMetadata
): MediaMetadata {
  return { ...applied, ...requested };
}

export function buildRestMediaMetadata(
  metadata: MediaMetadata
): Record<string, string> {
  return {
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.altText ? { alt_text: metadata.altText } : {}),
    ...(metadata.caption ? { caption: metadata.caption } : {}),
    ...(metadata.description ? { description: metadata.description } : {})
  };
}

export function buildWpComMediaMetadata(
  metadata: MediaMetadata
): Record<string, string> {
  return {
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.altText ? { alt: metadata.altText } : {}),
    ...(metadata.caption ? { caption: metadata.caption } : {}),
    ...(metadata.description ? { description: metadata.description } : {})
  };
}

function isRemoteMediaSource(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src) || /^(?:data|blob):/i.test(src);
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\[\]()])/g, '$1');
}

function splitAltAndSize(rawAlt: string): {
  altText?: string;
  width?: string;
  height?: string;
} {
  const onlySize = rawAlt.match(/^\s*(\d+)(?:x(\d+))?\s*$/);
  const suffixSize = rawAlt.match(/^(.*)\|(\d+)(?:x(\d+))?\s*$/);
  if (onlySize) {
    return { width: onlySize[1], height: onlySize[2] };
  }
  if (suffixSize) {
    return {
      altText: optionalText(unescapeMarkdown(suffixSize[1])),
      width: suffixSize[2],
      height: suffixSize[3]
    };
  }
  return { altText: optionalText(unescapeMarkdown(rawAlt)) };
}

function splitMarkdownDestination(value: string): {
  src: string;
  markdownTitle?: string;
} | undefined {
  const normalized = value.trim();
  const titleMatch = normalized.match(
    /^(.*?)(?:\s+)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|\(((?:\\.|[^)\\])*)\))\s*$/
  );
  let src = titleMatch ? titleMatch[1].trim() : normalized;
  const markdownTitle = titleMatch
    ? optionalText(unescapeMarkdown(titleMatch[2] ?? titleMatch[3] ?? titleMatch[4] ?? ''))
    : undefined;
  if (src.startsWith('<') && src.endsWith('>')) {
    src = src.slice(1, -1).trim();
  }
  return src ? { src: unescapeMarkdown(src), markdownTitle } : undefined;
}

function findClosingBracket(content: string, start: number): number {
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === '\\') {
      index += 1;
    } else if (content[index] === ']') {
      return index;
    }
  }
  return -1;
}

function findClosingParenthesis(content: string, start: number): number {
  let depth = 1;
  let quote: string | undefined;
  let inAngleDestination = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '<' && depth === 1) {
      inAngleDestination = true;
    } else if (character === '>' && inAngleDestination) {
      inAngleDestination = false;
    } else if (!inAngleDestination && character === '(') {
      depth += 1;
    } else if (!inAngleDestination && character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Parse the two image syntaxes handled by the publish pipeline. */
export function getMarkdownImages(content: string): MarkdownImageReference[] {
  const images: MarkdownImageReference[] = [];
  for (let startIndex = content.indexOf('!['); startIndex >= 0;) {
    if (content.startsWith('![[', startIndex)) {
      const endIndex = content.indexOf(']]', startIndex + 3);
      if (endIndex >= 0) {
        const inner = content.slice(startIndex + 3, endIndex);
        const sizeMatch = inner.match(/^(.*)\|(\d+)(?:x(\d+))?\s*$/);
        const src = (sizeMatch ? sizeMatch[1] : inner).trim();
        if (src) {
          images.push({
            original: content.slice(startIndex, endIndex + 2),
            syntax: 'obsidian',
            src,
            width: sizeMatch?.[2],
            height: sizeMatch?.[3],
            srcIsUrl: isRemoteMediaSource(src),
            startIndex,
            endIndex: endIndex + 2
          });
        }
        startIndex = content.indexOf('![', endIndex + 2);
        continue;
      }
    } else {
      const altEnd = findClosingBracket(content, startIndex + 2);
      if (altEnd >= 0 && content[altEnd + 1] === '(') {
        const destinationEnd = findClosingParenthesis(content, altEnd + 2);
        if (destinationEnd >= 0) {
          const destination = splitMarkdownDestination(
            content.slice(altEnd + 2, destinationEnd)
          );
          if (destination) {
            const alt = splitAltAndSize(content.slice(startIndex + 2, altEnd));
            images.push({
              original: content.slice(startIndex, destinationEnd + 1),
              syntax: 'markdown',
              src: destination.src,
              altText: alt.altText,
              markdownTitle: destination.markdownTitle,
              width: alt.width,
              height: alt.height,
              srcIsUrl: isRemoteMediaSource(destination.src),
              startIndex,
              endIndex: destinationEnd + 1
            });
          }
          startIndex = content.indexOf('![', destinationEnd + 1);
          continue;
        }
      }
    }
    startIndex = content.indexOf('![', startIndex + 2);
  }
  return images.sort((left, right) => left.startIndex - right.startIndex);
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildStandardImage(
  image: MarkdownImageReference,
  url: string,
  altText: string
): string {
  const size = image.width
    ? `${image.width}${image.height ? `x${image.height}` : ''}`
    : undefined;
  const alt = size
    ? (altText ? `${escapeMarkdownAlt(altText)}|${size}` : size)
    : escapeMarkdownAlt(altText);
  const title = image.markdownTitle
    ? ` "${escapeMarkdownTitle(image.markdownTitle)}"`
    : '';
  const destination = /[\s()<>]/.test(url)
    ? '<' + url.replace(/</g, '%3C').replace(/>/g, '%3E') + '>'
    : url;
  return `![${alt}](${destination}${title})`;
}

function buildObsidianImage(image: MarkdownImageReference, url: string): string {
  const size = image.width
    ? `|${image.width}${image.height ? `x${image.height}` : ''}`
    : '';
  return `![[${url}${size}]]`;
}

/** Build the publish-time image reference while preserving alt text and dimensions. */
export function buildUploadedImageReference(
  image: MarkdownImageReference,
  url: string,
  metadata: MediaMetadata,
  preserveObsidianSyntax = false
): string {
  if (image.syntax === 'obsidian' && (preserveObsidianSyntax || !metadata.altText)) {
    return buildObsidianImage(image, url);
  }
  return buildStandardImage(image, url, metadata.altText ?? image.altText ?? '');
}
