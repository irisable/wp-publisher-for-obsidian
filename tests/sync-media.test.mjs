import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const { rememberDownloadedMedia } = await importTypescriptModule(
  new URL('../src/media-cache.ts', import.meta.url)
);
const {
  collisionSafeMediaPath,
  mediaCacheEntryForUrl,
  normalizeRemoteMediaUrl,
  remoteMarkdownImageUrls,
  rewriteMarkdownMediaSources,
  safeRemoteMediaFileName,
  validSyncMediaFolder
} = await importTypescriptModule(new URL('../src/sync-media.ts', import.meta.url));

test('matches equivalent cached media URLs and their observed aliases', () => {
  const cache = rememberDownloadedMedia(
    undefined,
    'hash',
    'cover.jpg',
    'https://example.com/media/cover.jpg#preview',
    'Attachments/cover.jpg',
    '42'
  );
  assert.equal(
    mediaCacheEntryForUrl(cache, 'https://example.com/media/cover.jpg')?.entry.vaultPath,
    'Attachments/cover.jpg'
  );
  assert.equal(
    normalizeRemoteMediaUrl('https://example.com/media/cover.jpg#preview'),
    'https://example.com/media/cover.jpg'
  );
});

test('rewrites only remote image sources while preserving alt, title, and wp-media data', () => {
  const markdown = [
    '![A cover](https://example.com/cover.jpg "Title")',
    '%% wp-media',
    'caption: Caption',
    '%%',
    '',
    '![Keep](local.png)'
  ].join('\n');
  assert.deepEqual(remoteMarkdownImageUrls(markdown), [
    'https://example.com/cover.jpg'
  ]);
  assert.equal(
    rewriteMarkdownMediaSources(markdown, [ {
      sourceUrl: 'https://example.com/cover.jpg',
      vaultPath: 'Attachments/My Cover.jpg'
    } ]),
    [
      '![A cover](<Attachments/My Cover.jpg> "Title")',
      '%% wp-media',
      'caption: Caption',
      '%%',
      '',
      '![Keep](local.png)'
    ].join('\n')
  );
});

test('allocates safe media names without overwriting an occupied path', () => {
  assert.equal(
    safeRemoteMediaFileName('https://example.com/a%20bad%3Aname', 'png'),
    'a bad-name.png'
  );
  assert.equal(
    collisionSafeMediaPath(
      'Attachments/WordPress',
      'cover.jpg',
      new Set([ 'Attachments/WordPress/cover.jpg' ])
    ),
    'Attachments/WordPress/cover-2.jpg'
  );
  assert.equal(validSyncMediaFolder(' /Attachments/WordPress/ '), 'Attachments/WordPress');
  assert.equal(validSyncMediaFolder('Attachments/../Secrets'), undefined);
});
