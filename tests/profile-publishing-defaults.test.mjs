import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveProfilePublishingDefaults,
  resolvePublishingTags,
  selectAvailablePostType
} from '../src/profile-publishing-defaults.ts';

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

test('uses profile tags only when the note does not define tags', () => {
  assert.deepEqual(resolvePublishingTags({}, [ 'profile' ]), [ 'profile' ]);
  assert.deepEqual(resolvePublishingTags({ tags: 'note, local' }, [ 'profile' ]), [
    'note',
    'local'
  ]);
  assert.deepEqual(resolvePublishingTags({ tags: [] }, [ 'profile' ]), []);
});

test('uses only post types reported by the selected WordPress site', () => {
  assert.equal(selectAvailablePostType('portfolio', [ 'post', 'page', 'portfolio' ]), 'portfolio');
  assert.equal(selectAvailablePostType('missing', [ 'post', 'page' ]), 'post');
  assert.equal(selectAvailablePostType('missing', [ 'product', 'page' ]), 'product');
});
