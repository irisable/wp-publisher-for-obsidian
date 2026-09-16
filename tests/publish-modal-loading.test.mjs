import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { descendants, input } from './publish-modal-dom.mjs';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/wp-publish-modal.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
  plugins: [{ name: 'obsidian-test-adapter', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: fileURLToPath(new URL('./publish-modal-dom.mjs', import.meta.url)) }));
    build.onResolve({ filter: /\/wp-publish-preview-modal$/ }, () => ({ path: 'preview', namespace: 'stub' }));
    build.onResolve({ filter: /\/confirm-modal$/ }, () => ({ path: 'confirm', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'preview'
      ? 'export function openPublishPreviewModal() {}'
      : 'export const ConfirmCode = {Confirm: 1}; export async function openConfirmModal() { return {code: 1}; }' }));
  }}]
});
const { WpPublishModal } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const term = (id, slug, extra = {}) => ({ id: String(id), slug, name: slug, parent: 0, ...extra });
const catalog = (postType, definitions = [], editorial = true) => ({
  catalog: { transport: 'rest', definitions, supportedPostTypes: [postType], subtitlePostTypes: [postType] },
  editorial: { secondaryTitle: editorial, focusKeyword: editorial, metaDescription: editorial }
});

function fixture(matter = {}, overrides = {}) {
  const types = Promise.withResolvers();
  const categories = [];
  const series = [];
  const submitted = [];
  let dismissed = 0;
  const modal = new WpPublishModal({
    app: {}, settings: { publishingTemplates: [] },
    i18n: { t: (key, vars = {}) => key + (Object.keys(vars).length ? JSON.stringify(vars) : '') }
  }, matter.categories, { items: ['post', 'page'], selected: 'post' },
  { mode: 'create', selectedProfileName: 'test' }, {
    loadPostTypes: () => types.promise,
    loadCategories: selected => {
      const request = { selected, ...Promise.withResolvers() };
      categories.push(request);
      return request.promise;
    },
    loadSeries: (postType, selected) => {
      const request = { postType, selected, ...Promise.withResolvers() };
      series.push(request);
      return request.promise;
    }, ...overrides
  }, { status: 'draft', commentStatus: 'open', postType: 'post', tags: [] },
  { title: 'Test', content: 'Body', sourcePath: 'test.md' },
  async params => { submitted.push(params); return true; }, matter,
  () => { dismissed++; });
  const nodes = () => descendants(modal.contentEl);
  return {
    modal, types, categories, series, submitted, nodes,
    dismissed: () => dismissed,
    field: placeholder => nodes().find(el => el.placeholder === placeholder),
    button: text => nodes().find(el => el.tag === 'button' && el.text === text),
    submit: () => nodes().find(el => el.classList.contains('wp-publisher-submit-button'))
  };
}

test('real modal renders before all network promises resolve and preserves edits on arrival', async () => {
  const f = fixture({ categories: ['essays'], series: 'writing', subtitle: 'Keep subtitle', focus_keyword: 'Keep keyword' });
  f.modal.open();
  const excerpt = f.field('publishModal_excerptPlaceholder');
  assert.ok(excerpt.isConnected);
  assert.equal(f.submit().disabled, true);
  assert.deepEqual(f.categories[0].selected, ['essays']);
  assert.equal(f.series[0].selected, 'writing');
  input(excerpt, 'Edited during loading');
  f.types.resolve(['post', 'page']);
  f.categories[0].resolve([term(12, 'essays')]);
  f.series[0].resolve(catalog('post'));
  await flush();
  assert.equal(f.field('publishModal_excerptPlaceholder'), excerpt);
  assert.equal(excerpt.value, 'Edited during loading');
  assert.equal(f.field('publishModal_secondaryTitlePlaceholder').value, 'Keep subtitle');
  assert.equal(f.submit().disabled, false);
  await f.submit().fire();
  assert.deepEqual(f.submitted[0].categories, [12]);
  assert.equal(f.submitted[0].excerpt, 'Edited during loading');
  assert.equal(f.submitted[0].secondaryTitle, 'Keep subtitle');
  assert.equal(f.submitted[0].focusKeyword, 'Keep keyword');
  f.modal.close();
});

