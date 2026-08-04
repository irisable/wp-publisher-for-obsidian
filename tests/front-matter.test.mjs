import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fillExcerptFromMetaDescription,
  normalizeWordPressTags,
  readEditorialFrontMatter,
  readPublishingControlFrontMatter,
  readPublishFrontMatter,
  readWordPressTagsFrontMatter,
  resolveWordPressTitle,
  updatePublishFrontMatter
} from '../src/front-matter.ts';

test('preserves unrelated front matter properties and migrates legacy sync keys', () => {
  const matter = {
    title: 'Existing title',
    aliases: [ 'one', 'two' ],
    customProperty: { nested: true },
    profileName: 'Old profile',
    postId: '12',
    postType: 'post',
    categories: [ 'old-category' ]
  };

  updatePublishFrontMatter(matter, {
    profileName: 'New profile',
    postId: '34',
    postType: 'post',
    categories: [ 'new-category', 'another-category' ]
  });

  assert.deepEqual(matter, {
    title: 'Existing title',
    aliases: [ 'one', 'two' ],
    customProperty: { nested: true },
    wpProfile: 'New profile',
    wpPostId: '34',
    wpPostType: 'post',
    categories: [ 'new-category', 'another-category' ]
  });
});

test('writes lightweight publish status as valid scalar properties', () => {
  const matter = { customProperty: 'keep me' };
  updatePublishFrontMatter(matter, {
    profileName: 'Local WordPress',
    postId: '55',
    postType: 'post',
    lastPublishedAt: '2030-01-02T03:04:05.000Z',
    lastPublishAction: 'content-only'
  });

  assert.equal(matter.wpLastPublishedAt, '2030-01-02T03:04:05.000Z');
  assert.equal(matter.wpLastPublishAction, 'content-only');
  assert.equal(matter.customProperty, 'keep me');
  assert.deepEqual(readPublishFrontMatter(matter), {
    profileName: 'Local WordPress',
    postId: '55',
    postType: 'post',
    lastPublishedAt: '2030-01-02T03:04:05.000Z',
    lastPublishAction: 'content-only'
  });
});

test('preserves categories and tags when publishing a page', () => {
  const matter = {
    categories: [ 'Reference' ],
    tags: [ 'obsidian', 'wordpress' ],
    wpTags: [ 'existing-wordpress-tag' ],
    customProperty: 'keep me'
  };

  updatePublishFrontMatter(matter, {
    profileName: 'Local WordPress',
    postId: '55',
    postType: 'page'
  });

  assert.deepEqual(matter.categories, [ 'Reference' ]);
  assert.deepEqual(matter.tags, [ 'obsidian', 'wordpress' ]);
  assert.deepEqual(matter.wpTags, [ 'existing-wordpress-tag' ]);
  assert.equal(matter.customProperty, 'keep me');
});

test('writes WordPress tags without changing Obsidian tags', () => {
  const tags = [ 'Published', 'Portable' ];
  const matter = { tags: [ 'vault/project' ], customProperty: true };

  updatePublishFrontMatter(matter, {
    profileName: 'Local WordPress',
    postId: '91',
    postType: 'post',
    tags
  });
  tags.push('Later mutation');

  assert.deepEqual(matter.tags, [ 'vault/project' ]);
  assert.deepEqual(matter.wpTags, [ 'Published', 'Portable' ]);
  assert.equal(matter.customProperty, true);
});

test('copies published category slugs instead of retaining a mutable reference', () => {
  const categories = [ 'portable-slug' ];
  const matter = {};

  updatePublishFrontMatter(matter, {
    profileName: 'Local WordPress',
    postId: '89',
    postType: 'post',
    categories
  });
  categories.push('another-slug');

  assert.deepEqual(matter.categories, [ 'portable-slug' ]);
});

test('reads legacy sync keys while preferring namespaced keys', () => {
  assert.deepEqual(readPublishFrontMatter({
    profileName: 'Legacy profile',
    postId: '12',
    postType: 'post',
    wpProfile: 'Current profile',
    wpPostId: '34',
    wpPostType: 'page'
  }), {
    profileName: 'Current profile',
    postId: '34',
    postType: 'page'
  });
});


test('reads canonical editorial properties and trims text values', () => {
  assert.deepEqual(readEditorialFrontMatter({
    slug: '  canonical-slug  ',
    excerpt: '  A concise summary.  ',
    featuredImage: '  [[images/cover.jpg]]  ',
    focusKeyword: '  obsidian publishing  ',
    metaDescription: '  Search-focused copy.  ',
    secondaryTitle: '  A clear subtitle  '
  }), {
    slug: 'canonical-slug',
    excerpt: 'A concise summary.',
    featuredImage: '[[images/cover.jpg]]',
    focusKeyword: 'obsidian publishing',
    metaDescription: 'Search-focused copy.',
    secondaryTitle: 'A clear subtitle'
  });
});

