import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  parseWordPressBlocks,
  protectWordPressSource,
  splitProtectedWordPressSources
} = await importTypescriptModule(
  new URL('../src/wordpress-block-parser.ts', import.meta.url)
);

test('parses nested Gutenberg blocks with attributes, exact source, and locations', () => {
  const source = [
    '<!-- wp:quote -->',
    '<blockquote class="wp-block-quote">',
    '<!-- wp:paragraph -->',
    '<p>Intro</p>',
    '<!-- /wp:paragraph -->',
    '<!-- wp:list {"ordered":true,"start":3} -->',
    '<ol class="wp-block-list" start="3"></ol>',
    '<!-- /wp:list -->',
    '</blockquote>',
    '<!-- /wp:quote -->'
  ].join('\n');
  const parsed = parseWordPressBlocks(source);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].blockName, 'core/quote');
  assert.equal(parsed.blocks[0].raw, source);
  assert.deepEqual(
    parsed.blocks[0].innerBlocks.map(block => block.blockName),
    [ 'core/paragraph', 'core/list' ]
  );
  assert.deepEqual(parsed.blocks[0].innerBlocks[1].attrs, {
    ordered: true,
    start: 3
  });
  assert.deepEqual(parsed.blocks[0].range.start, {
    offset: 0,
    line: 1,
    column: 1
  });
  assert.equal(parsed.blocks[0].range.end.offset, source.length);
  assert.equal(parsed.blocks[0].range.end.line, 10);
});

test('keeps non-block HTML as an explicitly located freeform segment', () => {
  const source = '<p>Before</p>\n<!-- wp:separator /-->\n<p>After</p>';
  const parsed = parseWordPressBlocks(source);
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.blocks.map(block => block.blockName), [
    null,
    'core/separator',
    null
  ]);
  assert.equal(parsed.blocks[0].raw, '<p>Before</p>\n');
  assert.equal(parsed.blocks[2].range.start.line, 2);
});

test('reports malformed attributes, mismatched closes, and unclosed blocks', () => {
  const malformed = parseWordPressBlocks([
    '<!-- wp:paragraph {broken} -->',
    '<p>Body</p>',
    '<!-- wp:quote -->',
    '<blockquote>Quote</blockquote>',
    '<!-- /wp:list -->'
  ].join('\n'));
  assert.equal(malformed.valid, false);
  assert.deepEqual(
    malformed.diagnostics.map(item => item.code),
    [ 'invalid-block-attributes', 'mismatched-block-close', 'unclosed-block' ]
  );
  assert.equal(malformed.diagnostics[0].range.start.line, 1);
  assert.equal(malformed.diagnostics[1].range.start.line, 5);
});

test('protects Unicode WordPress source and decodes it byte-for-byte', () => {
  const source = '<!-- wp:vendor/card {"label":"村口"} -->\n<script>alert(1)</script>\n<!-- /wp:vendor/card -->';
  const protectedSource = protectWordPressSource(source, 'vendor/card');
  const split = splitProtectedWordPressSources(
    'Before\n\n' + protectedSource + '\n\nAfter'
  );
  assert.deepEqual(split.errors, []);
  assert.deepEqual(split.segments, [
    { kind: 'markdown', content: 'Before\n\n' },
    { kind: 'wordpress-source', content: source, label: 'vendor/card' },
    { kind: 'markdown', content: '\nAfter' }
  ]);
});

test('does not decode wp-source marker examples inside Markdown code fences', () => {
  const markdown = [
    '```text',
    '%% wp-source:v1 vendor/card',
    'bm90IHJlYWw=',
    '%%',
    '```'
  ].join('\n');
  assert.deepEqual(splitProtectedWordPressSources(markdown), {
    segments: [ { kind: 'markdown', content: markdown } ],
    errors: []
  });
});

test('rejects malformed protected payloads instead of silently dropping them', () => {
  const split = splitProtectedWordPressSources([
    '%% wp-source:v1 vendor/card',
    'not base64',
    '%%'
  ].join('\n'));
  assert.equal(split.errors.length, 1);
  assert.equal(split.segments[0].kind, 'markdown');
});
