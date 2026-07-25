import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const { resolveProfileNoteTarget, resolveStableProfileNoteTargets } = await importTypescriptModule(
  new URL('../src/profile-note-target.ts', import.meta.url)
);

const profile = {
  id: 'wp-profile-production',
  name: 'Production',
  endpoint: 'https://example.com/'
};

function options(overrides = {}) {
  return {
    store: {},
    notePath: 'Articles/example.md',
    profile,
    matter: {},
    publishHistory: [],
    defaultPostType: 'post',
    ...overrides
  };
}

test('prefers the stable profile target over front matter and history', () => {
  const stored = {
    profileId: profile.id,
    profileName: 'Old profile name',
    endpoint: profile.endpoint,
    postId: '101',
    postType: 'article',
    updatedAt: '2030-01-03T00:00:00Z'
  };
  const result = resolveProfileNoteTarget(options({
    store: { 'Articles/example.md': { [profile.id]: stored } },
    matter: { wpProfile: 'Production', wpPostId: '202' },
    publishHistory: [ {
      id: 'history',
      timestamp: '2030-01-04T00:00:00Z',
      outcome: 'success',
      action: 'create',
      notePath: 'Articles/example.md',
      noteTitle: 'Example',
      profileName: 'Production',
      endpoint: 'https://example.com',
      postType: 'post',
      postId: '303'
    } ]
  }));
  assert.equal(result?.postId, '101');
  assert.equal(result?.postType, 'article');
});

test('imports a matching legacy front matter target', () => {
  const result = resolveProfileNoteTarget(options({
    matter: {
      wpProfile: 'Production',
      wpPostId: 42,
      wpPostType: 'page',
      wpLastPublishedAt: '2030-01-02T03:04:05+08:00'
    }
  }));
  assert.equal(result?.postId, '42');
  assert.equal(result?.postType, 'page');
  assert.equal(result?.updatedAt, '2030-01-01T19:04:05.000Z');
});

test('uses the newest successful matching history target as a final fallback', () => {
  const history = [ '11', '22' ].map((postId, index) => ({
    id: 'history-' + postId,
    timestamp: '2030-01-0' + (index + 2) + 'T00:00:00Z',
    outcome: 'success',
    action: 'full-update',
    notePath: 'Articles/example.md',
    noteTitle: 'Example',
    profileName: 'Production',
    endpoint: 'https://example.com',
    postType: 'post',
    postId
  }));
  assert.equal(resolveProfileNoteTarget(options({ publishHistory: history }))?.postId, '22');
  assert.equal(resolveProfileNoteTarget(options({
    matter: { wpProfile: 'Other', wpPostId: '9' },
    publishHistory: []
  })), undefined);
});

test('resolves every explicit stable profile target without using history', () => {
  const second = {
    id: 'wp-profile-second',
    name: 'Second',
    endpoint: 'https://second.example.com'
  };
  const stored = {
    profileId: second.id,
    profileName: second.name,
    endpoint: second.endpoint,
    postId: '88',
    postType: 'page',
    updatedAt: '2030-01-05T00:00:00Z'
  };
  const targets = resolveStableProfileNoteTargets({
    store: { 'Articles/example.md': { [second.id]: stored } },
    notePath: 'Articles/example.md',
    profiles: [ profile, second ],
    matter: {
      wpProfile: 'Production',
      wpPostId: '42',
      wpPostType: 'post'
    }
  });
  assert.deepEqual(targets.map(target => [ target.profileId, target.postId ]), [
    [ profile.id, '42' ],
    [ second.id, '88' ]
  ]);
});

test('does not accept a stored target after its profile endpoint changes', () => {
  const stored = {
    profileId: profile.id,
    profileName: profile.name,
    endpoint: 'https://old.example.com',
    postId: '55',
    postType: 'post',
    updatedAt: '2030-01-05T00:00:00Z'
  };
  assert.deepEqual(resolveStableProfileNoteTargets({
    store: { 'Articles/example.md': { [profile.id]: stored } },
    notePath: 'Articles/example.md',
    profiles: [ profile ],
    matter: {}
  }), []);
});
