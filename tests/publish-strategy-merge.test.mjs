import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRestPublishPayload,
  buildXmlRpcPublishPayload,
  isMergeUpdate,
  PublishUpdateStrategy
} from '../src/publish-strategy.ts';
import { PullField } from '../src/sync-diff.ts';

function params(overrides = {}) {
  return {
    status: 'draft',
    commentStatus: 'open',
    categories: [ 7 ],
    postType: 'post',
    tags: [ '9' ],
    title: 'Merged title',
    content: 'Merged content',
    postId: '42',
    updateStrategy: PublishUpdateStrategy.Merge,
    updateFields: [ PullField.Title, PullField.Body ],
    ...overrides
  };
}

test('merge mode applies only to an explicit existing post', () => {
  assert.equal(isMergeUpdate(params()), true);
  assert.equal(isMergeUpdate(params({ postId: undefined })), false);
});

test('REST merge payload contains only reviewed fields', () => {
  const postParams = params({
    slug: '',
    excerpt: '',
    updateFields: [
      PullField.Title,
      PullField.Body,
      PullField.Slug,
      PullField.Excerpt,
      PullField.Tags
    ]
  });
  const payload = buildRestPublishPayload({
    title: 'Merged title',
    content: '<!-- wp:paragraph --><p>Merged</p><!-- /wp:paragraph -->',
    postParams,
    editorialMetadata: {
      featured_media: 99,
      metadata: [ { key: 'rank_math_description', value: 'Do not touch' } ]
    },
    scheduledDate: '2030-01-02T03:04:05Z'
  });
  assert.deepEqual(payload, {
    title: 'Merged title',
    content: '<!-- wp:paragraph --><p>Merged</p><!-- /wp:paragraph -->',
    slug: '',
    excerpt: '',
    tags: [ '9' ]
  });
});

test('merge payloads include only reviewed featured media and SEO fields', () => {
  const postParams = params({
    featuredMediaId: 0,
    updateFields: [
      PullField.FeaturedMedia,
      PullField.FocusKeyword,
      PullField.MetaDescription
    ]
  });
  assert.deepEqual(buildRestPublishPayload({
    title: 'Ignored',
    content: 'Ignored',
    postParams,
    editorialMetadata: {
      featured_image: '0',
      metadata: [
        { key: 'rank_math_focus_keyword', value: '' },
        { key: 'rank_math_description', value: '' },
        { key: 'unreviewed', value: 'keep remote' }
      ]
    }
  }), {
    featured_image: '0',
    metadata: [
      { key: 'rank_math_focus_keyword', value: '' },
      { key: 'rank_math_description', value: '' }
    ]
  });
  assert.deepEqual(buildXmlRpcPublishPayload({
    title: 'Ignored',
    content: 'Ignored',
    postParams,
    editorialMetadata: { post_thumbnail: 0 }
  }), { post_thumbnail: 0 });
});

test('XML-RPC merge payload excludes unsupported and unreviewed metadata', () => {
  const postParams = params({
    commentStatus: 'closed',
    updateFields: [ PullField.CommentStatus, PullField.Categories ]
  });
  const payload = buildXmlRpcPublishPayload({
    title: 'Ignored title',
    content: 'Ignored body',
    postParams,
    editorialMetadata: {
      post_thumbnail: 99,
      post_excerpt: 'Ignored excerpt'
    }
  });
  assert.deepEqual(payload, {
    comment_status: 'closed',
    terms: { category: [ 7 ] }
  });
});
