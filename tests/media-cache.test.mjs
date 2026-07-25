import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findCachedMedia,
  forgetCachedMedia,
  mediaContentHash,
  rememberDownloadedMedia,
  rememberMediaMetadata,
  rememberMediaUpload
} from '../src/media-cache.ts';

test('creates a stable SHA-256 fingerprint for media content', async () => {
  const content = new TextEncoder().encode('hello').buffer;
  assert.equal(
    await mediaContentHash(content),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
});

test('reuses cached uploads by content even when the file name changes', () => {
  const cache = rememberMediaUpload(
    undefined,
    'same-content',
    'original.png',
    { url: 'https://example.com/original.png', id: 42 }
  );

  assert.deepEqual(findCachedMedia(cache, 'same-content'), {
    contentHash: 'same-content',
    fileName: 'original.png',
    url: 'https://example.com/original.png',
    id: 42,
    sourceUrls: [ 'https://example.com/original.png' ]
  });
  assert.equal(findCachedMedia(cache, 'changed-content'), undefined);
});

test('requires a valid WordPress attachment ID for featured images', () => {
  const withoutId = rememberMediaUpload(
    undefined,
    'body-image',
    'body.png',
    { url: 'https://example.com/body.png' }
  );
  assert.ok(findCachedMedia(withoutId, 'body-image'));
  assert.equal(findCachedMedia(withoutId, 'body-image', true), undefined);

  const withId = rememberMediaUpload(
    withoutId,
    'featured-image',
    'featured.png',
    { url: 'https://example.com/featured.png', id: '35' }
  );
  assert.equal(findCachedMedia(withId, 'featured-image', true)?.id, '35');
});

test('forgets only the stale upload when WordPress no longer has it', () => {
  const cache = {
    stale: {
      contentHash: 'stale',
      fileName: 'deleted.png',
      url: 'https://example.com/deleted.png',
      id: 41
    },
    valid: {
      contentHash: 'valid',
      fileName: 'valid.png',
      url: 'https://example.com/valid.png',
      id: 42
    }
  };

  assert.deepEqual(forgetCachedMedia(cache, 'stale'), {
    valid: cache.valid
  });
  assert.ok(cache.stale);
});

test('tracks successfully applied attachment metadata on cached uploads', () => {
  const cache = rememberMediaUpload(
    undefined,
    'metadata-image',
    'cover.jpg',
    { url: 'https://example.com/cover.jpg', id: 42 },
    { title: 'Cover' }
  );
  const updated = rememberMediaMetadata(cache, 'metadata-image', {
    altText: 'Cover artwork'
  });

  assert.deepEqual(updated['metadata-image'].metadata, {
    title: 'Cover',
    altText: 'Cover artwork'
  });
});


test('bounds downloaded media mappings and keeps the newest entries', () => {
  let cache;
  for (let index = 0; index < 501; index += 1) {
    cache = rememberDownloadedMedia(
      cache,
      'hash-' + index,
      'image-' + index + '.jpg',
      'https://example.com/image-' + index + '.jpg',
      'Attachments/image-' + index + '.jpg'
    );
  }
  assert.equal(Object.keys(cache).length, 500);
  assert.equal(cache['hash-0'], undefined);
  assert.equal(cache['hash-500'].vaultPath, 'Attachments/image-500.jpg');
});
