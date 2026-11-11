import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { descendants } from './publish-modal-dom.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const adapter = fileURLToPath(new URL('./publish-modal-dom.mjs', import.meta.url));
const stubs = {
  obsidian: `
    import { Modal as BaseModal } from ${JSON.stringify(adapter)};
    export const instances = [];
    export class Modal extends BaseModal {
      constructor(app) { super(app); instances.push(this); }
    }
    export class TFile { path = 'test.md'; }
    export const Platform = { isMobile: false };
    export const getFrontMatterInfo = () => ({ exists: false });
    export const parseYaml = JSON.parse;
  `,
  './wp-clients': 'export function getWordPressClient() { throw new Error("Unexpected network access"); }',
  './wp-pull-preview-modal': 'export function openPullPreviewModal() {}',
  './wp-sync-conflict-modal': 'export function openSyncConflictModal() {}',
  './confirm-modal': 'export const ConfirmCode = {}; export function openConfirmModal() {}',
  './utils': 'export function openWithBrowser() {} export function showError() {}'
};
const bundle = await build({
  stdin: { contents: 'export { openWordPressSyncModal } from "./src/wp-sync-modal"; export { TFile, instances } from "obsidian";', resolveDir: root },
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
  plugins: [{ name: 'sync-lifecycle-host', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
      ? { path: args.path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], resolveDir: root }));
  }}]
});
const { openWordPressSyncModal, TFile, instances } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const read = Promise.withResolvers();
  let reads = 0;
  const plugin = {
    app: { workspace: { getActiveFile: () => new TFile() }, vault: { read: () => { reads++; return read.promise; } } },
    settings: { profiles: [], multiSiteTargets: {} }, i18n: { t: key => key }
  };
  return { plugin, read, reads: () => reads };
}

test('repeated sync commands open one dialog and a single close button dismisses it', async () => {
  const f = fixture();
  const before = instances.length;
  openWordPressSyncModal(f.plugin);
  openWordPressSyncModal(f.plugin);
  openWordPressSyncModal(f.plugin);
  assert.equal(instances.length, before + 1);
  assert.equal(f.reads(), 1);
  f.read.resolve('Body');
  await flush();
  const modal = instances.at(-1);
  // Exercise the same footer close handler used by the ready/synchronized view.
  modal.contentEl.empty();
  modal.syncResult = { state: 'in-sync' };
  modal.renderActions();
  await descendants(modal.contentEl).find(el => el.tag === 'button' && el.text === 'pullModal_close').fire();
  assert.equal(modal.modalEl.root, false);
  assert.deepEqual(modal.contentEl.children, []);
  openWordPressSyncModal(f.plugin);
  assert.equal(instances.length, before + 2);
  instances.at(-1).close();
  await flush();
});

test('native close while loading releases the guard and late failures cannot redraw the closed dialog', async () => {
  const old = fixture();
  openWordPressSyncModal(old.plugin);
  const closed = instances.at(-1);
  closed.close();
  openWordPressSyncModal(old.plugin);
  const reopened = instances.at(-1);
  assert.notEqual(reopened, closed);
  old.read.reject(new Error('Delayed read failure'));
  await flush();
  assert.deepEqual(closed.contentEl.children, []);
  assert.equal(reopened.phase, 'error');
  openWordPressSyncModal(old.plugin);
  assert.equal(instances.at(-1), reopened);
  reopened.close();
});

test('sync dialogs in different plugin instances do not block each other', async () => {
  const a = fixture();
  const b = fixture();
  const before = instances.length;
  openWordPressSyncModal(a.plugin);
  openWordPressSyncModal(b.plugin);
  assert.equal(instances.length, before + 2);
  for (const modal of instances.slice(before)) modal.close();
  a.read.resolve('A');
  b.read.resolve('B');
  await flush();
  for (const modal of instances.slice(before)) assert.deepEqual(modal.contentEl.children, []);
});
