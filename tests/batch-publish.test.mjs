import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countBatchPublishStates,
  filterBatchNotePaths,
  isPathInFolder,
  isRetryableBatchState
} from '../src/batch-publish.ts';

test('matches a selected folder recursively without matching sibling prefixes', () => {
  assert.equal(isPathInFolder('Articles/a.md', 'Articles'), true);
  assert.equal(isPathInFolder('Articles/Series/a.md', 'Articles/'), true);
  assert.equal(isPathInFolder('Articles-old/a.md', 'Articles'), false);
  assert.equal(isPathInFolder('Anything/a.md', ''), true);
});

test('filters batch candidates by folder, search, and selected-only state', () => {
  const paths = [
    'Articles/Alpha.md',
    'Articles/Series/Beta.md',
    'Drafts/Alpha draft.md'
  ];
  assert.deepEqual(filterBatchNotePaths(paths, {
    folderPath: 'Articles',
    query: 'beta'
  }), [ 'Articles/Series/Beta.md' ]);
  assert.deepEqual(filterBatchNotePaths(paths, {
    folderPath: '',
    query: '',
    selectedPaths: new Set([ 'Drafts/Alpha draft.md' ]),
    onlySelected: true
  }), [ 'Drafts/Alpha draft.md' ]);
});

test('retries only failed or skipped notes', () => {
  assert.equal(isRetryableBatchState('failure'), true);
  assert.equal(isRetryableBatchState('skipped'), true);
  assert.equal(isRetryableBatchState('success'), false);
  assert.equal(isRetryableBatchState('publishing'), false);
});

test('counts every visible queue state independently', () => {
  assert.deepEqual(
    countBatchPublishStates([
      'queued', 'publishing', 'success', 'success', 'failure', 'skipped'
    ]),
    {
      idle: 0,
      queued: 1,
      publishing: 1,
      success: 2,
      failure: 1,
      skipped: 1
    }
  );
});
