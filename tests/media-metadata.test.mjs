import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRestMediaMetadata,
  buildUploadedImageReference,
  buildWpComMediaMetadata,
  extractMediaMetadataBlocks,
  getMarkdownImages,
  imageCaptionsFromMetadata,
  mediaMetadataNeedsUpdate,
  mergeMediaMetadata,
  resolveImageCaptionMetadata,
  resolveMediaMetadata
} from '../src/media-metadata.ts';

test('extracts adjacent wp-media comments and removes them from publish content', () => {
  const source = [
    '![[images/cover.jpg]]',
    '',
    '%% wp-media',
    'title: Cover title',
    'alt: Cover alternative',
    'caption: Source: private archive',
    'description: Longer attachment context',
    '%%',
    '',
    'Body paragraph.'
  ].join('\n');

  const extracted = extractMediaMetadataBlocks(source);
  assert.deepEqual(extracted.metadataMap, {
    'images/cover.jpg': {
      title: 'Cover title',
      altText: 'Cover alternative',
      caption: 'Source: private archive',
      description: 'Longer attachment context'
    }
  });
  assert.doesNotMatch(extracted.content, /wp-media|Cover title/);
  assert.match(extracted.content, /!\[\[images\/cover\.jpg]]/);
  assert.match(extracted.content, /Body paragraph\./);
});

test('does not interpret wp-media examples inside fenced code', () => {
  const source = [
    '```markdown',
    '![[example.jpg]]',
    '%% wp-media',
    'title: Example only',
    '%%',
    '```'
  ].join('\n');

  assert.deepEqual(extractMediaMetadataBlocks(source), {
    content: source,
    metadataMap: {}
  });
});

test('accepts common alt text keys and full-width colons', () => {
  for (const key of [ 'altText:', 'alt:', 'Alt text:', 'alt_text:', 'alt-text:', 'altText：' ]) {
    const source = [
      '![[cover.jpg]]',
      '%% wp-media',
      key + ' Accessible cover',
      '%%'
    ].join('\n');
    assert.equal(
      extractMediaMetadataBlocks(source).metadataMap['cover.jpg']?.altText,
      'Accessible cover',
      key
    );
  }
});

test('resolves caption =alt from the final adjacent image alt text', () => {
  const inline = extractMediaMetadataBlocks([
    '![Inline alternative](inline.jpg)',
    '%% wp-media',
    'caption: =alt',
    '%%'
  ].join('\n'));
  assert.deepEqual(inline.metadataMap['inline.jpg'], {
    caption: 'Inline alternative'
  });

  const configured = extractMediaMetadataBlocks([
    '![Inline alternative](configured.jpg)',
    '%% wp-media',
    'altText: Configured alternative',
    'caption: =alt',
    '%%'
  ].join('\n'));
  assert.deepEqual(configured.metadataMap['configured.jpg'], {
    altText: 'Configured alternative',
    caption: 'Configured alternative'
  });

  const empty = extractMediaMetadataBlocks([
    '![](empty.jpg)',
    '%% wp-media',
    'caption: =alt',
    '%%'
  ].join('\n'));
  assert.deepEqual(empty.metadataMap, {});
  assert.doesNotMatch(empty.content, /wp-media/);

  const literal = extractMediaMetadataBlocks([
    '![Alternative](literal.jpg)',
    '%% wp-media',
    'caption: =altitude',
    '%%'
  ].join('\n'));
  assert.equal(literal.metadataMap['literal.jpg']?.caption, '=altitude');
});

test('builds title and caption data for publish rendering', () => {
  assert.deepEqual(imageCaptionsFromMetadata({
    'cover.jpg': { title: '  Cover title  ', caption: '  Visible caption  ' },
    'plain.jpg': { title: 'No caption' }
  }), {
    'cover.jpg': {
      title: 'Cover title',
      caption: 'Visible caption'
    }
  });
});

