import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { importTypescriptModule } from './import-typescript-module.mjs';

const { parseSeriesFrontMatter, resolveSeriesPlacement, parseSeriesDefinition } = await importTypescriptModule(new URL('../src/series.ts', import.meta.url));
const { readEditorialFrontMatter, writeBackSeriesGroup } = await importTypescriptModule(new URL('../src/front-matter.ts', import.meta.url));
const { buildRestEditorialMetadata } = await importTypescriptModule(new URL('../src/editorial-metadata.ts', import.meta.url));
const { parseCoreRestRemotePost } = await importTypescriptModule(new URL('../src/remote-post.ts', import.meta.url));
const { buildPullFieldDiffs, applySelectedPullFields } = await importTypescriptModule(new URL('../src/sync-diff.ts', import.meta.url));
const { createLocalSyncDocument, createRemoteSyncDocument } = await importTypescriptModule(new URL('../src/sync-baseline.ts', import.meta.url));

// Keep the real REST client orchestration; replace only its host and network adapters.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/wp-rest-client.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
  plugins: [{ name: 'rest-host-adapter', setup(builder) {
    builder.onResolve({ filter: /^\.\/abstract-wp-client$/ }, () => ({ path: 'host', namespace: 'stub' }));
    builder.onResolve({ filter: /^\.\/rest-client$/ }, () => ({ path: 'network', namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'host'
      ? 'export class AbstractWordPressClient {}'
      : 'export class RestClient {}' }));
  }}]
});
const { WpRestClient, WpRestClientAppPasswordContext } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const auth = { username: 'tester', password: 'test-only' };
const params = (extra = {}) => ({
  postType: 'post', postId: '42', status: 'draft', commentStatus: 'open',
  categories: [], tags: [], title: 'Title', content: 'Body', ...extra
});
const remote = meta => parseCoreRestRemotePost({
  id: 42, type: 'post', title: { raw: 'Title' }, content: { raw: '<p>Body</p>' },
  meta, categories: [], tags: []
});

function clientFixture({ supported = true, canonical = 'Canonical group', restBase = 'posts', termDefinition } = {}) {
  const client = new WpRestClient({ i18n: { t: key => key } }, { endpoint: 'https://example.com' }, new WpRestClientAppPasswordContext());
  const calls = [];
  client.client.httpGetResponse = async path => {
    calls.push(['GET', path]);
    if (path.includes('wptl_series?slug=')) return { status: 200, json: [termDefinition] };
    return { status: 200, json: { slug: 'post', rest_namespace: 'wp/v2', rest_base: restBase, taxonomies: termDefinition ? ['wptl_series'] : [] } };
  };
  client.client.httpOptionsResponse = async path => {
    calls.push(['OPTIONS', path]);
    return { status: 200, json: { schema: { properties: { meta: { properties: supported
      ? { wptl_series_group: { type: 'string' }, ...(termDefinition ? {
        wptl_season_key: { type: 'string' }, wptl_series_role: { type: 'string' },
        wptl_series_scope: { type: 'string' }, wptl_sequence_label: { type: 'string' }
      } : {}) } : {} } } } } };
  };
  client.client.httpPostResponse = async (path, payload) => {
    calls.push(['POST', path, payload]);
    return { status: 200, json: { id: 42, categories: [] } };
  };
  client.fetchRemotePost = async () => remote(canonical === undefined ? {} : { wptl_series_group: canonical });
  return { client, calls };
}

const rc4Fixtures = JSON.parse(await readFile(new URL('./fixtures/wptl-rc4-publisher-requests.json', import.meta.url), 'utf8'));

test('shared rc.4 JSON fixtures equal actual REST client request bodies and round-trip advanced roles', async () => {
  for (const example of rc4Fixtures.requests) {
    const { client, calls } = clientFixture({ termDefinition: rc4Fixtures.term });
    const value = params({ ...readEditorialFrontMatter(example.matter),
      seriesPlacement: parseSeriesFrontMatter(example.matter).intent });
    await client.prepareTransportMetadata(value, auth);
    client.fetchRemotePost = async () => ({
      ...remote({ ...example.initialMeta, ...example.payload.meta }),
      seriesPlacement: value.resolvedSeriesPlacement.portable,
      capabilities: { ...remote(example.payload.meta).capabilities, series: true }
    });
    const result = await client.publish(example.name, example.payload.content, value, auth);
    assert.deepEqual(calls.find(([method]) => method === 'POST')[2], example.payload, example.name);
    assert.equal(result.code, 0, example.name);
    assert.equal(result.data.partialFailure, undefined, example.name);
    if (example.matter.seriesRole && example.matter.seriesRole !== 'article') {
      assert.equal(value.publishedSeriesGroup, undefined);
      assert.equal(value.seriesGroup, example.matter.seriesGroup);
    }
  }
});

