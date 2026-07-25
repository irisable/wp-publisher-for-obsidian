import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeSyncField,
  classifySyncState,
  createLocalSyncDocument,
  createOrUpdateSyncBaseline,
  createRemoteSyncDocument,
  getSyncBaseline,
  moveSyncBaselinesForNote,
  normalizeSyncBaselineCache,
  observeSyncBaseline,
  reconcileSyncBaselineProfiles,
  removeProfileSyncBaselines,
  SyncState,
  upsertSyncBaseline
} from '../src/sync-baseline.ts';
import { PullField } from '../src/sync-diff.ts';

function remote(overrides = {}) {
  return {
    title: 'Shared title',
    body: 'Shared body\n',
    slug: '',
    excerpt: '',
    status: 'draft',
    commentStatus: 'open',
    categoryIds: [ '7' ],
    tagIds: [ '9' ],
    terms: [
      { id: '7', taxonomy: 'category', name: 'News', slug: 'news' },
      { id: '9', taxonomy: 'post_tag', name: 'Obsidian', slug: 'obsidian' }
    ],
    capabilities: {
      slug: true,
      excerpt: true,
      status: true,
      commentStatus: true,
      categories: true,
      tags: true
    },
    ...overrides
  };
}

function identity(overrides = {}) {
  return {
    notePath: 'posts/shared.md',
    profileId: 'profile-a',
    profileName: 'Site A',
    profileEndpoint: 'https://a.example',
    postId: '42',
    postType: 'post',
    ...overrides
  };
}

function documents(overrides = {}) {
  const matter = {
    title: 'Shared title',
    status: 'draft',
    commentStatus: 'open',
    categories: [ 'news' ],
    tags: [ 'Obsidian' ],
    ...overrides
  };
  return {
    local: createLocalSyncDocument({
      noteRaw: '---\ntitle: Shared title\n---\nShared body\n',
      matter,
      fallbackTitle: 'shared'
    }),
    remote: createRemoteSyncDocument({ remote: remote() })
  };
}

function baseline(options = {}) {
  const docs = documents();
  return createOrUpdateSyncBaseline({
    identity: identity(),
    local: docs.local,
    remote: docs.remote,
    fields: [ PullField.Title, PullField.Body, PullField.Status ],
    now: '2026-07-21T01:00:00.000Z',
    ...options
  });
}

test('accepts a direct body that begins with front matter delimiters', () => {
  const document = createLocalSyncDocument({
    noteRaw: '',
    body: '---\nvisible body\n---',
    matter: {},
    fallbackTitle: 'post',
    fields: [ PullField.Body ]
  });
  assert.equal(document.fields.body.value, '---\nvisible body\n---');
});

test('canonicalizes line endings, one conventional final newline and term ordering', () => {
  assert.deepEqual(
    canonicalizeSyncField(PullField.Body, { present: true, value: 'a\r\n\r\n' }),
    { present: true, value: 'a\n' }
  );
  assert.deepEqual(
    canonicalizeSyncField(PullField.Tags, {
      present: true,
      value: [ ' z ', 'a', 'z' ]
    }),
    { present: true, value: [ 'a', 'z' ] }
  );
});

test('treats separate local and remote base representations as agreed', () => {
  const local = createLocalSyncDocument({
    noteRaw: 'Body',
    matter: {},
    fallbackTitle: 'Post',
    fields: [ PullField.Slug ]
  });
  const remoteDoc = createRemoteSyncDocument({
    remote: remote({ slug: '' }),
    fields: [ PullField.Slug ]
  });
  const base = createOrUpdateSyncBaseline({
    identity: identity(),
    local,
    remote: remoteDoc,
    fields: [ PullField.Slug ]
  });
  assert.equal(base.fields.slug.local.present, false);
  assert.equal(base.fields.slug.remote.present, true);
  assert.equal(classifySyncState({ baseline: base, local, remote: remoteDoc }).state, SyncState.InSync);
});

test('classifies local-only, remote-only and simultaneous edits from field hashes', () => {
  const docs = documents();
  const base = baseline();
  const localChanged = createLocalSyncDocument({
    noteRaw: 'Local body',
    matter: { title: 'Shared title', status: 'draft' },
    fallbackTitle: 'shared'
  });
  const remoteChanged = createRemoteSyncDocument({
    remote: remote({ title: 'Remote title' })
  });
  assert.equal(
    classifySyncState({ baseline: base, local: localChanged, remote: docs.remote }).state,
    SyncState.LocalOnly
  );
  assert.equal(
    classifySyncState({ baseline: base, local: docs.local, remote: remoteChanged }).state,
    SyncState.RemoteOnly
  );
  assert.equal(
    classifySyncState({ baseline: base, local: localChanged, remote: remoteChanged }).state,
    SyncState.Diverged
  );
});