test('uses inline values and filename defaults while explicit metadata wins', () => {
  const metadataMap = {
    'assets/cover.jpg': {
      title: 'Configured title',
      altText: 'Configured alt',
      caption: 'Configured caption'
    }
  };
  const configured = resolveMediaMetadata({
    metadataMap,
    sourcePath: 'cover.jpg',
    vaultPath: 'assets/cover.jpg',
    fileName: 'cover.jpg',
    inlineAltText: 'Inline alt',
    inlineTitle: 'Inline title'
  });
  assert.deepEqual(configured, {
    title: 'Configured title',
    altText: 'Configured alt',
    caption: 'Configured caption'
  });
  assert.deepEqual(resolveImageCaptionMetadata({
    metadata: configured,
    metadataMap,
    sourcePath: 'cover.jpg',
    vaultPath: 'assets/cover.jpg',
    fileName: 'cover.jpg',
    inlineTitle: 'Inline title'
  }), {
    title: 'Configured title',
    caption: 'Configured caption'
  });

  const automaticTitleMap = {
    'photo.final.png': { caption: 'A photo' }
  };
  const automatic = resolveMediaMetadata({
    metadataMap: automaticTitleMap,
    sourcePath: 'photo.final.png',
    vaultPath: 'photo.final.png',
    fileName: 'photo.final.png',
    inlineAltText: 'A photo'
  });
  assert.deepEqual(automatic, {
    title: 'photo.final',
    altText: 'A photo',
    caption: 'A photo'
  });
  assert.deepEqual(resolveImageCaptionMetadata({
    metadata: automatic,
    metadataMap: automaticTitleMap,
    sourcePath: 'photo.final.png',
    vaultPath: 'photo.final.png',
    fileName: 'photo.final.png'
  }), {
    caption: 'A photo'
  });
});

test('parses Markdown titles, nested path parentheses, dimensions, and Obsidian embeds', () => {
  const images = getMarkdownImages([
    '![Diagram|640x360](<images/flow (final).png> "Editorial title")',
    '![[images/cover.jpg|320]]',
    '![250](https://example.com/remote.jpg)'
  ].join('\n'));
  assert.deepEqual(images.map(image => ({
    syntax: image.syntax,
    src: image.src,
    altText: image.altText,
    markdownTitle: image.markdownTitle,
    width: image.width,
    height: image.height,
    srcIsUrl: image.srcIsUrl
  })), [
    {
      syntax: 'markdown',
      src: 'images/flow (final).png',
      altText: 'Diagram',
      markdownTitle: 'Editorial title',
      width: '640',
      height: '360',
      srcIsUrl: false
    },
    {
      syntax: 'obsidian',
      src: 'images/cover.jpg',
      altText: undefined,
      markdownTitle: undefined,
      width: '320',
      height: undefined,
      srcIsUrl: false
    },
    {
      syntax: 'markdown',
      src: 'https://example.com/remote.jpg',
      altText: undefined,
      markdownTitle: undefined,
      width: '250',
      height: undefined,
      srcIsUrl: true
    }
  ]);
});

test('keeps alt text and dimensions in publish replacements without rewriting Obsidian syntax in notes', () => {
  const markdown = getMarkdownImages('![Old alt|640](local.jpg "Image title")')[0];
  assert.equal(
    buildUploadedImageReference(markdown, 'https://example.com/local.jpg', {
      altText: 'New alt'
    }),
    '![New alt|640](https://example.com/local.jpg "Image title")'
  );

  const obsidian = getMarkdownImages('![[local.jpg|320x200]]')[0];
  assert.equal(
    buildUploadedImageReference(obsidian, 'https://example.com/local.jpg', {
      altText: 'Accessible image'
    }),
    '![Accessible image|320x200](https://example.com/local.jpg)'
  );
  assert.equal(
    buildUploadedImageReference(obsidian, 'https://example.com/local.jpg', {
      altText: 'Accessible image'
    }, true),
    '![[https://example.com/local.jpg|320x200]]'
  );
});

test('builds transport-specific fields and updates only requested metadata', () => {
  const metadata = {
    title: 'Title',
    altText: 'Alternative',
    caption: 'Caption',
    description: 'Description'
  };
  assert.deepEqual(buildRestMediaMetadata(metadata), {
    title: 'Title',
    alt_text: 'Alternative',
    caption: 'Caption',
    description: 'Description'
  });
  assert.deepEqual(buildWpComMediaMetadata(metadata), {
    title: 'Title',
    alt: 'Alternative',
    caption: 'Caption',
    description: 'Description'
  });
  assert.equal(mediaMetadataNeedsUpdate({ title: 'Title' }, { title: 'Title' }), false);
  assert.equal(mediaMetadataNeedsUpdate({ title: 'Title' }, { altText: 'New alt' }), true);
  assert.deepEqual(
    mergeMediaMetadata({ title: 'Title' }, { altText: 'New alt' }),
    { title: 'Title', altText: 'New alt' }
  );
});
