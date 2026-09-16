import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySeriesIntentToMatter,
  deserializeSeriesIntent,
  nonEmptyRemoteSeriesMetadataFields,
  parseSeriesDefinition,
  parseSeriesFrontMatter,
  portableSeriesFromRemote,
  resolveSeriesPublishingAvailability,
  resolveSeriesPlacement,
  serializeSeriesIntent,
  SeriesIntegrationError,
  SeriesPublishingAvailability
} from '../src/series.ts';

function seasonedSeries(overrides = {}) {
  return parseSeriesDefinition({
    id: 123,
    name: 'Incarnational Communication',
    slug: 'incarnational-communication',
    meta: {
      wptl_series_mode: 'ordered',
      wptl_series_structure: 'seasoned',
      wptl_seasons: [
        { key: 'arrival', label: 'Arrival', sort: 20, public_id: 2 },
        { key: 'practice', label: 'Practice', sort: 30, public_id: 3 }
      ]
    },
    ...overrides
  });
}

test('only version 1 public boolean capability enables advanced roles, independently of private markers', () => {
  for (const capability of [undefined, null, {}, { version: 2, book_structure: true },
    { version: '1', book_structure: true }, { version: 1, book_structure: 'true' },
    { version: 1, book_structure: false }]) {
    const definition = seasonedSeries({ wptl_capabilities: capability });
    assert.equal(definition.bookStructureEnabled, false);
    const intent = parseSeriesFrontMatter({ series: definition.slug, seriesRole: 'intro', seriesScope: 'series' }).intent;
    assert.throws(() => resolveSeriesPlacement(intent, definition), /explicit WP Title Layer/);
    assert.equal(portableSeriesFromRemote({ termIds: ['123'], seasonKey: '', role: 'intro', scope: 'series', label: 'Preface' }, definition).seriesRole, 'intro');
  }
  const enabled = seasonedSeries({ wptl_capabilities: { version: 1, book_structure: true, content_groups: 'article-only' } });
  assert.equal(enabled.bookStructureEnabled, true);
  for (const role of ['intro', 'epilogue', 'appendix']) {
    const intent = parseSeriesFrontMatter({ series: enabled.slug, seriesRole: role, seriesScope: 'series', seriesLabel: 'Custom label' }).intent;
    const result = resolveSeriesPlacement(intent, enabled);
    assert.equal(result.meta.wptl_series_role, role);
    assert.equal(result.meta.wptl_sequence_label, 'Custom label');
    assert.equal(result.meta.wptl_season_key, '');
    assert.deepEqual(portableSeriesFromRemote({ termIds: ['123'], seasonKey: '', role, scope: 'series', label: 'Custom label' }, enabled), intent.placement);
  }
});

test('seasoned non-article writes require explicit scope while legacy readback stays readable', () => {
  const definition = seasonedSeries({ wptl_capabilities: { version: 1, book_structure: true } });
  const intent = parseSeriesFrontMatter({ series: definition.slug, seriesRole: 'intro', seriesSeason: 2 }).intent;
  assert.throws(() => resolveSeriesPlacement(intent, definition), error => error.code === 'series_scope_required');
  assert.equal(portableSeriesFromRemote({ termIds: ['123'], seasonKey: 'arrival', role: 'intro', scope: '', label: '' }, definition).seriesScope, undefined);
  const flat = { ...definition, structure: 'flat', seasons: [] };
  const resolved = resolveSeriesPlacement(parseSeriesFrontMatter({ series: flat.slug, seriesRole: 'intro' }).intent, flat);
  assert.equal(resolved.meta.wptl_series_scope, 'series');
  assert.equal(resolved.portable.seriesScope, 'series');
});

test('distinguishes missing, clear, and owned Series front matter', () => {
  assert.deepEqual(parseSeriesFrontMatter({ title: 'No owner' }), { issues: [] });
  assert.deepEqual(parseSeriesFrontMatter({ series: null }), {
    intent: { kind: 'clear' },
    issues: []
  });
  assert.deepEqual(parseSeriesFrontMatter({
    series: ' incarnational-communication ',
    seriesSeason: '2',
    seriesRole: ' ARTICLE ',
    seriesLabel: 15
  }), {
    intent: {
      kind: 'placement',
      placement: {
        series: 'incarnational-communication',
        seriesSeason: 2,
        seriesRole: 'article',
        seriesLabel: '15'
      }
    },
    issues: []
  });
});

test('distinguishes an unsupported connection from an unsupported post type', () => {
  const catalog = {
    transport: 'rest',
    definitions: [],
    supportedPostTypes: [ 'post' ],
    subtitlePostTypes: []
  };
  assert.equal(
    resolveSeriesPublishingAvailability(catalog, 'post'),
    SeriesPublishingAvailability.Available
  );
  assert.equal(
    resolveSeriesPublishingAvailability(catalog, 'page'),
    SeriesPublishingAvailability.PostTypeUnsupported
  );
  assert.equal(
    resolveSeriesPublishingAvailability({ ...catalog, transport: 'unsupported' }, 'post'),
    SeriesPublishingAvailability.TransportUnsupported
  );
});

