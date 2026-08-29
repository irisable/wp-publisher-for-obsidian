import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  buildRankMathSeoMetadata,
  buildRestEditorialMetadata,
  buildSecondaryTitleMetadata,
  buildWpComEditorialMetadata,
  buildXmlRpcEditorialMetadata,
  parseFeaturedImageReference,
  RANK_MATH_DESCRIPTION_META,
  RANK_MATH_FOCUS_KEYWORD_META,
  SECONDARY_TITLE_META
} = await importTypescriptModule(new URL('../src/editorial-metadata.ts', import.meta.url));

const values = {
  slug: '  editorial-slug  ',
  excerpt: '  A concise summary.  ',
  featuredMediaId: 42,
  focusKeyword: '  publishing from obsidian  ',
  metaDescription: '  A search-focused description.  ',
  secondaryTitle: '  A useful subtitle  '
};

test('builds WordPress core REST editorial fields', () => {
  assert.deepEqual(buildRestEditorialMetadata(values), {
    slug: 'editorial-slug',
    excerpt: 'A concise summary.',
    featured_media: 42
  });
});

test('builds canonical WP Title Layer subtitle and atomic Series metadata', () => {
  assert.deepEqual(buildRestEditorialMetadata({
    secondaryTitle: '  Canonical subtitle  ',
    secondaryTitleOwner: 'wptl',
    resolvedSeriesPlacement: {
      kind: 'placement',
      termIds: [ 123 ],
      meta: {
        wptl_season_key: 'arrival',
        wptl_series_role: 'article',
        wptl_series_scope: '',
        wptl_sequence_label: '15A'
      }
    }
  }), {
    wptl_series: [ 123 ],
    meta: {
      wptl_subtitle: 'Canonical subtitle',
      wptl_season_key: 'arrival',
      wptl_series_role: 'article',
      wptl_series_scope: '',
      wptl_sequence_label: '15A'
    }
  });
});

test('does not send a legacy subtitle through core REST metadata', () => {
  assert.deepEqual(buildRestEditorialMetadata({
    secondaryTitle: 'Legacy subtitle',
    secondaryTitleOwner: 'legacy'
  }), {});
});

test('builds WordPress.com metadata with Rank Math focus keyword', () => {
  assert.deepEqual(buildWpComEditorialMetadata(values), {
    slug: 'editorial-slug',
    excerpt: 'A concise summary.',
    featured_image: '42',
    metadata: [ {
      key: RANK_MATH_FOCUS_KEYWORD_META,
      value: 'publishing from obsidian',
      operation: 'update'
    }, {
      key: RANK_MATH_DESCRIPTION_META,
      value: 'A search-focused description.',
      operation: 'update'
    } ]
  });
});

test('builds core XML-RPC editorial fields without protected SEO metadata', () => {
  assert.deepEqual(buildXmlRpcEditorialMetadata(values), {
    post_name: 'editorial-slug',
    post_excerpt: 'A concise summary.',
    post_thumbnail: 42
  });
});

test('builds Rank Math metadata for the companion plugin', () => {
  assert.deepEqual(buildRankMathSeoMetadata(values), {
    [RANK_MATH_FOCUS_KEYWORD_META]: 'publishing from obsidian',
    [RANK_MATH_DESCRIPTION_META]: 'A search-focused description.'
  });
});

test('builds protected Secondary Title metadata only when explicitly provided', () => {
  assert.deepEqual(buildSecondaryTitleMetadata(values), {
    [SECONDARY_TITLE_META]: 'A useful subtitle'
  });
  assert.deepEqual(buildSecondaryTitleMetadata({}), {});
  assert.deepEqual(buildSecondaryTitleMetadata({ secondaryTitle: '' }), {
    [SECONDARY_TITLE_META]: ''
  });
});

test('omits editorial fields when values are empty', () => {
  assert.deepEqual(buildRestEditorialMetadata({}), {});
  assert.deepEqual(buildWpComEditorialMetadata({ focusKeyword: '  ' }), {});
  assert.deepEqual(buildXmlRpcEditorialMetadata({ slug: '' }), {});
  assert.deepEqual(buildRankMathSeoMetadata({ metaDescription: '  ' }), {});
  assert.deepEqual(buildSecondaryTitleMetadata({}), {});
});

test('preserves explicit clears for reviewed merge metadata', () => {
  const merge = {
    featuredMediaId: 0,
    focusKeyword: '',
    metaDescription: '',
    secondaryTitle: '',
    updateStrategy: 'merge',
    updateFields: [
      'featuredMedia',
      'focusKeyword',
      'metaDescription',
      'secondaryTitle'
    ]
  };
  assert.deepEqual(buildRestEditorialMetadata(merge), { featured_media: 0 });
  assert.deepEqual(buildWpComEditorialMetadata(merge), {
    featured_image: '0',
    metadata: [
      { key: RANK_MATH_FOCUS_KEYWORD_META, value: '', operation: 'update' },
      { key: RANK_MATH_DESCRIPTION_META, value: '', operation: 'update' }
    ]
  });
  assert.deepEqual(buildXmlRpcEditorialMetadata(merge), { post_thumbnail: 0 });
  assert.deepEqual(buildRankMathSeoMetadata(merge), {
    [RANK_MATH_FOCUS_KEYWORD_META]: '',
    [RANK_MATH_DESCRIPTION_META]: ''
  });
  assert.deepEqual(buildSecondaryTitleMetadata(merge), {
    [SECONDARY_TITLE_META]: ''
  });
});

test('parses featured image attachment IDs and vault links', () => {
  assert.deepEqual(parseFeaturedImageReference('35'), { type: 'attachment-id', id: 35 });
  assert.deepEqual(parseFeaturedImageReference('![[images/cover.jpg|800]]'), {
    type: 'vault-path',
    path: 'images/cover.jpg'
  });
  assert.deepEqual(parseFeaturedImageReference('![Cover](images/cover.jpg)'), {
    type: 'vault-path',
    path: 'images/cover.jpg'
  });
  assert.deepEqual(parseFeaturedImageReference('https://example.com/cover.jpg'), {
    type: 'remote-url',
    url: 'https://example.com/cover.jpg'
  });
  assert.equal(parseFeaturedImageReference('  '), undefined);
});
