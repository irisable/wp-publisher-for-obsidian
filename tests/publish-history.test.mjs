import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPublishHistoryEntry,
  createPublishHistoryEntry,
  filterPublishHistory,
  formatLocalPublishTimestamp,
  normalizePublishHistory,
  PUBLISH_HISTORY_LIMIT,
  PublishHistoryAction,
  PublishHistoryOutcome,
  resolvePublishHistoryAction
} from '../src/publish-history.ts';

function entry(overrides = {}) {
  return createPublishHistoryEntry({
    id: 'entry-1',
    timestamp: '2030-01-02T03:04:05.000Z',
    outcome: PublishHistoryOutcome.Success,
    action: PublishHistoryAction.FullUpdate,
    notePath: 'Articles/example.md',
    noteTitle: 'Example article',
    profileName: 'Production',
    profileId: 'profile-production',
    endpoint: 'https://example.com',
    postType: 'post',
    postId: '42',
    ...overrides
  });
}

test('formats front matter timestamps with a readable local offset', () => {
  const date = new Date('2026-07-20T12:24:01.716Z');
  assert.equal(
    formatLocalPublishTimestamp(date, 8 * 60),
    '2026-07-20T20:24:01+08:00'
  );
  assert.equal(
    formatLocalPublishTimestamp(date, -5 * 60),
    '2026-07-20T07:24:01-05:00'
  );
});

test('distinguishes create, full update, and content-only actions', () => {
  assert.equal(resolvePublishHistoryAction({}), PublishHistoryAction.Create);
  assert.equal(
    resolvePublishHistoryAction({ postId: '42', updateStrategy: 'full' }),
    PublishHistoryAction.FullUpdate
  );
  assert.equal(
    resolvePublishHistoryAction({ postId: '42', updateStrategy: 'content-only' }),
    PublishHistoryAction.ContentOnly
  );
});

test('normalizes stored entries without retaining unknown or sensitive fields', () => {
  const normalized = normalizePublishHistory([ {
    ...entry(),
    body: 'must not persist',
    username: 'private-user',
    password: 'private-password'
  }, { invalid: true } ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].profileId, 'profile-production');
  assert.equal('body' in normalized[0], false);
  assert.equal('username' in normalized[0], false);
  assert.equal('password' in normalized[0], false);
});

test('keeps newest unique entries within the bounded history limit', () => {
  let history = [];
  for (let index = 0; index < PUBLISH_HISTORY_LIMIT + 5; index += 1) {
    history = addPublishHistoryEntry(history, entry({
      id: 'entry-' + index,
      timestamp: new Date(Date.UTC(2030, 0, 1, 0, 0, index)).toISOString()
    }));
  }
  assert.equal(history.length, PUBLISH_HISTORY_LIMIT);
  assert.equal(history[0].id, 'entry-104');
  assert.equal(history.at(-1).id, 'entry-5');

  const replaced = addPublishHistoryEntry(history, entry({
    id: 'entry-104',
    timestamp: '2040-01-01T00:00:00.000Z',
    message: 'new value'
  }));
  assert.equal(replaced.filter(item => item.id === 'entry-104').length, 1);
  assert.equal(replaced[0].message, 'new value');
});

test('searches note, profile, endpoint, post ID, action, and errors', () => {
  const history = [
    entry(),
    entry({
      id: 'entry-2',
      outcome: PublishHistoryOutcome.Failure,
      action: PublishHistoryAction.ContentOnly,
      notePath: 'Drafts/failed.md',
      noteTitle: 'Failed note',
      profileName: 'Local test',
      profileId: 'profile-local-test',
      endpoint: 'http://localhost:8080',
      postId: undefined,
      message: 'Connection refused'
    })
  ];
  assert.equal(filterPublishHistory(history, 'production').length, 1);
  assert.equal(filterPublishHistory(history, '42').length, 1);
  assert.equal(filterPublishHistory(history, 'content-only').length, 1);
  assert.equal(filterPublishHistory(history, 'connection refused').length, 1);
  assert.equal(filterPublishHistory(history, '').length, 2);
});


test('records pull actions and selected field counts without bodies', () => {
  const pull = entry({
    action: PublishHistoryAction.Pull,
    selectedFieldCount: 4,
    warningCount: 2,
    body: 'must be discarded'
  });
  assert.equal(pull.action, 'pull');
  assert.equal(pull.selectedFieldCount, 4);
  assert.equal(pull.warningCount, 2);
  assert.equal('body' in pull, false);
});
