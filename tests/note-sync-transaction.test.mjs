import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPullRestoreSnapshot,
  applyGuardedNoteRevision,
  createPullRestoreSnapshot,
  findLatestPullRestoreSnapshot,
  freezeNoteRevision,
  normalizePullRestoreSnapshots,
  PullTransactionError,
  PullTransactionErrorCode,
  undoGuardedPull
} from '../src/note-sync-transaction.ts';

function store(initial) {
  let content = initial;
  return {
    read: async () => content,
    process: async (_file, transform) => {
      content = transform(content);
      return content;
    },
    set(value) {
      content = value;
    },
    get() {
      return content;
    }
  };
}

function identity(overrides = {}) {
  return {
    notePath: 'Articles/example.md',
    profileId: 'profile-1',
    profileName: 'Production',
    endpoint: 'https://example.com',
    postId: '42',
    postType: 'post',
    beforeContent: 'before',
    appliedContent: 'after',
    ...overrides
  };
}

test('applies one guarded note revision when the frozen hash still matches', async () => {
  const vault = store('before');
  const frozen = await freezeNoteRevision('before');
  await applyGuardedNoteRevision(vault, {}, frozen, 'after');
  assert.equal(vault.get(), 'after');
});

test('rejects stale apply without changing the latest local revision', async () => {
  const vault = store('before');
  const frozen = await freezeNoteRevision('before');
  vault.set('edited while preview open');
  await assert.rejects(
    applyGuardedNoteRevision(vault, {}, frozen, 'after'),
    error => error instanceof PullTransactionError
      && error.code === PullTransactionErrorCode.StaleLocalRevision
  );
  assert.equal(vault.get(), 'edited while preview open');
});

test('undo restores exact pre-pull bytes only while the applied hash matches', async () => {
  const snapshot = await createPullRestoreSnapshot(identity());
  const vault = store('after');
  await undoGuardedPull(vault, {}, snapshot);
  assert.equal(vault.get(), 'before');

  vault.set('later edit');
  await assert.rejects(
    undoGuardedPull(vault, {}, snapshot),
    error => error instanceof PullTransactionError
      && error.code === PullTransactionErrorCode.StaleUndoRevision
  );
  assert.equal(vault.get(), 'later edit');
});

test('keeps only the five newest valid restore snapshots', async () => {
  let snapshots = [];
  for (let index = 0; index < 7; index += 1) {
    snapshots = addPullRestoreSnapshot(
      snapshots,
      await createPullRestoreSnapshot(identity({
        id: 'restore-' + index,
        createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, index)).toISOString(),
        notePath: 'Article-' + index + '.md'
      }))
    );
  }
  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[0].id, 'restore-6');
  assert.equal(snapshots.at(-1).id, 'restore-2');
  assert.equal(findLatestPullRestoreSnapshot(snapshots, 'Article-6.md')?.id, 'restore-6');
  assert.equal(normalizePullRestoreSnapshots([ { body: 'unsafe' } ]).length, 0);
});
