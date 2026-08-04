import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const { buildCoordinatedPostParams } = await importTypescriptModule(
  new URL('../src/coordinated-publish.ts', import.meta.url)
);

const profile = {
  publishDefaults: {
    status: 'private',
    commentStatus: 'closed',
    postType: 'story',
    tags: [ 'profile-tag' ]
  },
  lastSelectedCategories: [ 7 ]
};

const globalDefaults = { status: 'draft', commentStatus: 'open' };

test('uses per-profile defaults for a new coordinated publish', () => {
  const result = buildCoordinatedPostParams({
    profile,
    globalDefaults,
    matter: {}
  });
  assert.equal(result.status, 'private');
  assert.equal(result.commentStatus, 'closed');
  assert.equal(result.postType, 'story');
  assert.deepEqual(result.tags, [ 'profile-tag' ]);
  assert.deepEqual(result.categories, [ 7 ]);
  assert.equal(result.updateStrategy, 'full');
});

test('applies templates and note WordPress tags while retaining an existing target type', () => {
  const result = buildCoordinatedPostParams({
    profile,
    globalDefaults,
    matter: {
      wpTags: [ 'note-tag' ],
      tags: [ 'vault/topic' ],
      wpPostType: 'wrong-flat-type'
    },
    template: {
      id: 'template',
      name: 'Public',
      status: 'publish',
      commentStatus: 'open',
      postType: 'post',
      tags: [ 'template-tag' ]
    },
    target: {
      profileId: 'profile',
      profileName: 'Site',
      endpoint: 'https://example.com',
      postId: '42',
      postType: 'article',
      updatedAt: '2030-01-02T00:00:00Z'
    },
    updateStrategy: 'content-only'
  });
  assert.equal(result.status, 'publish');
  assert.equal(result.postType, 'article');
  assert.deepEqual(result.tags, [ 'note-tag' ]);
  assert.equal(result.updateStrategy, 'content-only');
});
