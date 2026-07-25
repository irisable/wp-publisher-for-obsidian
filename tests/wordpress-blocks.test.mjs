import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { MarkdownItImagePluginInstance } from '../src/markdown-it-image-plugin.ts';
import { markdownItWordPressListPlugin } from '../src/markdown-it-wordpress-list-plugin.ts';
import { importTypescriptModule } from './import-typescript-module.mjs';
import {
  buildRestMediaMetadata,
  buildUploadedImageReference,
  extractMediaMetadataBlocks,
  getMarkdownImages,
  resolveImageCaptionMetadata,
  resolveMediaMetadata
} from '../src/media-metadata.ts';
const {
  renderMarkdownToWordPressBlocks,
  renderWordPressPostContent,
  WordPressContentFormat
} = await importTypescriptModule(
  new URL('../src/wordpress-blocks.ts', import.meta.url)
);

function createParser(options = {}) {
  return new MarkdownIt(options).use(markdownItWordPressListPlugin);
}

test('renders headings and rich paragraphs as independently editable blocks', () => {
  const output = renderMarkdownToWordPressBlocks(
    '## Heading\n\nText with **bold**, *emphasis*, and [a link](https://example.com).',
    createParser()
  );

  assert.match(output, /<!-- wp:heading {"level":2} -->/);
  assert.match(output, /<h2 class="wp-block-heading">Heading<\/h2>/);
  assert.match(output, /<!-- wp:paragraph -->/);
  assert.ok(output.includes('<p>Text with <strong>bold</strong>, <em>emphasis</em>, and <a href="https://example.com">a link</a>.</p>'));
  assert.doesNotMatch(output, /<!-- wp:html -->/);
});

test('renders standalone image alt text without an implicit figcaption', () => {
  const parser = createParser();
  const image = renderMarkdownToWordPressBlocks(
    '![Cover](https://example.com/cover.jpg)',
    parser
  );
  assert.match(image, /<!-- wp:image -->/);
  assert.ok(image.includes(
    '<figure class="wp-block-image"><img src="https://example.com/cover.jpg" alt="Cover"></figure>'
  ));
  assert.doesNotMatch(image, /<figcaption/);

  const emptyAlt = renderMarkdownToWordPressBlocks(
    '![](https://example.com/decorative.jpg)',
    parser
  );
  assert.doesNotMatch(emptyAlt, /<figcaption/);

  const mixed = renderMarkdownToWordPressBlocks(
    'Before ![Cover](https://example.com/cover.jpg) after.',
    parser
  );
  assert.match(mixed, /<!-- wp:html -->/);
  assert.doesNotMatch(mixed, /<!-- wp:image -->/);
});


