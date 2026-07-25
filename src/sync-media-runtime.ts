import {
  normalizePath,
  requestUrl,
  TFile,
  type App
} from 'obsidian';
import fileTypeChecker from 'file-type-checker';
import {
  mediaContentHash,
  rememberDownloadedMedia,
  type MediaCache,
  type MediaCacheEntry
} from './media-cache';
import {
  collisionSafeMediaPath,
  mediaCacheEntryForUrl,
  normalizeRemoteMediaUrl,
  remoteMarkdownImageUrls,
  rewriteMarkdownMediaSources,
  safeRemoteMediaFileName,
  validSyncMediaFolder,
  type MediaSourceReplacement
} from './sync-media';
import type { RemoteFeaturedMedia } from './remote-post';

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_DOWNLOAD_BYTES = 80 * 1024 * 1024;

export interface PreparedMediaDownload {
  sourceUrl: string;
  contentHash: string;
  content: ArrayBuffer;
  fileName: string;
  vaultPath: string;
  create: boolean;
  attachmentId?: string;
}

export interface PreparedMediaRoundTrip {
  markdown: string;
  featuredImage?: string;
  replacements: MediaSourceReplacement[];
  downloads: PreparedMediaDownload[];
  restoredCount: number;
  downloadCount: number;
  folder?: string;
}

async function validCachedFile(
  app: App,
  notePath: string,
  contentHash: string,
  entry: MediaCacheEntry
): Promise<TFile | undefined> {
  const paths = [ entry.vaultPath ].filter((path): path is string => Boolean(path));
  const linked = app.metadataCache.getFirstLinkpathDest(entry.fileName, notePath);
  if (linked instanceof TFile && !paths.includes(linked.path)) paths.push(linked.path);
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) continue;
    const content = await app.vault.readBinary(file);
    if (await mediaContentHash(content) === contentHash) return file;
  }
  return undefined;
}

async function cachedReplacements(options: {
  app: App;
  notePath: string;
  cache?: MediaCache;
  urls: readonly string[];
}): Promise<MediaSourceReplacement[]> {
  const replacements: MediaSourceReplacement[] = [];
  for (const sourceUrl of options.urls) {
    const cached = mediaCacheEntryForUrl(options.cache, sourceUrl);
    if (!cached) continue;
    const file = await validCachedFile(
      options.app,
      options.notePath,
      cached.contentHash,
      cached.entry
    );
    if (file) replacements.push({ sourceUrl, vaultPath: file.path });
  }
  return replacements;
}

export async function restoreCachedRemoteMedia(options: {
  app: App;
  notePath: string;
  cache?: MediaCache;
  markdown: string;
  featuredMedia?: RemoteFeaturedMedia;
}): Promise<PreparedMediaRoundTrip> {
  const urls = [
    ...remoteMarkdownImageUrls(options.markdown),
    ...(options.featuredMedia?.url ? [ options.featuredMedia.url ] : [])
  ];
  const replacements = await cachedReplacements({ ...options, urls });
  const byUrl = new Map(replacements.map(item => [
    normalizeRemoteMediaUrl(item.sourceUrl),
    item.vaultPath
  ]));
  return {
    markdown: rewriteMarkdownMediaSources(options.markdown, replacements),
    ...(options.featuredMedia?.url
      ? { featuredImage: byUrl.get(normalizeRemoteMediaUrl(options.featuredMedia.url))
          ?? options.featuredMedia.url }
      : {}),
    replacements,
    downloads: [],
    restoredCount: replacements.length,
    downloadCount: 0
  };
}

async function existingFileByHash(
  app: App,
  folder: string,
  contentHash: string,
  memo: Map<string, string>
): Promise<TFile | undefined> {
  const known = memo.get(contentHash);
  if (known) {
    const file = app.vault.getAbstractFileByPath(known);
    return file instanceof TFile ? file : undefined;
  }
  const prefix = folder + '/';
  for (const file of app.vault.getFiles()) {
    if (file.path !== folder && !file.path.startsWith(prefix)) continue;
    const hash = await mediaContentHash(await app.vault.readBinary(file));
    memo.set(hash, file.path);
    if (hash === contentHash) return file;
  }
  return undefined;
}

