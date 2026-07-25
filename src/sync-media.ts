import {
  getMarkdownImages,
  buildUploadedImageReference
} from './media-metadata';
import type { MediaCache, MediaCacheEntry } from './media-cache';

export interface MediaSourceReplacement {
  sourceUrl: string;
  vaultPath: string;
}

export function normalizeRemoteMediaUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function mediaCacheEntryForUrl(
  cache: MediaCache | undefined,
  sourceUrl: string
): { contentHash: string, entry: MediaCacheEntry } | undefined {
  const normalized = normalizeRemoteMediaUrl(sourceUrl);
  return Object.entries(cache ?? {}).flatMap(([ contentHash, entry ]) => {
    const urls = [ entry.url, ...(entry.sourceUrls ?? []) ]
      .map(normalizeRemoteMediaUrl);
    return urls.includes(normalized) ? [ { contentHash, entry } ] : [];
  })[0];
}

export function remoteMarkdownImageUrls(markdown: string): string[] {
  return [ ...new Set(getMarkdownImages(markdown)
    .filter(image => image.srcIsUrl && /^https?:\/\//i.test(image.src))
    .map(image => image.src)) ];
}

export function rewriteMarkdownMediaSources(
  markdown: string,
  replacements: readonly MediaSourceReplacement[]
): string {
  const byUrl = new Map(replacements.map(item => [
    normalizeRemoteMediaUrl(item.sourceUrl),
    item.vaultPath
  ]));
  const edits = getMarkdownImages(markdown).flatMap(image => {
    const replacement = byUrl.get(normalizeRemoteMediaUrl(image.src));
    if (!replacement) return [];
    return [ {
      start: image.startIndex,
      end: image.endIndex,
      value: buildUploadedImageReference(
        image,
        replacement,
        { ...(image.altText ? { altText: image.altText } : {}) },
        true
      )
    } ];
  });
  let result = markdown;
  edits.reverse().forEach(edit => {
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  });
  return result;
}

export function safeRemoteMediaFileName(
  sourceUrl: string,
  detectedExtension?: string
): string {
  let raw = '';
  try {
    raw = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() ?? '');
  } catch {
    raw = sourceUrl.split(/[/?#]/).filter(Boolean).pop() ?? '';
  }
  raw = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const extension = detectedExtension?.replace(/^\./, '').toLowerCase();
  if (!raw) return 'wordpress-image' + (extension ? '.' + extension : '');
  if (extension && !/\.[a-z0-9]{2,10}$/i.test(raw)) {
    return raw + '.' + extension;
  }
  return raw;
}

export function collisionSafeMediaPath(
  folder: string,
  fileName: string,
  occupiedPaths: ReadonlySet<string>
): string {
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateName = suffix === 1
      ? fileName
      : `${stem}-${suffix}${extension}`;
    const candidate = normalizedFolder
      ? normalizedFolder + '/' + candidateName
      : candidateName;
    if (!occupiedPaths.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a collision-safe media file name.');
}

export function validSyncMediaFolder(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : normalized;
}