test('keeps a descriptive local-image alt out of the visible caption', () => {
  const output = renderMarkdownToWordPressBlocks(
    '![村小学改成的投票处里，黑板上只有老村长一个候选人姓名，二狗站在封好的木票箱旁，大明拿着单一候选人的选票，老村长坐在长桌后，黄褐色公鸡在桌下觅食](village-dialectics-election-must-be-unanimous-cover.png)',
    createParser()
  );

  assert.match(output, /alt="村小学改成的投票处里，黑板上只有老村长一个候选人姓名/);
  assert.doesNotMatch(output, /<figcaption/);
});

test('renders media titles and captions as editable image figcaptions', () => {
  const image = renderMarkdownToWordPressBlocks(
    '![Cover](https://example.com/cover.jpg)',
    createParser(),
    {
      imageCaptions: {
        'https://example.com/cover.jpg': {
          title: 'Cover <title>',
          caption: 'Caption & context'
        }
      }
    }
  );
  assert.match(image, /<!-- wp:image -->/);
  assert.ok(image.includes(
    '<figcaption class="wp-element-caption"><strong>Cover &lt;title&gt;</strong><br>Caption &amp; context</figcaption>'
  ));
  assert.doesNotMatch(image, /<figcaption[^>]*>Cover<\/figcaption>/);
  assert.doesNotMatch(image, /<!-- wp:html -->/);
});

test('prefers adjacent altText without turning it into a figcaption', () => {
  const extracted = extractMediaMetadataBlocks([
    '![Inline alternative](image.png)',
    '%% wp-media',
    'altText: Configured alternative',
    '%%'
  ].join('\n'));
  const sourceImage = getMarkdownImages(extracted.content)[0];
  const metadata = resolveMediaMetadata({
    metadataMap: extracted.metadataMap,
    sourcePath: sourceImage.src,
    vaultPath: sourceImage.src,
    fileName: 'image.png',
    inlineAltText: sourceImage.altText
  });
  const uploadedImage = buildUploadedImageReference(
    sourceImage,
    'https://example.com/image.png',
    metadata
  );
  const output = renderMarkdownToWordPressBlocks(uploadedImage, createParser());

  assert.equal(buildRestMediaMetadata(metadata).alt_text, 'Configured alternative');
  assert.match(output, /alt="Configured alternative"/);
  assert.doesNotMatch(output, /<figcaption/);
  assert.doesNotMatch(output, /Inline alternative/);
});

test('reuses alt text as the attachment caption and figcaption only when requested', () => {
  const extracted = extractMediaMetadataBlocks([
    '![我很喜乐](surrender.png)',
    '%% wp-media',
    'caption: =alt',
    '%%'
  ].join('\n'));
  const sourceImage = getMarkdownImages(extracted.content)[0];
  const metadata = resolveMediaMetadata({
    metadataMap: extracted.metadataMap,
    sourcePath: sourceImage.src,
    vaultPath: sourceImage.src,
    fileName: 'surrender.png',
    inlineAltText: sourceImage.altText
  });
  const imageCaption = resolveImageCaptionMetadata({
    metadata,
    metadataMap: extracted.metadataMap,
    sourcePath: sourceImage.src,
    vaultPath: sourceImage.src,
    fileName: 'surrender.png'
  });
  assert.ok(imageCaption);
  const url = 'https://example.com/surrender.png';
  const uploadedImage = buildUploadedImageReference(sourceImage, url, metadata);
  const output = renderMarkdownToWordPressBlocks(uploadedImage, createParser(), {
    imageCaptions: {
      [url]: imageCaption
    }
  });

  assert.equal(metadata.title, 'surrender');
  assert.equal(buildRestMediaMetadata(metadata).caption, '我很喜乐');
  assert.match(output, /alt="我很喜乐"/);
  assert.match(output, /<figcaption class="wp-element-caption">我很喜乐<\/figcaption>/);
  assert.doesNotMatch(output, /<strong>surrender<\/strong>/);
});

test('uses a safe fallback for Obsidian images with explicit dimensions', () => {
  const parser = createParser().use(MarkdownItImagePluginInstance.plugin);
  const image = renderMarkdownToWordPressBlocks('![[cover.jpg]]', parser);
  assert.match(image, /<!-- wp:image -->/);

  const sizedImage = renderMarkdownToWordPressBlocks('![[cover.jpg|640x360]]', parser);
  assert.match(sizedImage, /<!-- wp:html -->/);
  assert.ok(sizedImage.includes('<img src="cover.jpg" width="640" height="360" alt="">'));
  assert.doesNotMatch(sizedImage, /<!-- wp:image -->/);
});

test('renders nested and ordered lists with native list-item blocks', () => {
  const parser = createParser();
  const nested = renderMarkdownToWordPressBlocks(
    '- Parent\n  - Child\n- Second',
    parser
  );
  assert.equal((nested.match(/<!-- wp:list(?: |-->)/g) ?? []).length, 2);
  assert.equal((nested.match(/<!-- wp:list-item -->/g) ?? []).length, 3);
  assert.match(nested, /<ul class="wp-block-list">/);
  assert.match(nested, /<li>Parent[\s\S]*<li>Child<\/li>/);

  const ordered = renderMarkdownToWordPressBlocks(
    '3. Third\n4. Fourth',
    parser
  );
  assert.match(ordered, /<!-- wp:list {"ordered":true,"start":3} -->/);
  assert.match(ordered, /<ol class="wp-block-list" start="3">/);
});

test('renders lists inside quotes as native inner blocks', () => {
  const output = renderMarkdownToWordPressBlocks(
    '> Intro\n>\n> - First\n> - Second',
    createParser()
  );
  assert.match(output, /^<!-- wp:quote -->/);
  assert.match(output, /<blockquote class="wp-block-quote">[\s\S]*<!-- wp:paragraph -->/);
  assert.match(output, /<!-- wp:list -->[\s\S]*<!-- wp:list-item -->/);
  assert.doesNotMatch(output, /<!-- wp:html -->/);
});

test('keeps Mermaid fences as inert editable code blocks', () => {
  const output = renderMarkdownToWordPressBlocks(
    '~~~mermaid\ngraph TD\n    A[Start] --> B[End]\n~~~',
    createParser()
  );
  assert.match(output, /^<!-- wp:code -->/);
  assert.ok(output.includes('graph TD\n    A[Start] --&gt; B[End]'));
  assert.doesNotMatch(output, /<!-- wp:html -->/);
});

test('keeps intentional multi-paragraph list items in a custom HTML fallback', () => {
  const output = renderMarkdownToWordPressBlocks(
    '- First paragraph\n\n  Second paragraph',
    createParser()
  );
  assert.match(output, /^<!-- wp:html -->/);
  assert.match(output, /<li>\n<p>First paragraph<\/p>\n<p>Second paragraph<\/p>/);
  assert.doesNotMatch(output, /<!-- wp:list -->/);
});

test('renders quotes, code, tables, and separators as core blocks', () => {
  const output = renderMarkdownToWordPressBlocks(
    '> A quote.\n\n~~~js\nconst value = 1;\n~~~\n\n---\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    createParser()
  );
  assert.match(output, /<!-- wp:quote -->[\s\S]*<blockquote class="wp-block-quote">/);
  assert.match(output, /<!-- wp:code -->[\s\S]*<pre class="wp-block-code"><code>const value = 1;/);
  assert.ok(output.includes('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>'));
  assert.match(output, /<!-- wp:table {"hasFixedLayout":false} -->/);
  assert.match(output, /<figure class="wp-block-table"><table>/);
});

test('falls back to custom HTML for raw HTML and preserves existing block markup', () => {
  const parser = createParser({ html: true });
  const customHtml = renderMarkdownToWordPressBlocks(
    '<aside data-note="true">Custom</aside>',
    parser
  );
  assert.equal(customHtml, [
    '<!-- wp:html -->',
    '<aside data-note="true">Custom</aside>',
    '<!-- /wp:html -->'
  ].join('\n'));

  const existing = '<!-- wp:paragraph -->\n<p>Already a block.</p>\n<!-- /wp:paragraph -->';
  assert.equal(renderMarkdownToWordPressBlocks(existing, parser), existing);
});

test('keeps classic HTML mode available for compatibility', () => {
  const parser = createParser();
  const markdown = '## Heading\n\nParagraph.';
  assert.equal(
    renderWordPressPostContent(
      markdown,
      parser,
      WordPressContentFormat.ClassicHtml
    ),
    parser.render(markdown)
  );
  assert.match(
    renderWordPressPostContent(
      markdown,
      parser,
      WordPressContentFormat.BlockEditor
    ),
    /<!-- wp:heading/
  );
});

test('preserves standard Markdown alt text and explicit image dimensions', () => {
  const parser = createParser().use(MarkdownItImagePluginInstance.plugin);
  const image = renderMarkdownToWordPressBlocks(
    '![Accessible diagram|640x360](https://example.com/diagram.jpg)',
    parser
  );
  assert.match(image, /<!-- wp:html -->/);
  assert.ok(image.includes('<img src="https://example.com/diagram.jpg" alt="Accessible diagram" width="640" height="360">'));
});
