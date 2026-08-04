import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  resolveProfilePublishingDefaults,
  resolvePublishingTags,
  selectAvailablePostType
} = await importTypescriptModule(
  new URL('../src/profile-publishing-defaults.ts', import.meta.url)
);

const globalDefaults = {
  status: 'draft',
  commentStatus: 'open'
};

test('inherits global defaults when a profile has no overrides', () => {
  assert.deepEqual(resolveProfilePublishingDefaults({}, globalDefaults), {
    status: 'draft',
    commentStatus: 'open',
    postType: 'post',
    tags: []
  });
});

test('normalizes structured profile publishing defaults', () => {
  assert.deepEqual(resolveProfilePublishingDefaults({
    publishDefaults: {
      status: 'private',
      commentStatus: 'closed',
      postType: ' portfolio ',
      tags: [ 'notes, featured', 'featured', ' 中文 ' ]
    }
  }, globalDefaults), {
    status: 'private',
    commentStatus: 'closed',
    postType: 'portfolio',
    tags: [ 'notes', 'featured', '中文' ]
  });
});

test('uses canonical WordPress tags before defaults and legacy tags', () => {
  assert.deepEqual(resolvePublishingTags({}, [ 'profile' ]), [ 'profile' ]);
  assert.deepEqual(resolvePublishingTags({ wpTags: 'note, local' }, [ 'profile' ]), [
    'note',
    'local'
  ]);
  assert.deepEqual(resolvePublishingTags({ tags: 'legacy' }, [ 'profile' ]), [
    'legacy'
  ]);
  assert.deepEqual(resolvePublishingTags({
    wpTags: [],
    tags: [ 'obsidian-only' ]
  }, [ 'profile' ]), []);
});

test('uses only post types reported by the selected WordPress site', () => {
  assert.equal(selectAvailablePostType('portfolio', [ 'post', 'page', 'portfolio' ]), 'portfolio');
  assert.equal(selectAvailablePostType('missing', [ 'post', 'page' ]), 'post');
  assert.equal(selectAvailablePostType('missing', [ 'product', 'page' ]), 'product');
});
