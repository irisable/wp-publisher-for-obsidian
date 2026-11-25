import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { extractMediaMetadataBlocks, buildRestMediaMetadata } from '../src/media-metadata.ts';

const resolveDir = fileURLToPath(new URL('..', import.meta.url));
const stubs = {
  obsidian: 'export class Notice {} export class TFile {} export const stringifyYaml = JSON.stringify; export const parseYaml = JSON.parse; export const getFrontMatterInfo = value => ({ contentStart: value.startsWith("---\\n") ? value.indexOf("\\n---\\n", 4) + 5 : 0 });',
  './wp-publish-modal': 'export class WpPublishModal {}',
  './utils': 'export function isPromiseFulfilledResult(v) { return v.status === "fulfilled"; } export function openWithBrowser() {} export function processFile() {} export function showError() {}',
  './app-state': `
    import MarkdownIt from 'markdown-it';
    import { MarkdownItImagePluginInstance } from './src/markdown-it-image-plugin';
    import { MarkdownItCommentPluginInstance } from './src/markdown-it-comment-plugin';
    export const AppState = { markdownParser: new MarkdownIt()
      .use(MarkdownItImagePluginInstance.plugin)
      .use(MarkdownItCommentPluginInstance.plugin) };
  `,
  './confirm-modal': 'export const ConfirmCode = {}; export function openConfirmModal() {}',
  './post-published-modal': 'export function openPostPublishedModal() {}',
  './wp-login-modal': 'export function openLoginModal() {}'
};
const bundle = await build({
  stdin: {
    contents: 'export { AbstractWordPressClient } from "./src/abstract-wp-client"; export { TFile } from "obsidian";',
    resolveDir
  },
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false,
  plugins: [{ name: 'audio-host-adapter', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
      ? { path: args.path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], resolveDir }));
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
    settings: { contentFormat: 'block-editor' },
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
      postParams: params, auth: {}, sourceFile: { path: 'note.md' }
    });
    assert.match(params.content, /https:\/\/example.com\/voice-1.mp3/);
    assert.equal(options.mediaAttachmentIds['https://example.com/voice-1.mp3'], 41);
    assert.equal(uploads, 1);
  }
  bytes = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 1]).buffer;
  await makeClient().updatePostImages({
    postParams: { content: '![](audio/voice.mp3)' }, auth: {}, sourceFile: { path: 'note.md' }
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
    settings: { contentFormat: 'block-editor' },
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
      postParams: params, auth: {}, sourceFile: { path: 'note.md' }
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
  fixture.client.updateMediaMetadata = async () => { throw new Error('Denied'); };
  const result = await fixture.run('![](https://example.com/voice.mp3)\n%% wp-media\ncaption: Listen\n%%');
  assert.equal(fixture.profile.mediaCache.hash.metadata, undefined);
  assert.equal(result.options.imageCaptions['https://example.com/voice.mp3'].caption, 'Listen');
  assert.ok(fixture.client.publishWarnings.has('warning_mediaMetadataUpdateFailed'));
});

function publishFixture(format = 'block-editor') {
  const uploads = [];
  const posts = [];
  const frontMatter = '---\nexample: "![](cover image.png)"\n---\n';
  let note = '';
  const file = Object.assign(new TFile(), { path: 'note.md', name: 'note.md', basename: 'note' });
  const files = new Map(['cover image.png', 'voice.mp3'].map(name => [name,
    Object.assign(new TFile(), { path: name, name })]));
  const profile = { id: 'test', name: 'Test site', endpoint: 'https://example.com' };
  const plugin = {
    settings: { contentFormat: format, publishHistory: [], multiSiteTargets: {} },
    app: {
      metadataCache: { getFirstLinkpathDest: path => files.get(path) },
      vault: { readBinary: async file => new TextEncoder().encode(file.name).buffer },
      workspace: {
        getActiveFile: () => file,
        activeEditor: { editor: { getValue: () => note, setValue: value => { note = value; } } }
      }
    },
    saveSettings: async () => {},
    i18n: { t: (key, vars = {}) => `${key} ${Object.values(vars).join(' ')}`.trim() }
  };
  const client = new AbstractWordPressClient(plugin, profile);
  client.getAuth = async () => ({});
  client.getCategories = async () => [];
  client.mediaExists = async () => true;
  client.rememberPublishedSyncBaseline = async () => true;
  client.uploadMedia = async ({ fileName }) => {
    uploads.push(fileName);
    return { code: 0, data: {
      id: uploads.length,
      url: `https://example.com/${encodeURIComponent(fileName)}`,
      metadataApplied: true
    } };
  };
  client.publish = async (_title, content) => {
    posts.push(content);
    return { code: 0, data: { postId: '42', categories: [] } };
  };
  return {
    uploads, posts, profile, client, frontMatter,
    get note() { return note; },
    async publish(content) {
      note = frontMatter + content;
      return client.publishPost({
        updateStrategy: 'content-only', postType: 'post', categories: [], tags: []
      }, {
        sourceFile: file, sourceSnapshot: { title: 'note', content, matter: {} },
        target: { mode: 'update', postId: '42', postType: 'post' },
        showNotices: false, writeBackToNote: false, replaceMediaLinks: true
      });
    }
  };
}

