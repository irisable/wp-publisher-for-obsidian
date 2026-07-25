import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  convertWordPressToMarkdown,
  WORDPRESS_TO_MARKDOWN_VERSION,
  WordPressConversionKind
} = await importTypescriptModule(
  new URL('../src/wordpress-to-markdown.ts', import.meta.url)
);
const { parseWordPressBlocks, splitProtectedWordPressSources } = await importTypescriptModule(
  new URL('../src/wordpress-block-parser.ts', import.meta.url)
);
const { renderMarkdownToWordPressBlocks } = await importTypescriptModule(
  new URL('../src/wordpress-blocks.ts', import.meta.url)
);

test('converts headings and mixed inline formatting from native blocks', () => {
  const source = [
    '<!-- wp:heading {"level":2} -->',
    '<h2>标题与 <em>强调</em></h2>',
    '<!-- /wp:heading -->',
    '',
    '<!-- wp:paragraph -->',
    '<p>Text with <strong>bold</strong>, <em>emphasis</em>, <code>x_y</code>, a<br>break, and <a href="https://example.com" title="Example">link</a>.</p>',
    '<!-- /wp:paragraph -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');

  assert.equal(result.markdown, [
    '## 标题与 *强调*',
    '',
    'Text with **bold**, *emphasis*, `x_y`, a\\',
    'break, and [link](https://example.com "Example").'
  ].join('\n'));
  assert.equal(result.fidelity, WordPressConversionKind.Exact);
  assert.equal(result.converterVersion, WORDPRESS_TO_MARKDOWN_VERSION);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.every(item => item.kind === 'exact'));
  assert.deepEqual(result.diagnostics.map(item => item.range.start.line), [ 1, 5 ]);
});

test('converts official WordPress heading boilerplate without raw preservation', () => {
  const source = [
    '<!-- wp:heading {"level":2,"levelOptions":[2,3,4],"className":"wp-block-heading"} -->',
    '<h2 class="wp-block-heading">Official heading</h2>',
    '<!-- /wp:heading -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');
  const restored = renderMarkdownToWordPressBlocks(result.markdown, new MarkdownIt());

  assert.equal(result.markdown, '## Official heading');
  assert.equal(result.fidelity, 'normalized');
  assert.match(restored, /<h2 class="wp-block-heading">Official heading<\/h2>/);
  assert.doesNotMatch(result.markdown, /wp-source/);
});

test('normalizes the empty values attribute used by official WordPress lists', () => {
  const source = [
    '<!-- wp:list {"ordered":false,"values":""} -->',
    '<ul class="wp-block-list">',
    '<!-- wp:list-item -->',
    '<li>Official list item</li>',
    '<!-- /wp:list-item -->',
    '</ul>',
    '<!-- /wp:list -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');

  assert.equal(result.markdown, '- Official list item');
  assert.equal(result.fidelity, 'normalized');
  assert.doesNotMatch(result.markdown, /wp-source/);
});

test('still preserves heading attributes or structures that Markdown would lose', () => {
  const fixtures = [
    [
      '<!-- wp:heading {"level":2,"anchor":"remote-anchor"} -->',
      '<h2 id="remote-anchor">Anchored</h2>',
      '<!-- /wp:heading -->'
    ].join('\n'),
    [
      '<!-- wp:heading {"level":3} -->',
      '<h2 class="wp-block-heading">Mismatched</h2>',
      '<!-- /wp:heading -->'
    ].join('\n'),
    [
      '<!-- wp:heading {"level":2,"className":"custom-title"} -->',
      '<h2 class="wp-block-heading custom-title">Custom</h2>',
      '<!-- /wp:heading -->'
    ].join('\n')
  ];

  fixtures.forEach(fixture => {
    const result = convertWordPressToMarkdown(fixture, 'block-editor');
    assert.equal(result.fidelity, 'preserved-raw');
    assert.equal(splitProtectedWordPressSources(result.markdown).segments[0].content, fixture);
  });
});

