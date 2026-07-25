import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoreRestPostPath,
  createRemotePostSnapshot,
  detectRemotePostSourceFormat,
  parseCoreRestPostTypeRoute,
  parseCoreRestRemotePost,
  parseWpComRemotePost,
  parseXmlRpcRemotePost,
  validateRemotePostIdentity
} from '../src/remote-post.ts';

test('normalizes an editable core REST post and discovers embedded terms and media', () => {
  const post = parseCoreRestRemotePost({
    id: 42,
    type: 'post',
    title: { raw: 'Remote title', rendered: 'Rendered title' },
    content: {
      raw: '<!-- wp:paragraph -->\n<p>Remote body</p>\n<!-- /wp:paragraph -->',
      rendered: '<p>Rendered body</p>'
    },
    excerpt: { raw: 'Source excerpt', rendered: '<p>Source excerpt</p>' },
    slug: 'remote-title',
    status: 'draft',
    comment_status: 'open',
    date_gmt: '2026-07-20T10:00:00',
    modified_gmt: '2026-07-20T11:30:00',
    link: 'https://example.com/remote-title/',
    categories: [ 3 ],
    tags: [ 7 ],
    featured_media: 88,
    meta: {
      rank_math_focus_keyword: 'remote focus',
      rank_math_description: 'remote description',
      _secondary_title: 'Remote subtitle'
    },
    _embedded: {
      'wp:term': [
        [ { id: 3, name: 'News', slug: 'news', taxonomy: 'category' } ],
        [ { id: 7, name: 'Obsidian', slug: 'obsidian', taxonomy: 'post_tag' } ]
      ],
      'wp:featuredmedia': [ {
        id: 88,
        source_url: 'https://example.com/cover.jpg',
        alt_text: 'Cover alt',
        title: { rendered: 'Cover title' },
        caption: { rendered: 'Cover caption' }
      } ]
    }
  });

  assert.equal(post.postId, '42');
  assert.equal(post.title, 'Remote title');
  assert.match(post.content, /wp:paragraph/);
  assert.equal(post.sourceFormat, 'block-editor');
  assert.deepEqual(post.categoryIds, [ '3' ]);
  assert.deepEqual(post.tagIds, [ '7' ]);
  assert.equal(post.terms[0].slug, 'news');
  assert.equal(post.featuredMedia?.id, '88');
  assert.equal(post.featuredMedia?.altText, 'Cover alt');
  assert.equal(post.modifiedAt, '2026-07-20T11:30:00.000Z');
  assert.equal(post.focusKeyword, 'remote focus');
  assert.equal(post.secondaryTitle, 'Remote subtitle');
  assert.equal(post.capabilities.metaDescription, true);
});

test('rejects a core REST response that contains rendered content but no editable raw source', () => {
  assert.throws(() => parseCoreRestRemotePost({
    id: 42,
    type: 'post',
    title: { rendered: 'Rendered title' },
    content: { rendered: '<p>Rendered body</p>' }
  }), /editable post identity, title, and content/);
});

test('distinguishes an available empty remote subtitle from an unsupported field', () => {
  const post = parseCoreRestRemotePost({
    id: 42,
    type: 'post',
    title: { raw: 'Remote title' },
    content: { raw: '' },
    meta: { _secondary_title: '' }
  });
  assert.equal(post.secondaryTitle, '');
  assert.equal(post.capabilities.secondaryTitle, true);
});

test('discovers and validates a custom post type REST route', () => {
  const route = parseCoreRestPostTypeRoute({
    slug: 'book',
    rest_namespace: 'wp/v2',
    rest_base: 'library-books'
  }, 'book');
  assert.deepEqual(route, {
    namespace: 'wp/v2',
    restBase: 'library-books'
  });
  assert.equal(
    buildCoreRestPostPath(route, { postId: '51', postType: 'book' }),
    'wp-json/wp/v2/library-books/51?context=edit&_embed=wp:featuredmedia,wp:term'
  );
  assert.throws(
    () => parseCoreRestPostTypeRoute({ slug: 'page', rest_base: 'pages' }, 'post'),
    /different post type/
  );
});

