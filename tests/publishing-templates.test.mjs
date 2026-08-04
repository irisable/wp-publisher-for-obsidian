import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  applyPublishingTemplate,
  createPublishingTemplate,
  normalizePublishingTemplate,
  normalizePublishingTemplates
} = await importTypescriptModule(
  new URL('../src/publishing-templates.ts', import.meta.url)
);

const base = {
  status: 'draft',
  commentStatus: 'open',
  postType: 'post',
  tags: [ 'profile' ]
};

test('creates a complete reusable publishing template', () => {
  assert.deepEqual(createPublishingTemplate('template-1'), {
    id: 'template-1',
    name: '',
    status: 'draft',
    commentStatus: 'open',
    postType: 'post',
    tags: []
  });
});

test('normalizes persisted templates and keeps IDs unique', () => {
  assert.deepEqual(normalizePublishingTemplates([
    {
      id: 'shared',
      name: ' Feature ',
      status: 'private',
      commentStatus: 'closed',
      postType: ' portfolio ',
      tags: [ 'one, two', 'two' ]
    },
    { id: 'shared', name: 'Second', status: 'future' }
  ]), [
    {
      id: 'shared',
      name: 'Feature',
      status: 'private',
      commentStatus: 'closed',
      postType: 'portfolio',
      tags: [ 'one', 'two' ]
    },
    {
      id: 'shared-2',
      name: 'Second',
      status: 'draft',
      commentStatus: 'open',
      postType: 'post',
      tags: []
    }
  ]);
  assert.deepEqual(normalizePublishingTemplates(null), []);
});

test('applies a template over profile defaults', () => {
  const template = normalizePublishingTemplate({
    id: 'private',
    name: 'Private page',
    status: 'private',
    commentStatus: 'closed',
    postType: 'page',
    tags: [ 'template' ]
  });
  assert.deepEqual(
    applyPublishingTemplate(base, template, {}, [ 'post', 'page' ]),
    {
      status: 'private',
      commentStatus: 'closed',
      postType: 'page',
      tags: [ 'template' ]
    }
  );
});

test('keeps explicit WordPress tags and post type ahead of a template', () => {
  const template = normalizePublishingTemplate({
    id: 'feature',
    name: 'Feature',
    status: 'publish',
    postType: 'page',
    tags: [ 'template' ]
  });
  assert.deepEqual(applyPublishingTemplate(
    base,
    template,
    { wpTags: [ 'note', 'local' ], tags: [ 'vault/topic' ] },
    [ 'post', 'page', 'portfolio' ],
    'portfolio'
  ), {
    status: 'publish',
    commentStatus: 'open',
    postType: 'portfolio',
    tags: [ 'note', 'local' ]
  });
  assert.deepEqual(
    applyPublishingTemplate(base, template, {
      wpTags: [],
      tags: [ 'obsidian-only' ]
    }, [ 'post', 'page' ]).tags,
    []
  );
});

test('imports legacy note tags when wpTags has not been established', () => {
  assert.deepEqual(
    applyPublishingTemplate(base, undefined, {
      tags: [ 'legacy-wordpress-tag' ]
    }, [ 'post', 'page' ]).tags,
    [ 'legacy-wordpress-tag' ]
  );
});

test('falls back safely and restores the original defaults without a template', () => {
  const template = normalizePublishingTemplate({
    id: 'invalid',
    name: 'Invalid',
    postType: 'missing'
  });
  assert.equal(
    applyPublishingTemplate(base, template, {}, [ 'post', 'page' ]).postType,
    'post'
  );
  assert.deepEqual(
    applyPublishingTemplate(base, undefined, {}, [ 'post', 'page' ]),
    base
  );
});