test('converts ordered nested lists and quotes without flattening hierarchy', () => {
  const source = [
    '<!-- wp:quote -->',
    '<blockquote class="wp-block-quote">',
    '<!-- wp:paragraph -->',
    '<p>Intro</p>',
    '<!-- /wp:paragraph -->',
    '<!-- wp:list {"ordered":true,"start":3} -->',
    '<ol class="wp-block-list" start="3">',
    '<!-- wp:list-item -->',
    '<li>Third',
    '<!-- wp:list -->',
    '<ul class="wp-block-list">',
    '<!-- wp:list-item -->',
    '<li>Child</li>',
    '<!-- /wp:list-item -->',
    '</ul>',
    '<!-- /wp:list -->',
    '</li>',
    '<!-- /wp:list-item -->',
    '<!-- wp:list-item -->',
    '<li>Fourth</li>',
    '<!-- /wp:list-item -->',
    '</ol>',
    '<!-- /wp:list -->',
    '</blockquote>',
    '<!-- /wp:quote -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');

  assert.equal(result.markdown, [
    '> Intro',
    '>',
    '> 3. Third',
    '>    - Child',
    '> 4. Fourth'
  ].join('\n'));
  assert.equal(result.fidelity, 'exact');
  assert.deepEqual(
    result.diagnostics.map(item => item.blockName),
    [
      'core/quote',
      'core/paragraph',
      'core/list',
      'core/list-item',
      'core/list',
      'core/list-item',
      'core/list-item'
    ]
  );
});

