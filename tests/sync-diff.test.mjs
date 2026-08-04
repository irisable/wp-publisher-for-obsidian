import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  applySelectedPullFields,
  buildPullFieldDiffs,
  composePulledNoteRevision,
  createUnifiedLineDiff,
  PullField,
  splitMarkdownNote
} = await importTypescriptModule(new URL('../src/sync-diff.ts', import.meta.url));

function remote(overrides = {}) {
  return {
    title: 'Remote title',
    body: 'Remote body',
    slug: 'remote-title',
    excerpt: 'Remote excerpt',
    status: 'draft',
    commentStatus: 'closed',
    categoryIds: [ '7' ],
    tagIds: [ '9' ],
    terms: [
      { id: '7', taxonomy: 'category', name: 'News', slug: 'news' },
      { id: '9', taxonomy: 'post_tag', name: 'Obsidian', slug: 'obsidian' }
    ],
    featuredMedia: { id: '35', url: 'https://example.com/cover.jpg' },
    focusKeyword: 'remote keyword',
    metaDescription: 'Remote SEO description',
    secondaryTitle: 'Remote subtitle',
    capabilities: {
      slug: true,
      excerpt: true,
      status: true,
      commentStatus: true,
      categories: true,
      tags: true,
      featuredMedia: true,
      focusKeyword: true,
      metaDescription: true,
      secondaryTitle: true
    },
    ...overrides
  };
}

test('splits front matter without consuming the note body or CRLF style', () => {
  const raw = '---\r\ntitle: Local\r\ncustom: keep\r\n---\r\nBody\r\n';
  const parts = splitMarkdownNote(raw);
  assert.equal(parts.hasFrontMatter, true);
  assert.equal(parts.frontMatter, 'title: Local\r\ncustom: keep\r\n');
  assert.equal(parts.body, 'Body\r\n');
  assert.equal(parts.eol, '\r\n');
});

test('builds selectable field diffs with portable category slugs and tag names', () => {
  const raw = '---\ntitle: Local title\ncategories:\n  - old\nwpTags:\n  - old-tag\ntags:\n  - vault/topic\n---\nLocal body\n';
  const diffs = buildPullFieldDiffs({
    noteRaw: raw,
    matter: {
      title: 'Local title',
      categories: [ 'old' ],
      wpTags: [ 'old-tag' ],
      tags: [ 'vault/topic' ]
    },
    fallbackTitle: 'Filename',
    remote: remote()
  });
  const category = diffs.find(item => item.key === PullField.Categories);
  const tags = diffs.find(item => item.key === PullField.Tags);
  assert.deepEqual(category?.remoteValue, [ 'news' ]);
  assert.deepEqual(tags?.remoteValue, [ 'Obsidian' ]);
  assert.equal(category?.available, true);
  assert.ok(diffs.every(item => item.changed));
});

test('pulls remote tags into wpTags while preserving Obsidian tags', () => {
  const matter = {
    wpTags: [ 'old-tag' ],
    tags: [ 'vault/topic' ],
    custom: true
  };
  const diffs = buildPullFieldDiffs({
    noteRaw: 'Body',
    matter,
    fallbackTitle: 'Filename',
    remote: remote()
  });
  const next = applySelectedPullFields(
    matter,
    diffs,
    new Set([ PullField.Tags ])
  );
  assert.deepEqual(next, {
    wpTags: [ 'Obsidian' ],
    tags: [ 'vault/topic' ],
    custom: true
  });
});

test('refuses site-specific category IDs when WordPress omits portable slugs', () => {
  const diffs = buildPullFieldDiffs({
    noteRaw: 'Body',
    matter: {},
    fallbackTitle: 'Filename',
    remote: remote({ terms: [], tagIds: [] })
  });
  const category = diffs.find(item => item.key === PullField.Categories);
  assert.equal(category?.available, false);
  assert.equal(category?.issue, 'missing-category-slugs');
  assert.deepEqual(category?.missingIds, [ '7' ]);
});

test('applies only selected metadata and preserves unrelated properties and body bytes', () => {
  const raw = '---\ntitle: Local\ncustom:\n  nested: true\nexcerpt: Old\n---\nLocal body\n';
  const matter = { title: 'Local', custom: { nested: true }, excerpt: 'Old' };
  const diffs = buildPullFieldDiffs({
    noteRaw: raw,
    matter,
    fallbackTitle: 'Filename',
    remote: remote()
  });
  const selected = new Set([ PullField.Title, PullField.Excerpt ]);
  const nextMatter = applySelectedPullFields(matter, diffs, selected);
  const nextRaw = composePulledNoteRevision({
    raw,
    serializedMatter: [
      'title: Remote title',
      'custom:',
      '  nested: true',
      'excerpt: Remote excerpt',
      ''
    ].join('\n')
  });
  assert.deepEqual(nextMatter, {
    title: 'Remote title',
    custom: { nested: true },
    excerpt: 'Remote excerpt'
  });
  assert.ok(nextRaw.endsWith('---\nLocal body\n'));
});

test('applies portable featured media and canonical SEO aliases', () => {
  const matter = {
    featuredImage: 'old.jpg',
    focus_keyword: 'old keyword',
    meta_description: 'Old description',
    secondary_title: 'Old subtitle'
  };
  const diffs = buildPullFieldDiffs({
    noteRaw: 'Body',
    matter,
    fallbackTitle: 'Filename',
    remote: remote()
  });
  const next = applySelectedPullFields(matter, diffs, new Set([
    PullField.FeaturedMedia,
    PullField.FocusKeyword,
    PullField.MetaDescription,
    PullField.SecondaryTitle
  ]));
  assert.deepEqual(next, {
    featuredImage: 'https://example.com/cover.jpg',
    focusKeyword: 'remote keyword',
    metaDescription: 'Remote SEO description',
    secondaryTitle: 'Remote subtitle'
  });
});

test('composes a body pull while retaining front matter and local final-newline style', () => {
  const raw = '---\ncustom: keep\n---\nOld body\n';
  assert.equal(
    composePulledNoteRevision({ raw, pulledBody: 'New body' }),
    '---\ncustom: keep\n---\nNew body\n'
  );
});

test('creates a bounded unified line diff with stable line numbers', () => {
  const result = createUnifiedLineDiff('one\ntwo\nthree', 'one\nnew\nthree');
  assert.deepEqual(result.rows.map(row => row.kind), [
    'equal', 'add', 'remove', 'equal'
  ]);
  assert.equal(result.rows[1].remoteLine, 2);
  assert.equal(result.rows[2].localLine, 2);
  assert.equal(result.omittedRows, 0);
});


test('treats an explicit empty title as distinct from the filename fallback', () => {
  const diffs = buildPullFieldDiffs({
    noteRaw: 'Body',
    matter: { title: '' },
    fallbackTitle: 'Filename',
    remote: remote({ title: '' })
  });
  assert.equal(diffs.find(item => item.key === PullField.Title)?.changed, false);
});
