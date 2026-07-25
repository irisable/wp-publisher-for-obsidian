import assert from 'node:assert/strict';
import test from 'node:test';
import { getWordPressBlockStats } from '../src/publish-preview.ts';

test('counts serialized Gutenberg blocks and custom HTML fallbacks', () => {
  const content = [
    '<!-- wp:paragraph -->',
    '<p>Intro</p>',
    '<!-- /wp:paragraph -->',
    '<!-- wp:list -->',
    '<ul><!-- wp:list-item --><li>One</li><!-- /wp:list-item --></ul>',
    '<!-- /wp:list -->',
    '<!-- wp:html -->',
    '<aside>Fallback</aside>',
    '<!-- /wp:html -->'
  ].join('\n');

  assert.deepEqual(getWordPressBlockStats(content), {
    blockCount: 4,
    customHtmlCount: 1
  });
});

test('returns zero diagnostics for classic HTML output', () => {
  assert.deepEqual(getWordPressBlockStats('<p>Classic</p>'), {
    blockCount: 0,
    customHtmlCount: 0
  });
});