test('an upload HTTP 403 stops an update and caches successful uploads for retry', async () => {
  const fixture = publishFixture();
  const upload = fixture.client.uploadMedia;
  fixture.client.uploadMedia = async media => media.fileName === 'voice.mp3'
    ? { code: 1, error: { code: 2, message: 'HTTP 403' } }
    : upload(media);
  const body = '![](cover image.png)\n\n![[voice.mp3]]';

  const failed = await fixture.publish(body);
  assert.equal(failed.code, 1);
  assert.match(failed.error.message, /voice\.mp3.*HTTP 403/);
  assert.deepEqual(fixture.posts, []);
  assert.equal(fixture.note, fixture.frontMatter + body);
  assert.deepEqual(fixture.uploads, ['cover image.png']);

  fixture.client.uploadMedia = upload;
  const retried = await fixture.publish(body);
  assert.equal(retried.code, 0);
  assert.deepEqual(fixture.uploads, ['cover image.png', 'voice.mp3']);
  assert.match(fixture.posts[0], /<!-- wp:image -->/);
  assert.match(fixture.posts[0], /<!-- wp:audio /);
});

test('a missing local media embed blocks Gutenberg and Classic HTML post requests', async () => {
  for (const format of ['block-editor', 'classic-html']) {
    const fixture = publishFixture(format);
    const result = await fixture.publish('![](missing.png)');
    assert.equal(result.code, 1);
    assert.match(result.error.message, /error_bodyMediaNotFound missing\.png/);
    assert.deepEqual(fixture.posts, []);
    assert.deepEqual(fixture.uploads, []);
  }
});

test('an upload response without a usable URL blocks the post and is not cached', async () => {
  const fixture = publishFixture();
  fixture.client.uploadMedia = async () => ({ code: 0, data: { id: 42, url: 'voice.mp3' } });
  const result = await fixture.publish('![[voice.mp3]]');
  assert.equal(result.code, 1);
  assert.match(result.error.message, /error_mediaUploadMissingUrl/);
  assert.equal(fixture.profile.mediaCache, undefined);
  assert.deepEqual(fixture.posts, []);
});

test('a locally sourced reference-style image cannot bypass the publish guard', async () => {
  const fixture = publishFixture();
  const result = await fixture.publish('![Cover][cover]\n\n[cover]: cover.png');
  assert.equal(result.code, 1);
  assert.match(result.error.message, /error_bodyMediaUnresolved cover\.png/);
  assert.deepEqual(fixture.posts, []);
});

test('literal embeds and front matter are preserved even when the same file is embedded', async () => {
  const fixture = publishFixture();
  const literal = 'Use `![](cover image.png)` or this example:\n\n```markdown\n![](cover image.png)\n![](missing.png)\n```';
  const body = literal + '\n\n![](cover image.png)';
  const result = await fixture.publish(body);
  assert.equal(result.code, 0);
  assert.deepEqual(fixture.uploads, ['cover image.png']);
  assert.match(fixture.posts[0], /<code>!\[\]\(cover image\.png\)<\/code>/);
  assert.match(fixture.posts[0], /!\[\]\(missing\.png\)/);
  assert.match(fixture.posts[0], /<img src="https:\/\/example\.com\/cover%20image\.png"/);
  assert.equal(fixture.note, fixture.frontMatter + literal + '\n\n![](https://example.com/cover%20image.png)');
});

test('an attachment metadata error keeps a valid audio post publishable with a warning', async () => {
  const fixture = publishFixture();
  fixture.client.uploadMedia = async () => ({
    code: 0, data: { id: 42, url: 'https://example.com/voice.mp3' }
  });
  fixture.client.updateMediaMetadata = async () => { throw new Error('Metadata denied'); };
  const result = await fixture.publish('![[voice.mp3]]\n%% wp-media\ncaption: Listen\n%%');
  assert.equal(result.code, 0);
  assert.equal(result.data.partialFailure, true);
  assert.match(result.data.warnings[0], /Metadata denied/);
  assert.match(fixture.posts[0], /<figcaption class="wp-element-caption">Listen<\/figcaption>/);
});
