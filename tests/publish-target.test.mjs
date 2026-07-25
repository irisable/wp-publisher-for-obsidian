import assert from 'node:assert/strict';
import test from 'node:test';
import { determinePublishTarget, PublishTargetMode } from '../src/publish-target.ts';

test('creates a new post when no post ID is stored', () => {
  assert.deepEqual(determinePublishTarget({ profileName: 'old-site' }, 'current-site'), {
    mode: PublishTargetMode.Create,
    selectedProfileName: 'current-site'
  });
});

test('updates only when the post ID and selected profile match', () => {
  assert.deepEqual(determinePublishTarget({ postId: 35, profileName: 'current-site' }, 'current-site'), {
    mode: PublishTargetMode.Update,
    selectedProfileName: 'current-site',
    storedProfileName: 'current-site',
    postId: '35'
  });
});

test('surfaces profile mismatch without reusing the post ID', () => {
  assert.deepEqual(determinePublishTarget({ postId: '35', profileName: 'old-site' }, 'current-site'), {
    mode: PublishTargetMode.ProfileMismatch,
    selectedProfileName: 'current-site',
    storedProfileName: 'old-site',
    postId: '35'
  });
});

test('requires confirmation when a post ID has no profile', () => {
  assert.deepEqual(determinePublishTarget({ postId: '35' }, 'current-site'), {
    mode: PublishTargetMode.MissingProfile,
    selectedProfileName: 'current-site',
    postId: '35'
  });
});

test('rejects invalid WordPress post IDs', () => {
  for (const postId of [ 0, -1, '0', 'abc', '12.5' ]) {
    const target = determinePublishTarget({ postId, profileName: 'current-site' }, 'current-site');
    assert.equal(target.mode, PublishTargetMode.InvalidPostId);
    assert.equal(target.postId, undefined);
  }
});