test('uses meta description as excerpt only when excerpt is empty', () => {
  assert.deepEqual(fillExcerptFromMetaDescription(
    readEditorialFrontMatter({ excerpt: 'Archive summary' })
  ), {
    excerpt: 'Archive summary'
  });
  assert.deepEqual(fillExcerptFromMetaDescription(
    readEditorialFrontMatter({ meta_description: 'Shared SEO copy' })
  ), {
    excerpt: 'Shared SEO copy',
    metaDescription: 'Shared SEO copy'
  });
  assert.deepEqual(fillExcerptFromMetaDescription(
    readEditorialFrontMatter({
      excerpt: 'Archive summary',
      metaDescription: 'Search summary'
    })
  ), {
    excerpt: 'Archive summary',
    metaDescription: 'Search summary'
  });
});

test('accepts a numeric WordPress media ID for featuredImage', () => {
  assert.deepEqual(readEditorialFrontMatter({ featuredImage: 42 }), {
    featuredImage: '42'
  });
});

test('joins a Focus Keyword property list for Rank Math', () => {
  assert.deepEqual(readEditorialFrontMatter({
    focusKeyword: [ '  交托  ', '决定论', '', 42, '宿命论', '责任论' ]
  }), {
    focusKeyword: '交托, 决定论, 宿命论, 责任论'
  });
});

test('ignores unsupported editorial property values and aliases', () => {
  assert.deepEqual(readEditorialFrontMatter({
    slug: [ 'not-a-slug' ],
    excerpt: { text: 'not-an-excerpt' },
    featured_image: 'legacy-cover.jpg'
  }), {});
});

test('supports focus_keyword while preferring canonical focusKeyword', () => {
  assert.deepEqual(readEditorialFrontMatter({
    focusKeyword: [ 'canonical one', 'canonical two' ],
    focus_keyword: [ 'compatibility keyword' ]
  }), {
    focusKeyword: 'canonical one, canonical two'
  });
  assert.deepEqual(readEditorialFrontMatter({
    focus_keyword: [ 'compatibility one', 'compatibility two' ]
  }), {
    focusKeyword: 'compatibility one, compatibility two'
  });
});


test('supports meta_description while preferring canonical metaDescription', () => {
  assert.deepEqual(readEditorialFrontMatter({
    metaDescription: 'Canonical description',
    meta_description: 'Compatibility description'
  }), {
    metaDescription: 'Canonical description'
  });
  assert.deepEqual(readEditorialFrontMatter({
    meta_description: 'Compatibility description'
  }), {
    metaDescription: 'Compatibility description'
  });
});

test('supports secondary_title while preserving an explicit empty canonical value', () => {
  assert.deepEqual(readEditorialFrontMatter({
    secondaryTitle: '',
    secondary_title: 'Compatibility subtitle'
  }), {
    secondaryTitle: ''
  });
  assert.deepEqual(readEditorialFrontMatter({
    secondary_title: '  Compatibility subtitle  '
  }), {
    secondaryTitle: 'Compatibility subtitle'
  });
});

test('uses the title property for WordPress and the note name only as fallback', () => {
  assert.equal(resolveWordPressTitle({ title: 'Property title' }, 'Note filename'), 'Property title');
  assert.equal(resolveWordPressTitle({}, 'Note filename'), 'Note filename');
});

test('reads canonical WordPress tags before the legacy Obsidian property', () => {
  assert.deepEqual(readWordPressTagsFrontMatter({
    wpTags: [ '  faith ', 'theology', 'faith', '', 42 ],
    tags: [ 'vault/topic' ]
  }), {
    present: true,
    tags: [ 'faith', 'theology' ],
    source: 'wpTags'
  });
  assert.deepEqual(readWordPressTagsFrontMatter({
    wpTags: [],
    tags: [ 'legacy-tag' ]
  }), {
    present: true,
    tags: [],
    source: 'wpTags'
  });
  assert.deepEqual(readWordPressTagsFrontMatter({
    tags: 'legacy, imported'
  }), {
    present: true,
    tags: [ 'legacy', 'imported' ],
    source: 'tags'
  });
  assert.deepEqual(readWordPressTagsFrontMatter({}), {
    present: false,
    tags: []
  });
  assert.deepEqual(
    normalizeWordPressTags('faith，Catholic social teaching, Church history'),
    [ 'faith', 'Catholic social teaching', 'Church history' ]
  );
});


test('reads only publishable status and comment control values', () => {
  assert.deepEqual(readPublishingControlFrontMatter({
    status: 'publish',
    comment_status: 'closed'
  }), {
    status: 'publish',
    commentStatus: 'closed'
  });
  assert.deepEqual(readPublishingControlFrontMatter({
    status: 'trash',
    commentStatus: 'invalid'
  }), {});
});
