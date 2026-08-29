import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourceUrl = new URL(
  '../wordpress-companion/wp-publisher-companion/wp-publisher-companion.php',
  import.meta.url
);
const readmeUrl = new URL(
  '../wordpress-companion/wp-publisher-companion/readme.txt',
  import.meta.url
);
const source = readFileSync(sourceUrl, 'utf8');
const readme = readFileSync(readmeUrl, 'utf8');

test('keeps the companion package versions aligned', () => {
  const header = source.match(/^ \* Version: ([^\s]+)$/m)?.[1];
  const constant = source.match(
    /WP_PUBLISHER_COMPANION_VERSION\s*=\s*'([^']+)'/
  )?.[1];
  const stable = readme.match(/^Stable tag:\s*([^\s]+)$/m)?.[1];
  assert.equal(header, '0.5.0');
  assert.equal(constant, header);
  assert.equal(stable, header);
});

test('reports WP Title Layer as the canonical subtitle provider', () => {
  assert.match(
    source,
    /function wp_publisher_companion_has_wp_title_layer\(\)[\s\S]*?defined\( 'WPTL_VERSION' \)/
  );
  assert.match(
    source,
    /function wp_publisher_companion_subtitle_provider\(\)[\s\S]*?return 'wp-title-layer';[\s\S]*?return 'legacy-secondary-title';/
  );
  assert.match(source, /'wpTitleLayer'\s*=>\s*wp_publisher_companion_has_wp_title_layer\(\)/);
  assert.match(source, /'subtitleProvider'\s*=>\s*wp_publisher_companion_subtitle_provider\(\)/);
});

test('keeps canonical WPTL writes out of the legacy companion routes', () => {
  assert.match(
    source,
    /function wp_publisher_companion_has_secondary_title\(\)[\s\S]*?'legacy-secondary-title' === wp_publisher_companion_subtitle_provider\(\)/
  );
  assert.match(
    source,
    /wp_publisher_wp_title_layer_canonical/
  );
  assert.doesNotMatch(
    source,
    /(?:update|delete)_post_meta\([^;]*['"]wptl_subtitle['"]/s
  );
});