test('normalizes a WordPress.com editing-context post', () => {
  const post = parseWpComRemotePost({
    ID: 73,
    type: 'page',
    title: 'WordPress.com title',
    content: '<h2>Remote heading</h2>',
    excerpt: 'Remote excerpt',
    slug: 'wpcom-title',
    status: 'publish',
    date: '2026-07-20T10:00:00+08:00',
    modified: '2026-07-20T12:00:00+08:00',
    URL: 'https://example.wordpress.com/wpcom-title/',
    discussion: { comments_open: false },
    categories: {
      News: { ID: 3, name: 'News', slug: 'news' }
    },
    tags: {
      Obsidian: { ID: 7, name: 'Obsidian', slug: 'obsidian' }
    },
    featured_image: 'https://example.wordpress.com/cover.jpg',
    post_thumbnail: {
      ID: 89,
      URL: 'https://example.wordpress.com/cover.jpg',
      alt: 'Cover alt'
    },
    metadata: [
      { key: 'rank_math_focus_keyword', value: 'wpcom focus' },
      { key: '_secondary_title', value: 'WP.com subtitle' }
    ]
  });

  assert.equal(post.postId, '73');
  assert.equal(post.postType, 'page');
  assert.equal(post.commentStatus, 'closed');
  assert.equal(post.sourceFormat, 'classic-html');
  assert.deepEqual(post.categoryIds, [ '3' ]);
  assert.deepEqual(post.tagIds, [ '7' ]);
  assert.equal(post.featuredMedia?.id, '89');
  assert.equal(post.focusKeyword, 'wpcom focus');
  assert.equal(post.secondaryTitle, 'WP.com subtitle');
});

test('normalizes an XML-RPC post including dates, terms, and custom fields', () => {
  const post = parseXmlRpcRemotePost({
    post_id: '91',
    post_type: 'post',
    post_title: 'XML title',
    post_content: '<p>XML body</p>',
    post_excerpt: '',
    post_name: 'xml-title',
    post_status: 'draft',
    comment_status: 'open',
    post_date_gmt: new Date('2026-07-20T01:00:00Z'),
    post_modified_gmt: new Date('2026-07-20T02:00:00Z'),
    link: 'https://example.com/xml-title/',
    post_thumbnail: '55',
    terms: [
      { term_id: '4', name: 'Politics', slug: 'politics', taxonomy: 'category' },
      { term_id: '8', name: 'Village', slug: 'village', taxonomy: 'post_tag' }
    ],
    custom_fields: [
      { key: 'rank_math_description', value: 'XML description' },
      { key: '_secondary_title', value: 'XML subtitle' }
    ]
  });

  assert.equal(post.postId, '91');
  assert.equal(post.excerpt, '');
  assert.deepEqual(post.categoryIds, [ '4' ]);
  assert.deepEqual(post.tagIds, [ '8' ]);
  assert.equal(post.featuredMedia?.id, '55');
  assert.equal(post.modifiedAt, '2026-07-20T02:00:00.000Z');
  assert.equal(post.metaDescription, 'XML description');
  assert.equal(post.secondaryTitle, 'XML subtitle');
});

test('detects empty, block-editor, and classic source formats', () => {
  assert.equal(detectRemotePostSourceFormat('  '), 'empty');
  assert.equal(
    detectRemotePostSourceFormat('<!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph -->'),
    'block-editor'
  );
  assert.equal(detectRemotePostSourceFormat('<p>A</p>'), 'classic-html');
});

test('decorates a document with profile identity and rejects mismatched targets', () => {
  const document = parseWpComRemotePost({
    ID: 12,
    type: 'post',
    title: 'Title',
    content: ''
  });
  validateRemotePostIdentity(document, { postId: '12', postType: 'post' });
  assert.throws(
    () => validateRemotePostIdentity(document, { postId: '13', postType: 'post' }),
    /different post/
  );
  assert.deepEqual(
    createRemotePostSnapshot(document, {
      profileId: 'profile-1',
      profileName: 'Local site',
      endpoint: 'https://example.com',
      fetchedAt: '2026-07-20T04:00:00.000Z'
    }),
    {
      ...document,
      profileId: 'profile-1',
      profileName: 'Local site',
      endpoint: 'https://example.com',
      editUrl: 'https://example.com/wp-admin/post.php?action=edit&post=12',
      fetchedAt: '2026-07-20T04:00:00.000Z'
    }
  );
});

test('rejects malformed WordPress.com and XML-RPC responses', () => {
  assert.throws(() => parseWpComRemotePost({
    ID: 10,
    type: 'post',
    title: 'Missing editable content'
  }), /editable post identity, title, and content/);
  assert.throws(() => parseXmlRpcRemotePost({
    post_id: '10',
    post_type: 'post',
    post_content: 'Missing title'
  }), /post identity, title, and content/);
});

test('rejects unsafe linked post types before transport routing', () => {
  const document = parseWpComRemotePost({
    ID: 12,
    type: 'post',
    title: 'Title',
    content: ''
  });
  assert.throws(
    () => validateRemotePostIdentity(document, {
      postId: '12',
      postType: '../posts?context=view'
    }),
    /target is invalid/
  );
});