test('opening with no series skips its collection; search loads catalogs once and keeps selections', async () => {
  const f = fixture({ categories: ['essays'] });
  f.modal.open();
  assert.equal(f.series[0].selected, null);
  f.types.resolve(['post']);
  f.categories[0].resolve([term(12, 'essays')]);
  f.series[0].resolve(catalog('post'));
  await flush();
  const search = f.field('publishModal_searchCategories');
  input(search, 'old');
  input(search, 'older');
  assert.equal(f.categories.length, 2);
  assert.equal(f.categories[1].selected, undefined);
  assert.equal(f.submit().disabled, false);
  const selected = f.nodes().find(el => el.type === 'checkbox' && el.checked);
  selected.checked = false;
  await selected.fire('change');
  f.categories[1].resolve([term(12, 'essays'), term(13, 'older', { deprecated: true })]);
  await flush();
  assert.equal(f.field('publishModal_searchCategories'), search);
  assert.equal(f.button('publishModal_loadAllCategories').classList.contains('is-hidden'), true);
  await f.submit().fire();
  assert.deepEqual(f.submitted[0].categories, []);
  f.modal.close();
});

test('switching post types discards stale series capability responses', async () => {
  const f = fixture();
  f.modal.open();
  f.types.resolve(['post', 'page']);
  f.categories[0].resolve([term(1, 'uncategorized')]);
  await flush();
  const type = f.nodes().find(el => el.tag === 'select' && el.value === 'post');
  input(type, 'page');
  assert.equal(f.series[1].postType, 'page');
  f.series[1].resolve(catalog('page', [], false));
  await flush();
  f.series[0].resolve(catalog('post', [], true));
  await flush();
  assert.equal(f.field('publishModal_secondaryTitlePlaceholder').disabled, true);
  assert.equal(f.submit().disabled, false);
  f.modal.close();
});

test('missing categories block publishing until explicitly corrected, and close ignores pending work', async () => {
  const f = fixture({ categories: ['missing'] });
  f.modal.open();
  f.types.resolve(['post']);
  f.categories[0].resolve([]);
  f.series[0].resolve(catalog('post'));
  await flush();
  assert.equal(f.submit().disabled, true);
  await f.button('publishModal_confirmCategories').fire();
  assert.equal(f.submit().disabled, false);
  await f.button('publishModal_loadAllCategories').fire();
  f.modal.close();
  f.categories[1].resolve([term(33, 'late')]);
  await flush();
  assert.deepEqual(f.modal.contentEl.children, []);
  assert.equal(f.dismissed(), 1);
});

test('initial connection failures are retryable without resetting an edited field', async () => {
  const f = fixture({ categories: ['essays'] });
  f.modal.open();
  const excerpt = f.field('publishModal_excerptPlaceholder');
  input(excerpt, 'Retain on retry');
  f.types.resolve(['post']);
  f.categories[0].reject(new Error('offline'));
  f.series[0].resolve(catalog('post'));
  await flush();
  assert.equal(f.submit().disabled, true);
  await f.button('publishModal_catalogRetry').fire();
  f.categories[1].resolve([term(12, 'essays')]);
  await flush();
  assert.equal(f.field('publishModal_excerptPlaceholder'), excerpt);
  assert.equal(excerpt.value, 'Retain on retry');
  assert.equal(f.submit().disabled, false);
  f.modal.close();
});

const bookSeries = (extra = {}) => ({
  termId: 90, name: 'Writing', slug: 'writing', mode: 'ordered', structure: 'seasoned',
  bookStructureEnabled: true, seasons: [{ key: 's1', label: 'One', publicId: 1, sort: 10 }], ...extra
});
const settingControl = (f, name) => f.nodes().find(el => el.name === name)?.children[0]?.children[0];
async function readySeries(matter, definition = bookSeries()) {
  const f = fixture(matter);
  f.modal.open();
  f.types.resolve(['post']);
  f.categories[0].resolve([term(1, 'uncategorized')]);
  f.series[0].resolve(catalog('post', [definition]));
  await flush();
  return f;
}

test('role then scope then season controls normalize transitions without destroying a saved group or label', async () => {
  const f = await readySeries({ series: 'writing', seriesSeason: 1, seriesLabel: 'Custom label', seriesGroup: 'Saved group' });
  input(settingControl(f, 'publishModal_seriesRole'), 'intro');
  assert.equal(settingControl(f, 'publishModal_seriesScope').value, 'season');
  assert.equal(settingControl(f, 'publishModal_seriesSeason').value, '1');
  assert.equal(settingControl(f, 'publishModal_seriesGroup'), undefined);
  const names = f.nodes().filter(el => el.name).map(el => el.name);
  assert.ok(names.indexOf('publishModal_seriesRole') < names.indexOf('publishModal_seriesScope'));
  assert.ok(names.indexOf('publishModal_seriesScope') < names.indexOf('publishModal_seriesSeason'));
  input(settingControl(f, 'publishModal_seriesScope'), 'series');
  assert.equal(settingControl(f, 'publishModal_seriesSeason'), undefined);
  input(settingControl(f, 'publishModal_seriesRole'), 'article');
  assert.equal(settingControl(f, 'publishModal_seriesScope'), undefined);
  assert.equal(settingControl(f, 'publishModal_seriesSeason').value, '');
  assert.equal(settingControl(f, 'publishModal_seriesGroup').value, 'Saved group');
  input(settingControl(f, 'publishModal_seriesSeason'), '1');
  await f.submit().fire();
  assert.deepEqual(f.submitted[0].seriesPlacement.placement, {
    series: 'writing', seriesRole: 'article', seriesSeason: 1, seriesLabel: 'Custom label'
  });
  assert.equal(f.submitted[0].seriesGroup, 'Saved group');
  f.modal.close();
});

