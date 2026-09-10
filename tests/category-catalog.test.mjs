import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCategoryCatalog, fetchSelectedCategories } from '../src/category-catalog.ts';

test('loads the second page containing 陈年旧作', async () => {
  const calls = [];
  const result = await fetchCategoryCatalog(async page => {
    calls.push(page);
    return { totalPages: 2, items: page === 1
      ? Array.from({ length: 100 }, (_, id) => ({ id: String(id), name: '分类' + id }))
      : [{ id: '2049', name: '陈年旧作' }] };
  });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.length, 101);
  assert.equal(result.at(-1).name, '陈年旧作');
});

test('supports missing pagination headers and deduplicates overlapping pages', async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({ id: String(id) }));
  const result = await fetchCategoryCatalog(async page => ({
    items: page === 1 ? first : [{ id: '99' }, { id: '100' }]
  }));
  assert.equal(result.length, 101);
});

test('does not silently return incomplete results after a later-page error', async () => {
  await assert.rejects(fetchCategoryCatalog(async page => {
    if (page === 2) throw new Error('HTTP 500');
    return { items: [{ id: '1' }], totalPages: 2 };
  }), /HTTP 500/);
});

test('stops when a server ignores pagination', async () => {
  await assert.rejects(fetchCategoryCatalog(async () => ({
    items: Array.from({ length: 100 }, (_, id) => ({ id: String(id) }))
  })), /did not advance/);
});

test('selected categories fetch only exact references and missing ancestors, keeping deprecated terms', async () => {
  const calls = [];
  const terms = [
    { id: '10', name: 'Root', slug: 'root', parent: 0 },
    { id: '20', name: 'Old essays', slug: 'old-essays', parent: 10, deprecated: true },
    { id: '30', name: 'Unrelated', slug: 'unrelated', parent: 0 },
  ];
  const selected = await fetchSelectedCategories(['old-essays'], async filter => {
    calls.push(filter);
    return terms.filter(term => filter.include ? term.id === filter.include : term.slug === filter.slug);
  });
  assert.deepEqual(calls, [{ slug: 'old-essays' }, { include: '10' }]);
  assert.deepEqual(selected.map(term => term.id), ['20', '10']);
  assert.equal(selected[0].deprecated, true);
});

test('legacy names use an exact name match after a targeted search', async () => {
  const calls = [];
  const selected = await fetchSelectedCategories(['Old essays'], async filter => {
    calls.push(filter);
    return filter.search ? [
      { id: '20', name: 'Old essays', slug: 'old-essays' },
      { id: '21', name: 'Old essays again', slug: 'another' }
    ] : [];
  });
  assert.deepEqual(calls, [{ slug: 'Old essays' }, { search: 'Old essays' }]);
  assert.deepEqual(selected.map(term => term.id), ['20']);
});

test('shared ancestors and malformed cycles cannot create an endless fetch', async () => {
  const calls = [];
  const terms = [
    { id: '1', name: 'A', slug: 'a', parent: '2' },
    { id: '2', name: 'B', slug: 'b', parent: '1' },
  ];
  const selected = await fetchSelectedCategories([1, 2], async filter => {
    calls.push(filter);
    return terms.filter(term => term.id === filter.include);
  });
  assert.equal(calls.length, 2);
  assert.equal(selected.length, 2);
});

test('selected-term network errors are not treated as an empty selection', async () => {
  await assert.rejects(fetchSelectedCategories(['essays'], async () => {
    throw new Error('HTTP 401');
  }), /HTTP 401/);
});
