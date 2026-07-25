import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRestPublishPayload,
  buildXmlRpcPublishPayload,
  isContentOnlyUpdate,
  PublishUpdateStrategy
} from '../src/publish-strategy.ts';

function postParams(overrides = {}) {
  return {
    status: 'draft',
    commentStatus: 'open',
    categories: [ 2 ],
    postType: 'post',
    tags: [ 'news' ],
    title: 'Local title',
    content: 'Local content',
    ...overrides
  };
}

test('content-only mode applies only to an existing post', () => {
  assert.equal(isContentOnlyUpdate(postParams({
    updateStrategy: PublishUpdateStrategy.ContentOnly
  })), false);
  assert.equal(isContentOnlyUpdate(postParams({
    postId: '42',
    updateStrategy: PublishUpdateStrategy.ContentOnly
  })), true);
});

test('REST content-only updates send no title, taxonomy, status, or editorial fields', () => {
  const payload = buildRestPublishPayload({
    title: 'Changed title',
    content: '<p>Changed body</p>',
    postParams: postParams({
      postId: '42',
      updateStrategy: PublishUpdateStrategy.ContentOnly
    }),
    editorialMetadata: {
      slug: 'changed-slug',
      excerpt: 'Changed excerpt',
      featured_media: 99
    },
    scheduledDate: '2030-01-02T03:04:05Z'
  });
  assert.deepEqual(payload, { content: '<p>Changed body</p>' });
});

test('XML-RPC content-only updates send only post_content', () => {
  const payload = buildXmlRpcPublishPayload({
    title: 'Changed title',
    content: '<p>Changed body</p>',
    postParams: postParams({
      postId: '42',
      updateStrategy: PublishUpdateStrategy.ContentOnly
    }),
    editorialMetadata: {
      post_name: 'changed-slug',
      post_excerpt: 'Changed excerpt'
    }
  });
  assert.deepEqual(payload, { post_content: '<p>Changed body</p>' });
});

test('full updates retain metadata, taxonomy, and scheduling fields', () => {
  const params = postParams({
    postId: '42',
    status: 'future',
    updateStrategy: PublishUpdateStrategy.Full,
    datetime: new Date('2030-01-02T03:04:05Z')
  });
  const rest = buildRestPublishPayload({
    title: 'Changed title',
    content: '<p>Changed body</p>',
    postParams: params,
    editorialMetadata: { slug: 'changed-slug' },
    scheduledDate: '2030-01-02T03:04:05Z'
  });
  assert.equal(rest.title, 'Changed title');
  assert.deepEqual(rest.categories, [ 2 ]);
  assert.deepEqual(rest.tags, [ 'news' ]);
  assert.equal(rest.slug, 'changed-slug');
  assert.equal(rest.date, '2030-01-02T03:04:05Z');

  const xmlRpc = buildXmlRpcPublishPayload({
    title: 'Changed title',
    content: '<p>Changed body</p>',
    postParams: params,
    editorialMetadata: { post_name: 'changed-slug' }
  });
  assert.equal(xmlRpc.post_title, 'Changed title');
  assert.deepEqual(xmlRpc.terms, { category: [ 2 ] });
  assert.deepEqual(xmlRpc.terms_names, { post_tag: [ 'news' ] });
  assert.equal(xmlRpc.post_name, 'changed-slug');
  assert.deepEqual(xmlRpc.post_date, params.datetime);
});
