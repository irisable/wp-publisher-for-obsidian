import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { markdownItWordPressListPlugin } from '../src/markdown-it-wordpress-list-plugin.ts';

function render(markdown) {
  return new MarkdownIt().use(markdownItWordPressListPlugin).render(markdown);
}

test('renders tight and loose unordered lists with the same compact items', () => {
  const expected = '<ul>\n<li>Alpha</li>\n<li>Beta</li>\n</ul>\n';
  assert.equal(render('- Alpha\n- Beta'), expected);
  assert.equal(render('- Alpha\n\n- Beta'), expected);
});

test('removes extra paragraph wrappers from loose ordered lists', () => {
  assert.equal(
    render('1. First\n\n2. Second'),
    '<ol>\n<li>First</li>\n<li>Second</li>\n</ol>\n'
  );
});

test('keeps nested lists compact while preserving their hierarchy', () => {
  const html = render('- Parent\n\n  - Child A\n  - Child B');
  assert.equal(html, '<ul>\n<li>Parent\n<ul>\n<li>Child A</li>\n<li>Child B</li>\n</ul>\n</li>\n</ul>\n');
});

test('preserves intentional multiple paragraphs inside one list item', () => {
  const html = render('- First paragraph\n\n  Second paragraph');
  assert.match(html, /<li>\n<p>First paragraph<\/p>\n<p>Second paragraph<\/p>\n<\/li>/);
});

test('does not alter paragraphs outside lists or inline images inside list items', () => {
  const html = render('Before\n\n- ![Alt](https://example.com/image.jpg)\n\nAfter');
  assert.match(html, /^<p>Before<\/p>/);
  assert.ok(html.includes('<li><img src="https://example.com/image.jpg" alt="Alt"></li>'));
  assert.match(html, /<p>After<\/p>\n$/);
});