test('reselecting the same Series preserves advanced role, scope, season and independent public label', async () => {
  const f = await readySeries({ series: 'writing', seriesRole: 'appendix', seriesScope: 'season', seriesSeason: 1,
    seriesLabel: 'Reading notes', seriesGroup: 'Historical group' });
  const radio = f.nodes().find(el => el.attributes.type === 'radio' && el.checked);
  await radio.fire('change');
  assert.equal(settingControl(f, 'publishModal_seriesRole').value, 'appendix');
  assert.equal(settingControl(f, 'publishModal_seriesScope').value, 'season');
  assert.equal(settingControl(f, 'publishModal_seriesSeason').value, '1');
  assert.equal(settingControl(f, 'publishModal_seriesLabel').value, 'Reading notes');
  assert.equal(settingControl(f, 'publishModal_seriesGroup'), undefined);
  await f.submit().fire();
  assert.equal(f.submitted[0].seriesGroup, 'Historical group');
  assert.equal(f.submitted[0].seriesPlacement.placement.seriesRole, 'appendix');
  f.modal.close();
});

test('unknown book capability allows correcting a read-back role to article but does not offer advanced writes', async () => {
  const f = await readySeries({ series: 'writing', seriesRole: 'intro', seriesScope: 'series' }, bookSeries({ bookStructureEnabled: false }));
  const role = settingControl(f, 'publishModal_seriesRole');
  assert.deepEqual(role.children.map(option => option.attributes.value), ['article', 'intro']);
  assert.equal(settingControl(f, 'publishModal_seriesScope').disabled, true);
  assert.ok(f.nodes().some(el => el.text === 'publishModal_seriesAdvancedUnsupported'));
  input(role, 'article');
  assert.deepEqual(settingControl(f, 'publishModal_seriesRole').children.map(option => option.attributes.value), ['article']);
  assert.equal(settingControl(f, 'publishModal_seriesScope'), undefined);
  f.modal.close();
});

test('existing seasoned non-article missing scope stays undecided; a new flat role uses whole Series', async () => {
  const existing = await readySeries({ series: 'writing', seriesRole: 'intro', seriesSeason: 1 });
  assert.equal(settingControl(existing, 'publishModal_seriesScope').value, '');
  input(settingControl(existing, 'publishModal_seriesRole'), 'epilogue');
  assert.equal(settingControl(existing, 'publishModal_seriesScope').value, '');
  existing.modal.close();
  const flat = await readySeries({ series: 'writing' }, bookSeries({ structure: 'flat', seasons: [] }));
  input(settingControl(flat, 'publishModal_seriesRole'), 'epilogue');
  const scope = settingControl(flat, 'publishModal_seriesScope');
  assert.equal(scope.value, 'series');
  assert.deepEqual(scope.children.map(option => option.attributes.value), ['series']);
  assert.equal(settingControl(flat, 'publishModal_seriesSeason'), undefined);
  assert.equal(settingControl(flat, 'publishModal_seriesGroup'), undefined);
  await flat.submit().fire();
  assert.equal(Object.hasOwn(flat.submitted[0], 'seriesGroup'), false);
  assert.equal(flat.submitted[0].seriesPlacement.placement.seriesScope, 'series');
  flat.modal.close();
});

test('returning a historical non-article with invalid group to article requires explicit correction', async () => {
  const f = await readySeries({ series: 'writing', seriesRole: 'intro', seriesScope: 'series', seriesGroup: null });
  input(settingControl(f, 'publishModal_seriesRole'), 'article');
  input(settingControl(f, 'publishModal_seriesSeason'), '1');
  await f.submit().fire();
  assert.equal(f.submitted.length, 0);
  input(settingControl(f, 'publishModal_seriesGroup'), '');
  await f.submit().fire();
  assert.equal(f.submitted[0].seriesGroup, '');
  f.modal.close();
});
