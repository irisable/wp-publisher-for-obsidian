import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findMultiSiteTarget,
  forgetProfileMultiSiteTargets,
  moveMultiSiteNoteTargets,
  normalizeMultiSiteTargets,
  rememberMultiSiteTarget
} from '../src/multi-site-targets.ts';

function target(profileId, postId, updatedAt = '2030-01-02T03:04:05Z') {
  return {
    profileId,
    profileName: 'Site ' + profileId,
    endpoint: 'https://' + profileId + '.example.com',
    postId,
    postType: 'post',
    updatedAt
  };
}

test('keeps a separate post target for each profile on the same note', () => {
  let store = {};
  store = rememberMultiSiteTarget(store, 'Articles/a.md', target('profile-a', '11'));
  store = rememberMultiSiteTarget(store, 'Articles/a.md', target('profile-b', '22'));
  assert.equal(findMultiSiteTarget(store, 'Articles/a.md', 'profile-a')?.postId, '11');
  assert.equal(findMultiSiteTarget(store, 'Articles/a.md', 'profile-b')?.postId, '22');
});

test('moves targets with a renamed note and keeps newer collisions', () => {
  const store = {
    'Old.md': { a: target('a', '1', '2030-01-02T00:00:00Z') },
    'New.md': {
      a: target('a', '2', '2030-01-03T00:00:00Z'),
      b: target('b', '3', '2030-01-01T00:00:00Z')
    }
  };
  const moved = moveMultiSiteNoteTargets(store, 'Old.md', 'New.md');
  assert.equal(moved['Old.md'], undefined);
  assert.equal(moved['New.md'].a.postId, '2');
  assert.equal(moved['New.md'].b.postId, '3');
});

test('drops malformed targets and can remove a deleted profile safely', () => {
  const normalized = normalizeMultiSiteTargets({
    'Article.md': {
      valid: target('valid', '42'),
      invalid: { profileId: 'invalid', postId: 'not-an-id' }
    }
  });
  assert.deepEqual(Object.keys(normalized['Article.md']), [ 'valid' ]);
  assert.deepEqual(forgetProfileMultiSiteTargets(normalized, 'valid'), {});
});