test('group-only updates consult remote roles, and unreviewed local roles cannot override them', async () => {
  for (const seriesGroup of ['Historical group', '']) {
    for (const merge of [false, true]) {
      const { client, calls } = clientFixture();
      client.fetchRemotePost = async () => ({ ...remote({ wptl_series_group: 'Historical group' }),
        seriesPlacement: { series: 'writing', seriesRole: 'intro', seriesScope: 'series' } });
      const value = params({ seriesGroup, ...(merge ? {
        updateStrategy: 'merge', updateFields: ['seriesGroup'],
        seriesPlacement: { kind: 'placement', placement: { series: 'writing', seriesRole: 'article' } }
      } : {}) });
      await client.prepareTransportMetadata(value, auth);
      await client.publish('Title', 'Body', value, auth);
      assert.equal(calls.find(([method]) => method === 'POST')[2].meta?.wptl_series_group, undefined);
      assert.equal(value.publishedSeriesGroup, undefined);
      assert.equal(value.seriesGroup, seriesGroup);
    }
  }
});

test('known non-article roles preserve invalid legacy group values without trying to publish or clear them', () => {
  for (const seriesGroup of [null, [], {}, 42]) {
    const matter = { series: 'writing', seriesRole: 'intro', seriesScope: 'series', seriesGroup };
    assert.deepEqual(parseSeriesFrontMatter(matter).issues, []);
    assert.equal(writeBackSeriesGroup(matter, { ...matter }, undefined), false);
    assert.equal(matter.seriesGroup, seriesGroup);
  }
});

test('group input distinguishes omitted, explicit empty, valid text, and invalid YAML types', () => {
  assert.equal(Object.hasOwn(readEditorialFrontMatter({}), 'seriesGroup'), false);
  assert.equal(readEditorialFrontMatter({ seriesGroup: '' }).seriesGroup, '');
  assert.equal(readEditorialFrontMatter({ seriesGroup: ' W1 Group ' }).seriesGroup, 'W1 Group');
  for (const value of [null, undefined, 1, false, [], {}]) {
    assert.equal(parseSeriesFrontMatter({ series: 'writing', seriesGroup: value }).issues[0].code, 'series_invalid_group');
  }
  assert.deepEqual(parseSeriesFrontMatter({ seriesGroup: '' }).issues, []);
  assert.deepEqual(parseSeriesFrontMatter({ seriesGroup: 'Group' }).issues, []);
});

test('group metadata merges with the selected season and subtitle without guessing season keys', () => {
  const definition = parseSeriesDefinition({ id: 3, slug: 'writing', name: 'Writing', meta: {
    wptl_series_mode: 'ordered', wptl_series_structure: 'seasoned',
    wptl_seasons: [{ key: 'internal-key', label: 'Season 7', public_id: 7, sort: 1 }]
  } });
  const placement = resolveSeriesPlacement(parseSeriesFrontMatter({ series: 'writing', seriesSeason: 7 }).intent, definition);
  const payload = buildRestEditorialMetadata({ resolvedSeriesPlacement: placement,
    resolvedSeriesGroup: 'Group', secondaryTitle: 'Subtitle', secondaryTitleOwner: 'wptl' });
  assert.equal(payload.meta.wptl_season_key, 'internal-key');
  assert.equal(payload.meta.wptl_series_group, 'Group');
  assert.equal(payload.meta.wptl_subtitle, 'Subtitle');
  assert.deepEqual(payload.wptl_series, [3]);
  assert.equal(Object.hasOwn(buildRestEditorialMetadata({ resolvedSeriesPlacement: placement }).meta, 'wptl_series_group'), false);
  assert.deepEqual(buildRestEditorialMetadata({ resolvedSeriesGroup: '' }), { meta: { wptl_series_group: '' } });
});

test('REST publication probes the schema, follows the post type route, and accepts canonical alias readback', async () => {
  const { client, calls } = clientFixture({ restBase: 'stories' });
  const value = params({ seriesGroup: 'Old alias' });
  await client.prepareTransportMetadata(value, auth);
  const result = await client.publish('Title', '<p>Body</p>', value, auth);
  assert.equal(result.code, 0);
  assert.equal(result.data.partialFailure, undefined);
  assert.equal(value.publishedSeriesGroup, 'Canonical group');
  assert.ok(calls.some(([method, path]) => method === 'OPTIONS' && path === 'wp-json/wp/v2/stories'));
  const post = calls.find(([method]) => method === 'POST');
  assert.equal(post[1], 'wp-json/wp/v2/stories/42');
  assert.equal(post[2].meta.wptl_series_group, 'Old alias');
  assert.equal(Object.hasOwn(post[2], 'wptl_series'), false);
});

