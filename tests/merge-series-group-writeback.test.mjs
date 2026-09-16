import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { importTypescriptModule } from './import-typescript-module.mjs';

const transaction = await importTypescriptModule(new URL('../src/note-sync-transaction.ts', import.meta.url));
const baseline = await importTypescriptModule(new URL('../src/sync-baseline.ts', import.meta.url));
const { parseCoreRestRemotePost } = await importTypescriptModule(new URL('../src/remote-post.ts', import.meta.url));
const { writeBackMergedSeriesGroup } = await importTypescriptModule(new URL('../src/merge-series-group-writeback.ts', import.meta.url));

// Run the real modal -> publishPost -> baseline/history -> undo orchestration without UI or network.
const stubs = {
  obsidian: 'export class Notice {} export class TFile {} export const stringifyYaml = v => JSON.stringify(v); export const parseYaml = JSON.parse; export const getFrontMatterInfo = () => ({});',
  './abstract-modal': 'export class AbstractModal { constructor(plugin) { this.plugin = plugin; } t(key) { return key; } }',
  './wp-publish-modal': 'export class WpPublishModal {}',
  './wp-clients': 'export function getWordPressClient() {}',
  './utils': 'export function isPromiseFulfilledResult(v) { return v.status === "fulfilled"; } export function openWithBrowser() {} export function processFile() {} export function showError() {}',
  './app-state': 'export const AppState = {};',
  './confirm-modal': 'export const ConfirmCode = {}; export function openConfirmModal() {}',
  './post-published-modal': 'export function openPostPublishedModal() {}',
  './wp-login-modal': 'export function openLoginModal() {}',
  './sync-state-panel': 'export function renderSyncStatePanel() {}',
  './sync-media-runtime': 'export function restoreCachedRemoteMedia() {}'
};
const bundle = await build({
  stdin: {
    contents: 'export { AbstractWordPressClient } from "./src/abstract-wp-client"; export { WpSyncConflictModal } from "./src/wp-sync-conflict-modal";',
    resolveDir: fileURLToPath(new URL('..', import.meta.url))
  },
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
  plugins: [{ name: 'merge-host-adapter', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
      ? { path: args.path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path] }));
    builder.onLoad({ filter: /wp-sync-conflict-modal\.ts$/ }, async args => ({
      contents: await readFile(args.path, 'utf8') + '\nexport { WpSyncConflictModal };', loader: 'ts'
    }));
  }}]
});
const { AbstractWordPressClient, WpSyncConflictModal } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const identity = {
  notePath: 'Posts/example.md', profileId: 'site', profileName: 'Test site',
  endpoint: 'https://example.invalid', postId: '42', postType: 'post'
};
const before = '---\r\nseriesGroup: Original\r\ncustom: keep\r\n---\r\nOriginal body\r\n';
const rawFor = matter => '---\r\n' + JSON.stringify(matter) + '\r\n---\r\nMerged body\r\n';

async function fixture({ group = 'Old alias', canonical = 'Canonical label', fields = ['seriesGroup'], confirmed = true, omitGroup = false } = {}) {
  const matter = { ...(!omitGroup ? { seriesGroup: group } : {}), custom: 'keep' };
  const raw = rawFor(matter);
  let current = raw;
  let duringProcess;
  let duringPublish;
  let failSave;
  let writes = 0;
  let persisted;
  const snapshot = await transaction.createPullRestoreSnapshot({ ...identity, beforeContent: before, appliedContent: raw });
  const settings = {
    pullRestoreSnapshots: [snapshot], syncBaselineCache: { entries: [] }, multiSiteTargets: {}, publishHistory: [],
    defaultPostStatus: 'draft', defaultCommentStatus: 'open', contentFormat: 'gutenberg'
  };
  const plugin = {
    app: { vault: {
      read: async () => current,
      process: async (_file, transform) => {
        if (duringProcess) { const hook = duringProcess; duringProcess = undefined; hook(); }
        current = transform(current);
        writes++;
        return current;
      }
    } },
    settings,
    i18n: { t: (key, vars = {}) => key + JSON.stringify(vars) },
    saveSettings: async () => {
      if (failSave?.()) throw new Error('settings save failed');
      persisted = structuredClone(settings);
    }
  };
  await plugin.saveSettings();
  const profile = { id: identity.profileId, name: identity.profileName, endpoint: identity.endpoint };
  const client = new AbstractWordPressClient(plugin, profile);
  client.getAuth = async () => ({ username: 'test', password: 'test-only' });
  client.getCategories = async () => [];
  client.prepareTransportMetadata = async params => {
    delete params.publishedSeriesGroup;
  };
  client.publish = async (_title, _html, params) => {
    if (duringPublish) await duringPublish();
    if (confirmed && params.seriesGroup !== undefined && params.updateFields.includes('seriesGroup')) {
      params.publishedSeriesGroup = canonical;
    }
    return { code: 0, data: { postId: '42', categories: [],
      ...(!confirmed ? { partialFailure: true, warnings: ['readback failed'] } : {}) } };
  };
  client.fetchRemotePost = async () => parseCoreRestRemotePost({
    id: 42, type: 'post', title: { raw: 'Example' }, content: { raw: '<p>Merged body</p>' },
    meta: { wptl_series_group: canonical }, categories: [], tags: []
  });
  const file = { path: identity.notePath, name: 'example.md', basename: 'example' };
  const modal = new WpSyncConflictModal(plugin, file);
  modal.selected = { profile, target: { postId: '42', postType: 'post' }, linkedAt: snapshot.createdAt };
  modal.client = client;
  modal.restoreSnapshot = snapshot;
  modal.frozen = await transaction.freezeNoteRevision(raw);
  modal.render = () => {};
  const built = {
    raw, matter, body: 'Merged body\r\n', fields, outbound: '',
    document: baseline.createLocalSyncDocument({ noteRaw: raw, matter, fallbackTitle: 'example', fields })
  };
  modal.appliedMerge = built;
  return {
    plugin, client, modal, built, snapshot, raw,
    current: () => current, persisted: () => persisted, writes: () => writes,
    edit: value => { current = value; },
    onProcess: hook => { duringProcess = hook; },
    onPublish: hook => { duringPublish = hook; },
    onSave: hook => { failSave = hook; },
    publish: async () => {
      const result = await modal.publishBuiltMerge(built);
      await modal.finishPublishResult(result, built);
      return result;
    }
  };
}