test('rejects dependent fields without a Series owner and invalid scalar types', () => {
  assert.equal(
    parseSeriesFrontMatter({ seriesSeason: 2 }).issues[0].code,
    'series_missing_owner'
  );
  assert.equal(
    parseSeriesFrontMatter({ series: '', seriesLabel: 'old' }).issues[0].code,
    'series_clear_has_dependents'
  );
  assert.equal(
    parseSeriesFrontMatter({ series: [ 'one' ] }).issues[0].code,
    'series_invalid_type'
  );
  assert.equal(
    parseSeriesFrontMatter({ series: 'one', seriesLabel: false }).issues[0].code,
    'series_invalid_label'
  );
});

test('maps a stable Season public_id to the target site internal key', () => {
  const definition = seasonedSeries();
  const intent = parseSeriesFrontMatter({
    series: definition.slug,
    seriesSeason: 2,
    seriesLabel: '15A'
  }).intent;
  assert.ok(intent);
  assert.deepEqual(resolveSeriesPlacement(intent, definition), {
    kind: 'placement',
    termIds: [ 123 ],
    meta: {
      wptl_season_key: 'arrival',
      wptl_series_role: 'article',
      wptl_series_scope: '',
      wptl_sequence_label: '15A'
    },
    portable: {
      series: definition.slug,
      seriesSeason: 2,
      seriesRole: 'article',
      seriesLabel: '15A'
    },
    definition,
    season: definition.seasons[0]
  });
});

test('validates placement against the remote Series structure before publishing', () => {
  const definition = seasonedSeries();
  assert.throws(
    () => resolveSeriesPlacement({
      kind: 'placement',
      placement: { series: definition.slug, seriesRole: 'article' }
    }, definition),
    error => error instanceof SeriesIntegrationError
      && error.code === 'series_season_required'
  );
  assert.throws(
    () => resolveSeriesPlacement({
      kind: 'placement',
      placement: {
        series: definition.slug,
        seriesSeason: 2,
        seriesRole: 'intro',
        seriesScope: 'season'
      }
    }, definition),
    error => error instanceof SeriesIntegrationError
      && error.code === 'series_book_structure_unavailable'
  );
});

test('round-trips only portable Series values and never stores term IDs or Season keys', () => {
  const intent = parseSeriesFrontMatter({
    series: 'incarnational-communication',
    seriesSeason: 2,
    seriesLabel: '0-2'
  }).intent;
  assert.ok(intent);
  const serialized = serializeSeriesIntent(intent);
  assert.doesNotMatch(serialized, /123|arrival/);
  assert.deepEqual(deserializeSeriesIntent(serialized), intent);

  const matter = { keep: 'me', series: 'old', seriesScope: 'series' };
  applySeriesIntentToMatter(matter, intent);
  assert.deepEqual(matter, {
    keep: 'me',
    series: 'incarnational-communication',
    seriesSeason: 2,
    seriesLabel: '0-2'
  });
});

test('converts a remote internal Season key back to public front matter', () => {
  const definition = seasonedSeries();
  assert.deepEqual(portableSeriesFromRemote({
    termIds: [ '123' ],
    seasonKey: 'arrival',
    role: 'article',
    scope: '',
    label: '15A'
  }, definition), {
    series: definition.slug,
    seriesSeason: 2,
    seriesRole: 'article',
    seriesLabel: '15A'
  });
  assert.equal(portableSeriesFromRemote({
    termIds: [],
    seasonKey: '',
    role: '',
    scope: '',
    label: ''
  }), null);
});

test('reads an existing advanced role without enabling unsupported writes', () => {
  const definition = seasonedSeries();
  assert.deepEqual(portableSeriesFromRemote({
    termIds: [ '123' ],
    seasonKey: 'arrival',
    role: 'intro',
    scope: 'season',
    label: '0-1'
  }, definition), {
    series: definition.slug,
    seriesSeason: 2,
    seriesRole: 'intro',
    seriesScope: 'season',
    seriesLabel: '0-1'
  });
  assert.throws(
    () => resolveSeriesPlacement({
      kind: 'placement',
      placement: {
        series: definition.slug,
        seriesSeason: 2,
        seriesRole: 'intro',
        seriesScope: 'season'
      }
    }, definition),
    error => error instanceof SeriesIntegrationError
      && error.code === 'series_book_structure_unavailable'
  );
});

test('detects dependent metadata left behind after a remote Series clear', () => {
  assert.deepEqual(nonEmptyRemoteSeriesMetadataFields({
    termIds: [],
    seasonKey: 'arrival',
    role: '',
    scope: '',
    label: '15A'
  }), [ 'wptl_season_key', 'wptl_sequence_label' ]);
  assert.deepEqual(nonEmptyRemoteSeriesMetadataFields({
    termIds: [],
    seasonKey: '',
    role: '',
    scope: '',
    label: ''
  }), []);
});