test('unsupported sites allow omitted groups and reject requested writes before posting', async () => {
  const { client, calls } = clientFixture({ supported: false });
  await client.prepareTransportMetadata(params(), auth);
  for (const seriesGroup of ['Group', '']) {
    await assert.rejects(client.prepareTransportMetadata(params({ seriesGroup }), auth), /error_seriesGroupUnsupported/);
  }
  assert.equal(calls.some(([method]) => method === 'POST'), false);
});

test('explicit clearing sends an empty string and requires empty readback', async () => {
  const { client, calls } = clientFixture({ canonical: '' });
  const value = params({ seriesGroup: '' });
  await client.prepareTransportMetadata(value, auth);
  await client.publish('Title', 'Body', value, auth);
  assert.equal(calls.find(([method]) => method === 'POST')[2].meta.wptl_series_group, '');
  assert.equal(value.publishedSeriesGroup, '');

  const failed = clientFixture({ canonical: 'Still in group' }).client;
  const rejected = params({ seriesGroup: '' });
  await failed.prepareTransportMetadata(rejected, auth);
  const result = await failed.publish('Title', 'Body', rejected, auth);
  assert.equal(result.data.partialFailure, true);
  assert.equal(rejected.publishedSeriesGroup, undefined);
});

test('content-only and unrelated merge updates omit groups while a reviewed group can be cleared', async () => {
  for (const overrides of [
    { updateStrategy: 'content-only' },
    { updateStrategy: 'merge', updateFields: ['title'] }
  ]) {
    const { client, calls } = clientFixture();
    const value = params({ seriesGroup: 'Group', ...overrides });
    await client.prepareTransportMetadata(value, auth);
    await client.publish('Title', 'Body', value, auth);
    assert.equal(calls.find(([method]) => method === 'POST')[2].meta, undefined);
    assert.equal(value.publishedSeriesGroup, undefined);
  }
  const { client, calls } = clientFixture({ canonical: '' });
  const value = params({ seriesGroup: '', updateStrategy: 'merge', updateFields: ['seriesGroup'] });
  await client.prepareTransportMetadata(value, auth);
  await client.publish('Title', 'Body', value, auth);
  assert.deepEqual(calls.find(([method]) => method === 'POST')[2], { meta: { wptl_series_group: '' } });
});

test('canonical writeback preserves concurrent edits, property removal, and unrelated front matter', () => {
  const original = { seriesGroup: 'Old alias' };
  const unchanged = { ...original, custom: 'Keep me' };
  assert.equal(writeBackSeriesGroup(unchanged, original, 'Canonical group'), true);
  assert.deepEqual(unchanged, { seriesGroup: 'Canonical group', custom: 'Keep me' });
  for (const current of [{ seriesGroup: 'Edited' }, { seriesGroup: '' }, {}]) {
    const saved = { ...current };
    assert.equal(writeBackSeriesGroup(current, original, 'Canonical group'), false);
    assert.deepEqual(current, saved);
  }
  assert.equal(writeBackSeriesGroup({}, {}, undefined), false);
  const empty = { seriesGroup: 'Old alias' };
  assert.equal(writeBackSeriesGroup(empty, original, ''), true);
  assert.equal(empty.seriesGroup, '');
});

test('pull and baseline retain explicit empty groups and expose old-server fields as unavailable', () => {
  const source = { ...remote({ wptl_series_group: '' }), body: 'Body' };
  const matter = { seriesGroup: 'Local group', custom: 'Keep' };
  const diffs = buildPullFieldDiffs({ noteRaw: 'Body', fallbackTitle: 'Title', matter, remote: source });
  const group = diffs.find(diff => diff.key === 'seriesGroup');
  assert.equal(group.available, true);
  assert.equal(group.changed, true);
  const pulled = applySelectedPullFields(matter, diffs, new Set(['seriesGroup']));
  assert.deepEqual(pulled, { seriesGroup: '', custom: 'Keep' });
  assert.deepEqual(createLocalSyncDocument({ noteRaw: 'Body', fallbackTitle: 'Title', matter: pulled }).fields.seriesGroup, { present: true, value: '' });
  assert.deepEqual(createRemoteSyncDocument({ remote: source }).fields.seriesGroup, { present: true, value: '' });
  assert.equal(createRemoteSyncDocument({ remote: { ...remote({}), body: 'Body' } }).fields.seriesGroup, undefined);
});
