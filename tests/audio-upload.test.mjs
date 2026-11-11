import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { extractMediaMetadataBlocks, buildRestMediaMetadata } from '../src/media-metadata.ts';

const stubs = {
  obsidian: 'export class Notice {} export class TFile {} export const stringifyYaml = JSON.stringify; export const parseYaml = JSON.parse; export const getFrontMatterInfo = () => ({});',
  './wp-publish-modal': 'export class WpPublishModal {}',
  './utils': 'export function isPromiseFulfilledResult(v) { return v.status === "fulfilled"; } export function openWithBrowser() {} export function processFile() {} export function showError() {}',
  './app-state': 'export const AppState = {};',
  './confirm-modal': 'export const ConfirmCode = {}; export function openConfirmModal() {}',
  './post-published-modal': 'export function openPostPublishedModal() {}',
  './wp-login-modal': 'export function openLoginModal() {}'
};
const bundle = await build({
  stdin: {
    contents: 'export { AbstractWordPressClient } from "./src/abstract-wp-client"; export { TFile } from "obsidian";',
    resolveDir: fileURLToPath(new URL('..', import.meta.url))
  },
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
  plugins: [{ name: 'audio-host-adapter', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
      ? { path: args.path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path] }));
  }}]
});
const { AbstractWordPressClient, TFile } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('MP3 upload and repeat publication reuse the same attachment for both embed syntaxes', async () => {
  const file = Object.assign(new TFile(), { path: 'audio/voice.mp3', name: 'voice.mp3' });
  let bytes = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]).buffer;
  let uploads = 0;
  const profile = {};
  const plugin = {
    app: {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { readBinary: async () => bytes },
      workspace: { getActiveFile: () => null }
    },
    saveSettings: async () => {},
    i18n: { t: key => key }
  };
  const makeClient = () => {
    const client = new AbstractWordPressClient(plugin, profile);
    client.mediaExists = async () => true;
    client.uploadMedia = async () => {
      uploads++;
      return { code: 0, data: { url: `https://example.com/voice-${uploads}.mp3`, id: 40 + uploads, metadataApplied: true } };
    };
    return client;
  };
  for (const content of ['![[audio/voice.mp3]]', '![](audio/voice.mp3)']) {
    const params = { content };
    const options = await makeClient().updatePostImages({
      postParams: params, auth: {}, sourceFile: { path: 'note.md' }, replaceMediaLinks: false, syncContext: {}
    });
    assert.match(params.content, /https:\/\/example.com\/voice-1.mp3/);
    assert.equal(options.mediaAttachmentIds['https://example.com/voice-1.mp3'], 41);
    assert.equal(uploads, 1);
  }
  bytes = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 1]).buffer;
  await makeClient().updatePostImages({
    postParams: { content: '![](audio/voice.mp3)' }, auth: {}, sourceFile: { path: 'note.md' }, replaceMediaLinks: false, syncContext: {}
  });
  assert.equal(uploads, 2, 'same filename with different content must not reuse the attachment');
});

function metadataFixture(profile = {}) {
  const file = Object.assign(new TFile(), { path: 'audio/voice.mp3', name: 'voice.mp3' });
  const uploads = [];
  const updates = [];
  const plugin = {
    app: {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { readBinary: async () => new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]).buffer },
      workspace: { getActiveFile: () => null }
    },
    saveSettings: async () => {},
    i18n: { t: key => key }
  };
  const client = new AbstractWordPressClient(plugin, profile);
  client.mediaExists = async () => true;
  client.uploadMedia = async media => {
    uploads.push(media);
    return { code: 0, data: { url: 'https://example.com/voice.mp3', id: 42 } };
  };
  client.updateMediaMetadata = async (id, metadata) => {
    updates.push({ id, metadata });
    return { code: 0, data: true };
  };
  const run = async source => {
    const extracted = extractMediaMetadataBlocks(source);
    const params = { content: extracted.content, mediaMetadata: extracted.metadataMap };
    const options = await client.updatePostImages({
      postParams: params, auth: {}, sourceFile: { path: 'note.md' }, replaceMediaLinks: false, syncContext: {}
    });
    return { params, options };
  };
  return { run, client, uploads, updates, profile };
}

test('MP3 wp-media parses shared fields, updates upload and reuse, and excludes alt_text', async () => {
  const fixture = metadataFixture();
  for (const [index, embed] of ['![not audio alt](audio/voice.mp3)', '![[audio/voice.mp3]]'].entries()) {
    const caption = index ? 'Song version' : 'Listen to this article';
    const result = await fixture.run(`${embed}\n%% wp-media\ntitle: Audio title\ncaption: ${caption}\ndescription: Audio description\naltText: Image only\n%%`);
    assert.equal(fixture.uploads.length, 1);
    assert.deepEqual(fixture.updates[index], { id: 42, metadata: {
      title: 'Audio title', caption, description: 'Audio description'
    } });
    assert.deepEqual(buildRestMediaMetadata(fixture.updates[index].metadata), {
      title: 'Audio title', caption, description: 'Audio description'
    });
    assert.equal(result.options.imageCaptions['https://example.com/voice.mp3'].caption, caption);
    assert.doesNotMatch(result.params.content, /wp-media/);
  }
  assert.equal(fixture.uploads[0].metadata.altText, undefined);
});

test('mapped remote MP3 updates only explicit metadata without uploading or repeated updates', async () => {
  const fixture = metadataFixture({ mediaCache: { hash: {
    contentHash: 'hash', id: 42, url: 'https://example.com/voice.mp3',
    sourceUrls: ['https://cdn.example.com/voice.mp3'], fileName: 'voice.mp3'
  } } });
  const source = '![](https://cdn.example.com/voice.mp3)\n%% wp-media\ncaption: Listen\ndescription: Description\naltText: Ignore\n%%';
  const result = await fixture.run(source);
  await fixture.run(source);
  assert.equal(fixture.uploads.length, 0);
  assert.deepEqual(fixture.updates, [{ id: 42, metadata: { caption: 'Listen', description: 'Description' } }]);
  assert.equal(result.options.mediaAttachmentIds['https://cdn.example.com/voice.mp3'], 42);
  assert.equal(result.options.imageCaptions['https://cdn.example.com/voice.mp3'].caption, 'Listen');
});

test('unmapped remote MP3 retains caption and warns rather than guessing an attachment', async () => {
  const fixture = metadataFixture();
  const result = await fixture.run('![](https://example.com/voice.mp3)\n%% wp-media\ntitle: Title\ncaption: Listen\ndescription: Description\n%%');
  assert.equal(fixture.uploads.length, 0);
  assert.equal(fixture.updates.length, 0);
  assert.equal(result.options.imageCaptions['https://example.com/voice.mp3'].caption, 'Listen');
  assert.ok(fixture.client.publishWarnings.has('warning_mediaMetadataUpdateFailed'));
});

test('failed remote attachment metadata update is not cached as applied', async () => {
  const fixture = metadataFixture({ mediaCache: { hash: {
    contentHash: 'hash', id: 42, url: 'https://example.com/voice.mp3', fileName: 'voice.mp3'
  } } });
  fixture.client.updateMediaMetadata = async () => ({ code: 1, error: { message: 'Denied' } });
  const result = await fixture.run('![](https://example.com/voice.mp3)\n%% wp-media\ncaption: Listen\n%%');
  assert.equal(fixture.profile.mediaCache.hash.metadata, undefined);
  assert.equal(result.options.imageCaptions['https://example.com/voice.mp3'].caption, 'Listen');
  assert.ok(fixture.client.publishWarnings.has('warning_mediaMetadataUpdateFailed'));
});