test('merge publishes an alias, backfills canonical name, advances baseline and undo hash, then undoes exact bytes', async () => {
  const f = await fixture();
  const result = await f.publish();
  assert.equal(result.code, 0);
  assert.equal(result.data.canonicalSeriesGroup, 'Canonical label');
  assert.equal(result.data.syncBaselineUpdated, true);
  assert.equal(result.data.partialFailure, undefined);
  assert.equal(f.modal.phase, 'success');
  assert.equal(f.built.matter.seriesGroup, 'Canonical label');
  assert.equal(f.built.matter.custom, 'keep');
  assert.equal(f.built.document.fields.seriesGroup.value, 'Canonical label');
  assert.equal(f.built.raw, f.current());
  assert.ok(f.current().endsWith('Merged body\r\n'));
  assert.equal(f.modal.frozen.hash, await transaction.hashNoteRevision(f.current()));
  const stored = f.persisted().pullRestoreSnapshots[0];
  assert.equal(stored.id, f.snapshot.id);
  assert.equal(stored.beforeContent, before);
  assert.equal(stored.beforeHash, f.snapshot.beforeHash);
  assert.equal(stored.appliedHash, f.modal.frozen.hash);
  const base = f.persisted().syncBaselineCache.entries[0];
  assert.deepEqual(base.fields.seriesGroup.local, { present: true, value: 'Canonical label' });
  assert.deepEqual(base.fields.seriesGroup.local, base.fields.seriesGroup.remote);
  assert.equal(base.fields.seriesGroup.localHash, base.fields.seriesGroup.remoteHash);
  assert.equal(base.localHash, base.remoteHash);
  assert.equal(f.persisted().publishHistory[0].outcome, 'success');
  await f.modal.undoLocalMerge();
  assert.equal(f.current(), before);
  assert.equal(f.modal.phase, 'undone');
  assert.deepEqual(f.persisted().pullRestoreSnapshots, []);
});

test('canonical backfill preserves an explicit empty string and leaves matching values byte-for-byte intact', async () => {
  for (const canonical of ['', 'Canonical label']) {
    const f = await fixture({ group: canonical, canonical });
    const result = await f.publish();
    assert.equal(result.data.canonicalSeriesGroup, canonical);
    assert.equal(f.current(), f.raw);
    assert.equal(f.writes(), 0);
    assert.equal(f.persisted().syncBaselineCache.entries[0].fields.seriesGroup.local.value, canonical);
    await f.modal.undoLocalMerge();
    assert.equal(f.current(), before);
  }
});

test('omitted or unselected groups and failed verification never invoke canonical writeback', async () => {
  for (const options of [{ omitGroup: true }, { fields: ['title'] }, { confirmed: false }]) {
    const f = await fixture(options);
    const result = await f.publish();
    assert.equal(result.data.canonicalSeriesGroup, undefined);
    assert.equal(f.current(), f.raw);
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.persisted().pullRestoreSnapshots[0], f.snapshot);
    if (options.confirmed === false) {
      assert.equal(result.data.syncBaselineUpdated, false);
      assert.equal(f.modal.phase, 'partial');
    }
  }
});