test('uses timestamps only as supporting evidence', () => {
  const docs = documents();
  const base = baseline({ remoteModifiedAt: '2026-07-21T00:00:00Z' });
  const result = classifySyncState({
    baseline: base,
    local: docs.local,
    remote: docs.remote,
    remoteModifiedAt: '2026-07-21T02:00:00Z'
  });
  assert.equal(result.state, SyncState.InSync);
  assert.equal(result.remoteMarkerChanged, true);
});

test('reports unknown without a usable baseline and remote-missing explicitly', () => {
  const docs = documents();
  assert.equal(classifySyncState({ local: docs.local, remote: docs.remote }).state, SyncState.Unknown);
  assert.equal(classifySyncState({ remoteMissing: true }).state, SyncState.RemoteMissing);
  assert.equal(classifySyncState({
    baseline: baseline(),
    local: docs.local,
    remote: { fields: {} }
  }).state, SyncState.Unknown);
});

test('a body-only update preserves metadata bases without claiming all fields are current', () => {
  const original = baseline();
  const local = createLocalSyncDocument({
    noteRaw: 'New shared body',
    matter: { title: 'Shared title', status: 'draft' },
    fallbackTitle: 'shared'
  });
  const remoteDoc = createRemoteSyncDocument({
    remote: remote({ body: 'New shared body' })
  });
  const updated = createOrUpdateSyncBaseline({
    existing: original,
    identity: identity(),
    local,
    remote: remoteDoc,
    fields: [ PullField.Body ],
    now: '2026-07-21T02:00:00.000Z'
  });
  assert.equal(updated.fields.title.localHash, original.fields.title.localHash);
  assert.notEqual(updated.fields.body.localHash, original.fields.body.localHash);
  assert.equal(updated.lastObservedState, SyncState.Unknown);
});

test('keeps profile baselines independent and evicts the least recently used entry', () => {
  const older = baseline();
  const newer = baseline({
    identity: identity({ profileId: 'profile-b', profileName: 'Site B' }),
    now: '2026-07-21T02:00:00.000Z'
  });
  let cache = upsertSyncBaseline({ entries: [] }, older).cache;
  cache = upsertSyncBaseline(cache, newer, { maxEntries: 1, maxBytes: 1_000_000 }).cache;
  assert.equal(cache.entries.length, 1);
  assert.equal(cache.entries[0].profileId, 'profile-b');
});

test('persists valid entries through normalization and bounds the cache by bytes', () => {
  const entry = baseline();
  const restored = normalizeSyncBaselineCache(JSON.parse(JSON.stringify({ entries: [ entry ] })));
  assert.equal(getSyncBaseline(restored, entry.notePath, entry.profileId)?.postId, '42');
  assert.throws(() => upsertSyncBaseline(
    { entries: [] },
    entry,
    { maxEntries: 10, maxBytes: 10 }
  ));
});

test('moves note keys, reconciles profile renames and removes deleted profiles', () => {
  const entry = baseline();
  let cache = moveSyncBaselinesForNote({ entries: [ entry ] }, entry.notePath, 'posts/moved.md');
  cache = reconcileSyncBaselineProfiles(cache, [ {
    id: 'profile-a',
    name: 'Renamed A',
    endpoint: 'https://a.example'
  } ]);
  assert.equal(cache.entries[0].notePath, 'posts/moved.md');
  assert.equal(cache.entries[0].profileName, 'Renamed A');
  cache = observeSyncBaseline(cache, 'posts/moved.md', 'profile-a', SyncState.LocalOnly);
  assert.equal(cache.entries[0].lastObservedState, SyncState.LocalOnly);
  assert.equal(removeProfileSyncBaselines(cache, 'profile-a').entries.length, 0);
});

test('invalidates an entry when the profile endpoint changes', () => {
  const cache = reconcileSyncBaselineProfiles({ entries: [ baseline() ] }, [ {
    id: 'profile-a',
    name: 'Site A',
    endpoint: 'https://other.example'
  } ]);
  assert.equal(cache.entries.length, 0);
});
