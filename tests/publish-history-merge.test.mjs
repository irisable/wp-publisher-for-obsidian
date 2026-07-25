import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPublishHistoryEntry,
  normalizePublishHistory,
  PublishHistoryAction,
  PublishHistoryOutcome
} from '../src/publish-history.ts';

test('stores merge outcomes as a distinct searchable activity action', () => {
  const entry = createPublishHistoryEntry({
    id: 'merge-1',
    timestamp: '2026-07-21T10:00:00.000Z',
    outcome: PublishHistoryOutcome.Success,
    action: PublishHistoryAction.Merge,
    notePath: 'posts/example.md',
    noteTitle: 'Example',
    profileName: 'Production',
    profileId: 'production',
    endpoint: 'https://example.com',
    postType: 'post',
    postId: '42',
    selectedFieldCount: 8
  });
  assert.equal(entry.action, 'merge');
  assert.equal(normalizePublishHistory([ entry ])[0].action, 'merge');
});