test('converts code, separators, Unicode, and GFM tables', () => {
  const source = [
    '<!-- wp:code -->',
    '<pre class="wp-block-code"><code>const fence = ```;\n村口\n</code></pre>',
    '<!-- /wp:code -->',
    '',
    '<!-- wp:separator -->',
    '<hr class="wp-block-separator has-alpha-channel-opacity"/>',
    '<!-- /wp:separator -->',
    '',
    '<!-- wp:table {"hasFixedLayout":false} -->',
    '<figure class="wp-block-table"><table><thead><tr><th style="text-align:left">A</th><th style="text-align:center">B</th></tr></thead><tbody><tr><td>1</td><td>x | y</td></tr></tbody></table></figure>',
    '<!-- /wp:table -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');

  assert.match(result.markdown, /^````\nconst fence = ```;\n村口\n````/);
  assert.match(result.markdown, /\n\n---\n\n/);
  assert.match(result.markdown, /\| A \| B \|\n\| :--- \| :---: \|\n\| 1 \| x \\\| y \|$/);
  assert.equal(result.fidelity, 'exact');
});

test('preserves image alt text, dimensions, title, and caption metadata', () => {
  const source = [
    '<!-- wp:image -->',
    '<figure class="wp-block-image"><img src="https://example.com/cover.jpg" width="640" height="360" alt="*封面* [图]"><figcaption class="wp-element-caption"><strong>封面 *标题*</strong><br>说明 *原样* #1</figcaption></figure>',
    '<!-- /wp:image -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');

  assert.equal(result.markdown, [
    '![\\*封面\\* \\[图\\]|640x360](https://example.com/cover.jpg)',
    '%% wp-media',
    'title: 封面 *标题*',
    'caption: 说明 *原样* #1',
    '%%'
  ].join('\n'));
  assert.equal(result.fidelity, 'exact');
});

test('normalizes allowlisted custom and classic HTML deterministically', () => {
  const custom = [
    '<!-- wp:html -->',
    '<p>Custom <strong>content</strong>.</p>',
    '<!-- /wp:html -->'
  ].join('\n');
  const customResult = convertWordPressToMarkdown(custom, 'block-editor');
  assert.equal(customResult.markdown, 'Custom **content**.');
  assert.equal(customResult.fidelity, 'normalized');

  const classic = '<h2>Heading</h2>\n<p>Paragraph with <em>style</em>.</p>';
  const first = convertWordPressToMarkdown(classic, 'classic-html');
  const second = convertWordPressToMarkdown(classic, 'classic-html');
  assert.equal(first.markdown, '## Heading\n\nParagraph with *style*.');
  assert.deepEqual(second, first);
});

test('escapes paragraph text that Markdown would reinterpret as block syntax', () => {
  const values = [ '# title text', '- list text', '1. ordered text', '> quote text', '---', '~~literal~~', '&lt;https://example.com&gt;', '$x$', '%%hidden%%', '#tag', '==mark==', '^block-id' ];
  const source = values.map(value => [
    '<!-- wp:paragraph -->',
    '<p>' + value + '</p>',
    '<!-- /wp:paragraph -->'
  ].join('\n')).join('\n\n');
  const converted = convertWordPressToMarkdown(source, 'block-editor');
  const restored = renderMarkdownToWordPressBlocks(converted.markdown, new MarkdownIt());
  const parsed = parseWordPressBlocks(restored);

  assert.match(converted.markdown, /^\\# title text/m);
  assert.match(converted.markdown, /^\\- list text/m);
  assert.match(converted.markdown, /^1\\\. ordered text/m);
  assert.match(converted.markdown, /^\\> quote text/m);
  assert.match(converted.markdown, /^\\---$/m);
  assert.match(converted.markdown, /^\\~\\~literal\\~\\~$/m);
  assert.match(converted.markdown, /^\\<https:\/\/example\.com\\>$/m);
  const paragraphs = converted.markdown.split('\n\n');
  assert.ok(paragraphs.includes('\\$x\\$'));
  assert.ok(paragraphs.includes('\\%\\%hidden\\%\\%'));
  assert.ok(paragraphs.includes('\\#tag'));
  assert.ok(paragraphs.includes('\\=\\=mark\\=\\='));
  assert.ok(paragraphs.includes('\\^block-id'));
  assert.deepEqual(parsed.blocks.map(block => block.blockName), values.map(() => 'core/paragraph'));
});

test('preserves visible spaces around styled inline content', () => {
  const source = [
    '<!-- wp:paragraph -->',
    '<p>Hello<strong> world </strong>again.</p>',
    '<!-- /wp:paragraph -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');

  assert.equal(result.markdown, 'Hello **world** again.');
  assert.equal(result.fidelity, 'normalized');
});

test('preserves misleading separators and structurally lossy HTML wholesale', () => {
  const fixtures = [
    [
      '<!-- wp:separator -->',
      '<script>alert(1)</script>',
      '<!-- /wp:separator -->'
    ].join('\n'),
    [
      '<!-- wp:image -->',
      '<figure class="wp-block-image"><img src="one.jpg" alt="one"><img src="two.jpg" alt="two"></figure>',
      '<!-- /wp:image -->'
    ].join('\n'),
    [
      '<!-- wp:table {"hasFixedLayout":false} -->',
      '<figure class="wp-block-table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></figure>',
      '<!-- /wp:table -->'
    ].join('\n'),
    [
      '<!-- wp:list -->',
      '<ul class="wp-block-list"><li>One</li><p>orphan</p></ul>',
      '<!-- /wp:list -->'
    ].join('\n')
  ];

  fixtures.forEach(fixture => {
    const result = convertWordPressToMarkdown(fixture, 'block-editor');
    const split = splitProtectedWordPressSources(result.markdown);
    assert.equal(result.fidelity, 'preserved-raw');
    assert.equal(split.segments[0].content, fixture);
  });
});

test('preserves Unicode whitespace rather than collapsing it silently', () => {
  const source = '<p>A&nbsp;B</p>';
  const result = convertWordPressToMarkdown(source, 'classic-html');
  assert.equal(result.fidelity, 'preserved-raw');
  assert.equal(splitProtectedWordPressSources(result.markdown).segments[0].content, source);
});

test('preserves images whose fields conflict with the current Markdown syntax', () => {
  const fixtures = [
    '<img src="image.jpg" alt="diagram|640x360">',
    '<img src="image.jpg" height="360" alt="diagram">',
    '<a>missing destination</a>'
  ];
  fixtures.forEach(fixture => {
    const result = convertWordPressToMarkdown(fixture, 'classic-html');
    assert.equal(result.fidelity, 'preserved-raw');
    assert.equal(splitProtectedWordPressSources(result.markdown).segments[0].content, fixture);
  });
});

test('preserves unknown blocks and script-like HTML as inert source', () => {
  const unknown = [
    '<!-- wp:vendor/card {"label":"村口"} -->',
    '<div class="vendor-card"><script>alert(1)</script></div>',
    '<!-- /wp:vendor/card -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(unknown, 'block-editor');
  assert.equal(result.fidelity, 'preserved-raw');
  assert.match(result.markdown, /^%% wp-source:v1 vendor\/card\n/);
  assert.doesNotMatch(result.markdown, /<script>/);
  const split = splitProtectedWordPressSources(result.markdown);
  assert.deepEqual(split.errors, []);
  assert.equal(split.segments[0].content, unknown);

  const classicScript = convertWordPressToMarkdown(
    '<p>Before</p><script>alert(1)</script>',
    'classic-html'
  );
  assert.equal(classicScript.fidelity, 'preserved-raw');
  assert.doesNotMatch(classicScript.markdown, /<script>/);
});

test('preserves a supported parent wholesale when it contains an unknown child', () => {
  const source = [
    '<!-- wp:quote -->',
    '<blockquote class="wp-block-quote">',
    '<!-- wp:vendor/card -->',
    '<div>Vendor</div>',
    '<!-- /wp:vendor/card -->',
    '</blockquote>',
    '<!-- /wp:quote -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(source, 'block-editor');
  const split = splitProtectedWordPressSources(result.markdown);
  assert.equal(result.fidelity, 'preserved-raw');
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].blockName, 'core/quote');
  assert.equal(split.segments[0].content, source);
});

test('blocks malformed Gutenberg markup and retains the complete source', () => {
  const malformed = [
    '<!-- wp:paragraph -->',
    '<p>Body</p>',
    '<!-- /wp:quote -->'
  ].join('\n');
  const result = convertWordPressToMarkdown(malformed, 'block-editor');
  const split = splitProtectedWordPressSources(result.markdown);

  assert.equal(result.fidelity, 'blocking');
  assert.ok(result.diagnostics.every(item => item.kind === 'blocking'));
  assert.equal(result.diagnostics[0].range.start.line, 3);
  assert.equal(split.segments[0].content, malformed);
});

test('round-trips the current native serializer through canonical Markdown', () => {
  const markdown = [
    '## 标题与 *强调*',
    '',
    '正文含有 **粗体**、\`code\` 和 [链接](https://example.com "Example")。\\',
    '下一行',
    '',
    '3. 第三项',
    '   - 子项',
    '4. 第四项',
    '',
    '> 引用段落',
    '',
    '\`\`\`',
    'const answer = 42;',
    '\`\`\`',
    '',
    '---',
    '',
    '| A | B |',
    '| :--- | ---: |',
    '| 1 | 2 |'
  ].join('\n');
  const rendered = renderMarkdownToWordPressBlocks(markdown, new MarkdownIt());
  const converted = convertWordPressToMarkdown(rendered, 'block-editor');

  assert.equal(converted.markdown, markdown);
  assert.equal(converted.fidelity, 'exact');
});

test('reinserts protected unknown blocks byte-for-byte during forward serialization', () => {
  const source = [
    '<!-- wp:paragraph -->',
    '<p>Before</p>',
    '<!-- /wp:paragraph -->',
    '',
    '<!-- wp:vendor/card {"label":"村口"} -->',
    '<div class="vendor-card"><script>alert(1)</script></div>',
    '<!-- /wp:vendor/card -->',
    '',
    '<!-- wp:paragraph -->',
    '<p>After</p>',
    '<!-- /wp:paragraph -->'
  ].join('\n');
  const converted = convertWordPressToMarkdown(source, 'block-editor');
  const restored = renderMarkdownToWordPressBlocks(converted.markdown, new MarkdownIt());
  assert.equal(restored, source);
});

test('refuses to publish a damaged protected source region', () => {
  const malformed = [
    '%% wp-source:v1 vendor/card',
    'not base64',
    '%%'
  ].join('\n');
  assert.throws(
    () => renderMarkdownToWordPressBlocks(malformed, new MarkdownIt()),
    /not valid base64/
  );
});
