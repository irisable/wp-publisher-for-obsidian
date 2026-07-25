import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCategoryTree,
  categorySlugsForIds,
  getVisibleCategoryIds,
  resolveCategoryIds
} from '../src/categories.ts';

const categories = [
  { id: '7', name: 'Live Christ Style', slug: 'live-christ-style', parent: 0 },
  { id: '9', name: 'Notes', slug: 'notes', parent: 0 }
];

test('resolves a legacy category slug without splitting it into characters', () => {
  assert.deepEqual(resolveCategoryIds('live-christ-style', categories), [ 7 ]);
});

test('normalizes numeric category values and removes duplicates', () => {
  assert.deepEqual(resolveCategoryIds([ '7', 7, 9 ], categories), [ 7, 9 ]);
});

test('uses the default category when legacy data cannot be resolved', () => {
  assert.deepEqual(resolveCategoryIds('missing-category', categories), [ 1 ]);
});

test('converts selected IDs back to portable slugs', () => {
  assert.deepEqual(categorySlugsForIds([ 9, 7 ], categories), [ 'notes', 'live-christ-style' ]);
});

test('orders an unsorted taxonomy as a parent-first hierarchy', () => {
  const tree = buildCategoryTree([
    { id: 2, name: 'Child', slug: 'child', parent: 1 },
    { id: 3, name: 'Grandchild', slug: 'grandchild', parent: 2 },
    { id: 1, name: 'Parent', slug: 'parent', parent: 0 },
    { id: 4, name: 'Other root', slug: 'other-root', parent: 0 }
  ]);

  assert.deepEqual(tree.map(item => ({
    id: item.category.id,
    depth: item.depth,
    path: item.path
  })), [
    { id: 1, depth: 0, path: [ 'Parent' ] },
    { id: 2, depth: 1, path: [ 'Parent', 'Child' ] },
    { id: 3, depth: 2, path: [ 'Parent', 'Child', 'Grandchild' ] },
    { id: 4, depth: 0, path: [ 'Other root' ] }
  ]);
});

test('keeps orphaned and cyclic categories visible exactly once', () => {
  const tree = buildCategoryTree([
    { id: 5, name: 'Orphan', slug: 'orphan', parent: 99 },
    { id: 6, name: 'Cycle A', slug: 'cycle-a', parent: 7 },
    { id: 7, name: 'Cycle B', slug: 'cycle-b', parent: 6 }
  ]);

  assert.deepEqual(tree.map(item => item.category.id), [ 5, 6, 7 ]);
});


test('searches category names, slugs, and paths while keeping parent context', () => {
  const tree = buildCategoryTree([
    { id: 1, name: 'Politics', slug: 'politics', parent: 0 },
    { id: 2, name: 'History', slug: 'history', parent: 1 },
    { id: 3, name: 'Roman Empire', slug: 'roman-empire', parent: 2 },
    { id: 4, name: 'Travel', slug: 'travel', parent: 0 }
  ]);

  assert.deepEqual([ ...getVisibleCategoryIds(tree, 'roman-empire') ], [ '1', '2', '3' ]);
  assert.deepEqual([ ...getVisibleCategoryIds(tree, 'Politics') ], [ '1', '2', '3' ]);
  assert.deepEqual([ ...getVisibleCategoryIds(tree, '') ], [ '1', '2', '3', '4' ]);
  assert.deepEqual([ ...getVisibleCategoryIds(tree, 'missing') ], []);
});
