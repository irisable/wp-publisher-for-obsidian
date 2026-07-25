import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTextReplacements } from '../src/content-replacements.ts';

test('replaces media links without removing front matter or other content', () => {
  const note = `---
title: Keep me
customProperty: keep me too
---
Before
![[local.png]]
After`;

  const updated = applyTextReplacements(note, [ {
    original: '![[local.png]]',
    replacement: '![[https://example.com/uploaded.png]]'
  } ]);

  assert.equal(updated, `---
title: Keep me
customProperty: keep me too
---
Before
![[https://example.com/uploaded.png]]
After`);
});
