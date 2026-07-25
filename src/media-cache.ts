import type { WordPressMediaUploadResult } from './wp-client';
import type { MediaMetadata } from './media-metadata';

export interface MediaCacheEntry extends WordPressMediaUploadResult {
  contentHash: string;
  fileName: string;
  metadata?: MediaMetadata;
  /** Last validated Vault source for restoring remote media links. */
  vaultPath?: string;
  /** Equivalent remote URLs observed for the same bytes. */
  sourceUrls?: string[];
}

export type MediaCache = Record<string, MediaCacheEntry>;

const MAX_MEDIA_CACHE_ENTRIES = 500;

function boundMediaCache(cache: MediaCache): MediaCache {
  const hashes = Object.keys(cache);
  for (const hash of hashes.slice(0, Math.max(0, hashes.length - MAX_MEDIA_CACHE_ENTRIES))) {
    delete cache[hash];
  }
  return cache;
}

function hasAttachmentId(id: string | number | undefined): boolean {
  const numericId = Number(id);
  return Number.isSafeInteger(numericId) && numericId > 0;
}

/** Build a stable fingerprint so renamed or repeated Vault files share one upload. */
export async function mediaContentHash(content: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', content);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function findCachedMedia(
  cache: MediaCache | undefined,
  contentHash: string,
  requireAttachmentId = false
): MediaCacheEntry | undefined {
  const entry = cache?.[contentHash];
  if (!entry?.url || entry.contentHash !== contentHash) {
    return undefined;
  }
  if (requireAttachmentId && !hasAttachmentId(entry.id)) {
    return undefined;
  }
  return entry;
}

export function forgetCachedMedia(
  cache: MediaCache | undefined,
  contentHash: string
): MediaCache {
  const next = { ...cache };
  delete next[contentHash];
  return next;
}

export function rememberMediaUpload(
  cache: MediaCache | undefined,
  contentHash: string,
  fileName: string,
  media: WordPressMediaUploadResult,
  metadata?: MediaMetadata,
  vaultPath?: string
): MediaCache {
  const next = { ...cache };
  delete next[contentHash];
  next[contentHash] = {
    contentHash,
    fileName,
    url: media.url,
    id: media.id,
    ...(metadata ? { metadata } : {}),
    ...(vaultPath ? { vaultPath } : {}),
    sourceUrls: [ media.url ]
  };

  return boundMediaCache(next);
}

export function rememberDownloadedMedia(
  cache: MediaCache | undefined,
  contentHash: string,
  fileName: string,
  sourceUrl: string,
  vaultPath: string,
  attachmentId?: string
): MediaCache {
  const existing = cache?.[contentHash];
  const sourceUrls = [ ...new Set([
    ...(existing?.sourceUrls ?? []),
    ...(existing?.url ? [ existing.url ] : []),
    sourceUrl
  ]) ];
  const next = { ...cache };
  delete next[contentHash];
  next[contentHash] = {
    ...(existing ?? {
      contentHash,
      fileName,
      url: sourceUrl
    }),
    fileName,
    vaultPath,
    sourceUrls,
    ...(attachmentId ? { id: attachmentId } : {})
  };
  return boundMediaCache(next);
}

export function rememberMediaMetadata(
  cache: MediaCache | undefined,
  contentHash: string,
  metadata: MediaMetadata
): MediaCache {
  const entry = cache?.[contentHash];
  if (!entry) {
    return { ...cache };
  }
  return {
    ...cache,
    [contentHash]: {
      ...entry,
      metadata: { ...entry.metadata, ...metadata }
    }
  };
}