test('edits during publishing and between read/process are never overwritten or accepted as a fresh baseline', async () => {
  for (const timing of ['publish', 'process']) {
    for (const edit of ['User edited body', rawFor({ custom: 'group removed' }), rawFor({ seriesGroup: 'User group' })]) {
      const f = await fixture();
      const oldCache = f.plugin.settings.syncBaselineCache;
      if (timing === 'publish') f.onPublish(() => f.edit(edit));
      else f.onProcess(() => f.edit(edit));
      const result = await f.publish();
      assert.equal(f.current(), edit);
      assert.equal(f.writes(), 0);
      assert.equal(result.data.partialFailure, true);
      assert.equal(result.data.syncBaselineUpdated, false);
      assert.equal(f.plugin.settings.syncBaselineCache, oldCache);
      assert.equal(f.modal.phase, 'partial');
      assert.equal(f.persisted().publishHistory[0].outcome, 'partial');
      assert.deepEqual(f.persisted().pullRestoreSnapshots[0], f.snapshot);
      assert.equal(f.built.raw, f.raw);
      await assert.rejects(transaction.undoGuardedPull(f.plugin.app.vault, {}, f.snapshot), /changed after the pull/);
    }
  }
});

test('failed restore persistence prevents backfill while retaining the original undo snapshot', async () => {
  const f = await fixture();
  let attempts = 0;
  f.onSave(() => ++attempts === 1);
  const result = await f.publish();
  assert.equal(result.data.partialFailure, true);
  assert.equal(result.data.syncBaselineUpdated, false);
  assert.equal(f.writes(), 0);
  assert.equal(f.current(), f.raw);
  assert.deepEqual(f.persisted().pullRestoreSnapshots[0], f.snapshot);
  await f.modal.undoLocalMerge();
  assert.equal(f.current(), before);
});

test('later edits after canonicalization remain protected from undo', async () => {
  const f = await fixture();
  await f.publish();
  f.edit(f.current() + 'Later edit');
  const edited = f.current();
  await assert.rejects(transaction.undoGuardedPull(f.plugin.app.vault, {}, f.modal.restoreSnapshot), /changed after the pull/);
  assert.equal(f.current(), edited);
});

test('baseline persistence failure after backfill keeps the new restore hash and allows exact undo', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = await fixture();
  let failed = false;
  f.onSave(() => {
    if (!failed && f.plugin.settings.syncBaselineCache.entries.length > 0) {
      failed = true;
      return true;
    }
    return false;
  });
  const result = await f.publish();
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(result.data.partialFailure, true);
  assert.equal(result.data.syncBaselineUpdated, false);
  assert.equal(f.built.matter.seriesGroup, 'Canonical label');
  assert.deepEqual(f.persisted().syncBaselineCache.entries, []);
  assert.equal(f.persisted().pullRestoreSnapshots[0].appliedHash, await transaction.hashNoteRevision(f.current()));
  await f.modal.undoLocalMerge();
  assert.equal(f.current(), before);
});

test('an edit after guarded backfill is not silently absorbed into the synchronized baseline', async () => {
  const f = await fixture();
  const fetch = f.client.fetchRemotePost;
  f.client.fetchRemotePost = async () => {
    f.edit(rawFor({ seriesGroup: 'Later user group', custom: 'keep' }));
    return fetch();
  };
  const result = await f.publish();
  assert.equal(result.data.syncBaselineUpdated, true);
  const base = f.persisted().syncBaselineCache.entries[0];
  const local = baseline.createLocalSyncDocument({
    noteRaw: f.current(), matter: { seriesGroup: 'Later user group' }, fallbackTitle: 'example', fields: ['seriesGroup']
  });
  const state = baseline.classifySyncState({
    baseline: base, local,
    remote: { fields: { seriesGroup: { present: true, value: 'Canonical label' } } }
  });
  assert.equal(state.state, baseline.SyncState.LocalOnly);
  assert.equal(base.fields.seriesGroup.local.value, 'Canonical label');
  await assert.rejects(transaction.undoGuardedPull(f.plugin.app.vault, {}, f.modal.restoreSnapshot), /changed after the pull/);
});

test('empty canonical helper output is not confused with omitted readback', async () => {
  const f = await fixture();
  const updated = await writeBackMergedSeriesGroup({
    store: f.plugin.app.vault, file: {}, frozen: f.modal.frozen, matter: f.built.matter,
    canonical: '', restoreSnapshot: f.snapshot, stringifyMatter: JSON.stringify, saveRestore: async () => {}
  });
  assert.equal(updated.matter.seriesGroup, '');
  assert.equal(updated.restoreSnapshot.appliedHash, await transaction.hashNoteRevision(f.current()));
});