export async function prepareRemoteMediaDownloads(options: {
  app: App;
  notePath: string;
  cache?: MediaCache;
  folder: string;
  markdown: string;
  featuredMedia?: RemoteFeaturedMedia;
}): Promise<PreparedMediaRoundTrip> {
  const folder = validSyncMediaFolder(options.folder);
  if (!folder) throw new Error('A valid Vault media folder is required.');
  const restored = await restoreCachedRemoteMedia(options);
  const alreadyMapped = new Set(restored.replacements.map(item => (
    normalizeRemoteMediaUrl(item.sourceUrl)
  )));
  const urls = [
    ...remoteMarkdownImageUrls(options.markdown),
    ...(options.featuredMedia?.url ? [ options.featuredMedia.url ] : [])
  ].filter(url => !alreadyMapped.has(normalizeRemoteMediaUrl(url)));
  const uniqueUrls = [ ...new Set(urls) ];
  const occupied = new Set(options.app.vault.getFiles().map(file => file.path));
  const hashMemo = new Map<string, string>();
  const downloads: PreparedMediaDownload[] = [];
  const replacements = [ ...restored.replacements ];
  let totalBytes = 0;

  for (const sourceUrl of uniqueUrls) {
    const response = await requestUrl({ url: sourceUrl, method: 'GET' });
    const content = response.arrayBuffer;
    totalBytes += content.byteLength;
    if (content.byteLength > MAX_DOWNLOAD_BYTES || totalBytes > MAX_TOTAL_DOWNLOAD_BYTES) {
      throw new Error('Remote media exceeds the bounded download size.');
    }
    const detected = fileTypeChecker.detectFile(content);
    if (!detected?.mimeType.startsWith('image/')) {
      throw new Error('Remote media is not a recognized image: ' + sourceUrl);
    }
    const contentHash = await mediaContentHash(content);
    const existing = await existingFileByHash(
      options.app,
      folder,
      contentHash,
      hashMemo
    );
    const fileName = safeRemoteMediaFileName(sourceUrl, detected.extension);
    const vaultPath = existing?.path ?? collisionSafeMediaPath(folder, fileName, occupied);
    occupied.add(vaultPath);
    const attachmentId = options.featuredMedia?.url
      && normalizeRemoteMediaUrl(options.featuredMedia.url)
        === normalizeRemoteMediaUrl(sourceUrl)
      ? options.featuredMedia.id
      : undefined;
    downloads.push({
      sourceUrl,
      contentHash,
      content,
      fileName: vaultPath.split('/').pop() ?? fileName,
      vaultPath,
      create: !existing,
      ...(attachmentId ? { attachmentId } : {})
    });
    replacements.push({ sourceUrl, vaultPath });
  }
  const byUrl = new Map(replacements.map(item => [
    normalizeRemoteMediaUrl(item.sourceUrl),
    item.vaultPath
  ]));
  return {
    markdown: rewriteMarkdownMediaSources(options.markdown, replacements),
    ...(options.featuredMedia?.url
      ? { featuredImage: byUrl.get(normalizeRemoteMediaUrl(options.featuredMedia.url))
          ?? options.featuredMedia.url }
      : {}),
    replacements,
    downloads,
    restoredCount: restored.restoredCount,
    downloadCount: downloads.filter(item => item.create).length,
    folder
  };
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  let current = '';
  for (const segment of folder.split('/')) {
    current = current ? current + '/' + segment : segment;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

export async function commitPreparedMediaDownloads(options: {
  app: App;
  cache?: MediaCache;
  plan: PreparedMediaRoundTrip;
}): Promise<{ cache: MediaCache, createdPaths: string[] }> {
  if (options.plan.folder) await ensureFolder(options.app, options.plan.folder);
  const createdPaths: string[] = [];
  let cache = { ...options.cache };
  try {
    for (const item of options.plan.downloads) {
      const existing = options.app.vault.getAbstractFileByPath(item.vaultPath);
      if (item.create) {
        if (existing) throw new Error('A media destination changed after review.');
        await options.app.vault.createBinary(item.vaultPath, item.content);
        createdPaths.push(item.vaultPath);
      } else {
        if (!(existing instanceof TFile)
          || await mediaContentHash(await options.app.vault.readBinary(existing))
            !== item.contentHash
        ) {
          throw new Error('A deduplicated media file changed after review.');
        }
      }
      cache = rememberDownloadedMedia(
        cache,
        item.contentHash,
        item.fileName,
        item.sourceUrl,
        item.vaultPath,
        item.attachmentId
      );
    }
    return { cache, createdPaths };
  } catch (error) {
    await rollbackCreatedMediaDownloads(options.app, createdPaths);
    throw error;
  }
}

export async function removeDownloadedMediaAfterUndo(
  app: App,
  media: readonly { vaultPath: string, contentHash: string }[]
): Promise<string[]> {
  const removedHashes: string[] = [];
  for (const item of media) {
    const file = app.vault.getAbstractFileByPath(item.vaultPath);
    if (!(file instanceof TFile)) continue;
    const hash = await mediaContentHash(await app.vault.readBinary(file));
    if (hash !== item.contentHash) continue;
    await app.fileManager.trashFile(file);
    removedHashes.push(item.contentHash);
  }
  return removedHashes;
}

export async function rollbackCreatedMediaDownloads(
  app: App,
  paths: readonly string[]
): Promise<void> {
  for (const path of [ ...paths ].reverse()) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      try {
        await app.fileManager.trashFile(file);
      } catch (error) {
        console.error('Could not remove a staged WordPress media download.', error);
      }
    }
  }
}
