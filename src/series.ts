import type { MatterData } from './types';
import type { TranslateKey } from './i18n';

export const WPTL_SERIES_TAXONOMY = 'wptl_series';
export const WPTL_SUBTITLE_META = 'wptl_subtitle';
export const WPTL_SERIES_GROUP_META = 'wptl_series_group';
export const WPTL_SEASON_KEY_META = 'wptl_season_key';
export const WPTL_SERIES_ROLE_META = 'wptl_series_role';
export const WPTL_SERIES_SCOPE_META = 'wptl_series_scope';
export const WPTL_SEQUENCE_LABEL_META = 'wptl_sequence_label';

export const SeriesRole = {
  Article: 'article',
  Intro: 'intro',
  Epilogue: 'epilogue',
  Appendix: 'appendix'
} as const;

export type SeriesRole = typeof SeriesRole[keyof typeof SeriesRole];

export const SeriesScope = {
  Series: 'series',
  Season: 'season'
} as const;

export type SeriesScope = typeof SeriesScope[keyof typeof SeriesScope];

export const SeriesStructure = {
  Flat: 'flat',
  Seasoned: 'seasoned'
} as const;

export type SeriesStructure = typeof SeriesStructure[keyof typeof SeriesStructure];

export interface PortableSeriesPlacement {
  series: string;
  seriesSeason?: number;
  seriesRole: SeriesRole;
  seriesScope?: SeriesScope;
  seriesLabel?: string;
}

export type SeriesPlacementIntent =
  | { kind: 'clear' }
  | { kind: 'placement', placement: PortableSeriesPlacement };

export interface SeriesParseIssue {
  field: 'series' | 'seriesSeason' | 'seriesRole' | 'seriesScope' | 'seriesLabel' | 'seriesGroup';
  code: string;
  message: string;
}

export type SeriesTranslator = (
  key: TranslateKey,
  vars?: Record<string, string>
) => string;

export interface SeriesFrontMatterResult {
  /** Missing means the note does not own the remote Series placement. */
  intent?: SeriesPlacementIntent;
  issues: SeriesParseIssue[];
}

export interface SeriesSeasonDefinition {
  key: string;
  label: string;
  sort: number;
  publicId?: number;
}

export interface SeriesDefinition {
  termId: number;
  name: string;
  slug: string;
  mode: 'ordered' | 'unordered';
  structure: SeriesStructure;
  seasons: SeriesSeasonDefinition[];
  /** Only a recognized public capability may enable advanced-role writes. */
  bookStructureEnabled: boolean;
}

export interface ResolvedSeriesPlacement {
  kind: 'clear' | 'placement';
  termIds: number[];
  meta: {
    [WPTL_SEASON_KEY_META]: string;
    [WPTL_SERIES_ROLE_META]: string;
    [WPTL_SERIES_SCOPE_META]: string;
    [WPTL_SEQUENCE_LABEL_META]: string;
  };
  portable?: PortableSeriesPlacement;
  definition?: SeriesDefinition;
  season?: SeriesSeasonDefinition;
}

export interface RemoteSeriesPlacementRaw {
  termIds: string[];
  seasonKey: string;
  role: string;
  scope: string;
  label: string;
}

export function nonEmptyRemoteSeriesMetadataFields(
  raw: RemoteSeriesPlacementRaw
): string[] {
  return [
    [ WPTL_SEASON_KEY_META, raw.seasonKey ],
    [ WPTL_SERIES_ROLE_META, raw.role ],
    [ WPTL_SERIES_SCOPE_META, raw.scope ],
    [ WPTL_SEQUENCE_LABEL_META, raw.label ]
  ].flatMap(([ field, value ]) => value.trim() ? [ field ] : []);
}

export interface SeriesPublishingCatalog {
  transport: 'rest' | 'unsupported';
  definitions: SeriesDefinition[];
  supportedPostTypes: string[];
  subtitlePostTypes: string[];
  error?: string;
}

export const SeriesPublishingAvailability = {
  Available: 'available',
  TransportUnsupported: 'transport-unsupported',
  PostTypeUnsupported: 'post-type-unsupported'
} as const;

export type SeriesPublishingAvailability = typeof SeriesPublishingAvailability[
  keyof typeof SeriesPublishingAvailability
];

/** Distinguish an unavailable REST transport from an unsupported post type. */
export function resolveSeriesPublishingAvailability(
  catalog: SeriesPublishingCatalog,
  postType: string
): SeriesPublishingAvailability {
  if (catalog.transport !== 'rest') {
    return SeriesPublishingAvailability.TransportUnsupported;
  }
  return catalog.supportedPostTypes.includes(postType)
    ? SeriesPublishingAvailability.Available
    : SeriesPublishingAvailability.PostTypeUnsupported;
}

const SERIES_DEPENDENT_KEYS = [
  'seriesSeason',
  'seriesRole',
  'seriesScope',
  'seriesLabel'
] as const;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyScalar(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value === 'number' || typeof value === 'boolean'
    || Array.isArray(value) || isRecord(value);
}

function issue(
  field: SeriesParseIssue['field'],
  code: string,
  message: string
): SeriesParseIssue {
  return { field, code, message };
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function scalarLabel(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/** Parse canonical fields while preserving missing versus explicit empty Series. */
export function parseSeriesFrontMatter(
  matter: MatterData
): SeriesFrontMatterResult {
  const result = parseSeriesPlacementFrontMatter(matter);
  if (!isNonArticleSeries(result.intent)
    && hasOwn(matter, 'seriesGroup') && typeof matter.seriesGroup !== 'string') {
    result.issues.push(issue(
      'seriesGroup',
      'series_invalid_group',
      'seriesGroup must be a string. Use seriesGroup: "" to clear the group; a blank YAML value (null) is not an explicit clear.'
    ));
  }
  return result;
}

export function isNonArticleSeries(intent?: SeriesPlacementIntent): boolean {
  return intent?.kind === 'placement' && intent.placement.seriesRole !== SeriesRole.Article;
}

function parseSeriesPlacementFrontMatter(matter: MatterData): SeriesFrontMatterResult {
  const ownsSeries = hasOwn(matter, 'series');
  if (!ownsSeries) {
    const dependent = SERIES_DEPENDENT_KEYS.find(key => (
      hasOwn(matter, key) && nonEmptyScalar(matter[key])
    ));
    return dependent
      ? {
        issues: [ issue(
          dependent,
          'series_missing_owner',
          dependent + ' requires a non-empty series property.'
        ) ]
      }
      : { issues: [] };
  }

  const rawSeries = matter.series;
  if (rawSeries !== null && typeof rawSeries !== 'string') {
    return {
      issues: [ issue(
        'series',
        'series_invalid_type',
        'series must be a scalar WordPress slug or an explicit empty value.'
      ) ]
    };
  }

  const series = typeof rawSeries === 'string' ? rawSeries.trim() : '';
  if (!series) {
    const dependent = SERIES_DEPENDENT_KEYS.find(key => (
      hasOwn(matter, key) && nonEmptyScalar(matter[key])
    ));
    return dependent
      ? {
        issues: [ issue(
          dependent,
          'series_clear_has_dependents',
          dependent + ' must be removed when series is explicitly empty.'
        ) ]
      }
      : { intent: { kind: 'clear' }, issues: [] };
  }

  const issues: SeriesParseIssue[] = [];
  let seriesSeason: number | undefined;
  if (hasOwn(matter, 'seriesSeason') && nonEmptyScalar(matter.seriesSeason)) {
    seriesSeason = positiveInteger(matter.seriesSeason);
    if (seriesSeason === undefined) {
      issues.push(issue(
        'seriesSeason',
        'series_invalid_season',
        'seriesSeason must be a positive integer or a numeric string.'
      ));
    }
  }

  let seriesRole: SeriesRole = SeriesRole.Article;
  if (hasOwn(matter, 'seriesRole') && nonEmptyScalar(matter.seriesRole)) {
    if (typeof matter.seriesRole !== 'string') {
      issues.push(issue(
        'seriesRole',
        'series_invalid_role_type',
        'seriesRole must be a string.'
      ));
    } else {
      const normalized = matter.seriesRole.trim().toLowerCase();
      if (!Object.values(SeriesRole).includes(normalized as SeriesRole)) {
        issues.push(issue(
          'seriesRole',
          'series_invalid_role',
          'seriesRole must be article, intro, epilogue, or appendix.'
        ));
      } else {
        seriesRole = normalized as SeriesRole;
      }
    }
  }

  let seriesScope: SeriesScope | undefined;
  if (hasOwn(matter, 'seriesScope') && nonEmptyScalar(matter.seriesScope)) {
    if (typeof matter.seriesScope !== 'string') {
      issues.push(issue(
        'seriesScope',
        'series_invalid_scope_type',
        'seriesScope must be a string.'
      ));
    } else {
      const normalized = matter.seriesScope.trim().toLowerCase();
      if (!Object.values(SeriesScope).includes(normalized as SeriesScope)) {
        issues.push(issue(
          'seriesScope',
          'series_invalid_scope',
          'seriesScope must be series or season.'
        ));
      } else {
        seriesScope = normalized as SeriesScope;
      }
    }
  }

  let seriesLabel: string | undefined;
  if (hasOwn(matter, 'seriesLabel') && nonEmptyScalar(matter.seriesLabel)) {
    seriesLabel = scalarLabel(matter.seriesLabel);
    if (seriesLabel === undefined) {
      issues.push(issue(
        'seriesLabel',
        'series_invalid_label',
        'seriesLabel must be one string or finite number.'
      ));
    }
  }

  if (issues.length > 0) return { issues };
  return {
    intent: {
      kind: 'placement',
      placement: {
        series,
        seriesRole,
        ...(seriesSeason !== undefined ? { seriesSeason } : {}),
        ...(seriesScope ? { seriesScope } : {}),
        ...(seriesLabel ? { seriesLabel } : {})
      }
    },
    issues: []
  };
}

export class SeriesIntegrationError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string
  ) {
    super(message);
    this.name = 'SeriesIntegrationError';
    this.code = code;
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress did not return a valid ' + field + ' for the Series.'
    );
  }
  return value.trim();
}

function parseSeason(value: unknown): SeriesSeasonDefinition {
  if (!isRecord(value)) {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress returned an invalid Season definition.'
    );
  }
  const sort = typeof value.sort === 'number' && Number.isSafeInteger(value.sort)
    ? value.sort
    : undefined;
  if (sort === undefined) {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress returned a Season without a valid sort value.'
    );
  }
  const publicId = positiveInteger(value.public_id);
  return {
    key: requiredText(value.key, 'Season key'),
    label: requiredText(value.label, 'Season label'),
    sort,
    ...(publicId ? { publicId } : {})
  };
}

/** Parse only public WPTL definition data; private markers are intentionally ignored. */
export function parseSeriesDefinition(value: unknown): SeriesDefinition {
  if (!isRecord(value)) {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress returned an invalid Series definition.'
    );
  }
  const termId = positiveInteger(value.id);
  const meta = isRecord(value.meta) ? value.meta : undefined;
  if (!termId || !meta
    || !hasOwn(meta, 'wptl_series_mode')
    || !hasOwn(meta, 'wptl_series_structure')
    || !hasOwn(meta, 'wptl_seasons')
  ) {
    throw new SeriesIntegrationError(
      'series_definition_meta_unavailable',
      'WordPress did not expose the editable WP Title Layer Series metadata.'
    );
  }
  const mode = meta.wptl_series_mode;
  if (mode !== 'ordered' && mode !== 'unordered') {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress returned an unsupported Series mode.'
    );
  }
  const structure = meta.wptl_series_structure;
  if (structure !== SeriesStructure.Flat && structure !== SeriesStructure.Seasoned) {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress returned an unsupported Series structure.'
    );
  }
  if (!Array.isArray(meta.wptl_seasons)) {
    throw new SeriesIntegrationError(
      'series_malformed_definition',
      'WordPress returned invalid Season metadata.'
    );
  }
  return {
    termId,
    name: requiredText(value.name, 'Series name'),
    slug: requiredText(value.slug, 'Series slug'),
    mode,
    structure,
    seasons: meta.wptl_seasons.map(parseSeason),
    bookStructureEnabled: isRecord(value.wptl_capabilities)
      && value.wptl_capabilities.version === 1
      && value.wptl_capabilities.book_structure === true
  };
}

function uniqueSeasonByPublicId(
  definition: SeriesDefinition,
  publicId: number
): SeriesSeasonDefinition {
  const matches = definition.seasons.filter(season => season.publicId === publicId);
  if (matches.length !== 1) {
    throw new SeriesIntegrationError(
      matches.length === 0 ? 'series_season_not_found' : 'series_season_not_unique',
      matches.length === 0
        ? 'The selected Series does not contain Season public_id ' + publicId + '.'
        : 'The selected Series contains duplicate Season public_id ' + publicId + '.'
    );
  }
  return matches[0];
}

export function resolveSeriesPlacement(
  intent: SeriesPlacementIntent,
  definition?: SeriesDefinition,
  options: { allowUnverifiedAdvancedRole?: boolean } = {}
): ResolvedSeriesPlacement {
  if (intent.kind === 'clear') {
    return {
      kind: 'clear',
      termIds: [],
      meta: {
        [WPTL_SEASON_KEY_META]: '',
        [WPTL_SERIES_ROLE_META]: '',
        [WPTL_SERIES_SCOPE_META]: '',
        [WPTL_SEQUENCE_LABEL_META]: ''
      }
    };
  }
  if (!definition || definition.slug !== intent.placement.series) {
    throw new SeriesIntegrationError(
      'series_not_found',
      'The selected WordPress Series could not be resolved by its exact slug.'
    );
  }

  const placement = { ...intent.placement };
  if (placement.seriesRole !== SeriesRole.Article
    && !definition.bookStructureEnabled
    && !options.allowUnverifiedAdvancedRole
  ) {
    throw new SeriesIntegrationError(
      'series_book_structure_unavailable',
      'Advanced Series roles require an explicit WP Title Layer book-structure capability.'
    );
  }
  if (placement.seriesRole === SeriesRole.Article && placement.seriesScope) {
    throw new SeriesIntegrationError(
      'series_article_scope',
      'A regular Series article must not declare seriesScope.'
    );
  }
  if (placement.seriesRole !== SeriesRole.Article && !placement.seriesScope
    && !options.allowUnverifiedAdvancedRole) {
    if (definition.structure === SeriesStructure.Seasoned) {
      throw new SeriesIntegrationError(
        'series_scope_required',
        'Choose seriesScope: series or season explicitly for a non-article role in a seasoned Series.'
      );
    }
    placement.seriesScope = SeriesScope.Series;
  }
  if (placement.seriesScope === SeriesScope.Series
    && placement.seriesSeason !== undefined
  ) {
    throw new SeriesIntegrationError(
      'series_scope_season_conflict',
      'seriesScope: series cannot be combined with seriesSeason.'
    );
  }
  if (placement.seriesScope === SeriesScope.Season
    && placement.seriesSeason === undefined
  ) {
    throw new SeriesIntegrationError(
      'series_scope_missing_season',
      'seriesScope: season requires seriesSeason.'
    );
  }

  let season: SeriesSeasonDefinition | undefined;
  if (definition.structure === SeriesStructure.Flat) {
    if (placement.seriesSeason !== undefined) {
      throw new SeriesIntegrationError(
        'series_flat_has_season',
        'A flat Series cannot use seriesSeason.'
      );
    }
  } else if (placement.seriesRole === SeriesRole.Article) {
    if (placement.seriesSeason === undefined) {
      throw new SeriesIntegrationError(
        'series_season_required',
        'A regular article in a seasoned Series requires seriesSeason.'
      );
    }
    season = uniqueSeasonByPublicId(definition, placement.seriesSeason);
  } else if (placement.seriesSeason !== undefined) {
    season = uniqueSeasonByPublicId(definition, placement.seriesSeason);
  }

  return {
    kind: 'placement',
    termIds: [ definition.termId ],
    meta: {
      [WPTL_SEASON_KEY_META]: season?.key ?? '',
      [WPTL_SERIES_ROLE_META]: placement.seriesRole,
      [WPTL_SERIES_SCOPE_META]: placement.seriesScope ?? '',
      [WPTL_SEQUENCE_LABEL_META]: placement.seriesLabel ?? ''
    },
    portable: { ...placement },
    definition,
    ...(season ? { season } : {})
  };
}

export function portableSeriesFromRemote(
  raw: RemoteSeriesPlacementRaw,
  definition?: SeriesDefinition
): PortableSeriesPlacement | null {
  if (raw.termIds.length === 0) return null;
  if (raw.termIds.length !== 1 || !definition
    || String(definition.termId) !== raw.termIds[0]
  ) {
    throw new SeriesIntegrationError(
      'series_remote_placement_invalid',
      'WordPress returned an invalid or multiple-Series placement.'
    );
  }
  const role = raw.role || SeriesRole.Article;
  if (!Object.values(SeriesRole).includes(role as SeriesRole)) {
    throw new SeriesIntegrationError(
      'series_remote_role_invalid',
      'WordPress returned an unsupported Series role.'
    );
  }
  const scope = raw.scope || undefined;
  if (scope && !Object.values(SeriesScope).includes(scope as SeriesScope)) {
    throw new SeriesIntegrationError(
      'series_remote_scope_invalid',
      'WordPress returned an unsupported Series scope.'
    );
  }
  let season: SeriesSeasonDefinition | undefined;
  if (raw.seasonKey) {
    const matches = definition.seasons.filter(item => item.key === raw.seasonKey);
    if (matches.length !== 1 || !matches[0].publicId) {
      throw new SeriesIntegrationError(
        'series_remote_season_unportable',
        'The remote Season key cannot be mapped to one stable public_id.'
      );
    }
    season = matches[0];
  }
  const placement: PortableSeriesPlacement = {
    series: definition.slug,
    seriesRole: role as SeriesRole,
    ...(season?.publicId ? { seriesSeason: season.publicId } : {}),
    ...(scope ? { seriesScope: scope as SeriesScope } : {}),
    ...(raw.label ? { seriesLabel: raw.label } : {})
  };
  resolveSeriesPlacement(
    { kind: 'placement', placement },
    definition,
    { allowUnverifiedAdvancedRole: true }
  );
  return placement;
}

interface SerializedSeriesPlacement {
  state: 'clear' | 'placement';
  series?: string;
  seriesSeason?: number;
  seriesRole?: SeriesRole;
  seriesScope?: SeriesScope;
  seriesLabel?: string;
}

export function serializeSeriesIntent(intent: SeriesPlacementIntent): string {
  if (intent.kind === 'clear') return JSON.stringify({ state: 'clear' });
  const value: SerializedSeriesPlacement = {
    state: 'placement',
    series: intent.placement.series,
    seriesRole: intent.placement.seriesRole,
    ...(intent.placement.seriesSeason !== undefined
      ? { seriesSeason: intent.placement.seriesSeason }
      : {}),
    ...(intent.placement.seriesScope
      ? { seriesScope: intent.placement.seriesScope }
      : {}),
    ...(intent.placement.seriesLabel
      ? { seriesLabel: intent.placement.seriesLabel }
      : {})
  };
  return JSON.stringify(value);
}

export function deserializeSeriesIntent(value: string): SeriesPlacementIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SeriesIntegrationError(
      'series_snapshot_invalid',
      'The stored Series sync snapshot is invalid.'
    );
  }
  if (!isRecord(parsed)) {
    throw new SeriesIntegrationError(
      'series_snapshot_invalid',
      'The stored Series sync snapshot is invalid.'
    );
  }
  if (parsed.state === 'clear') return { kind: 'clear' };
  if (parsed.state !== 'placement') {
    throw new SeriesIntegrationError(
      'series_snapshot_invalid',
      'The stored Series sync snapshot has an unknown state.'
    );
  }
  const result = parseSeriesFrontMatter({
    series: parsed.series,
    ...(parsed.seriesSeason !== undefined ? { seriesSeason: parsed.seriesSeason } : {}),
    ...(parsed.seriesRole !== undefined ? { seriesRole: parsed.seriesRole } : {}),
    ...(parsed.seriesScope !== undefined ? { seriesScope: parsed.seriesScope } : {}),
    ...(parsed.seriesLabel !== undefined ? { seriesLabel: parsed.seriesLabel } : {})
  });
  if (!result.intent || result.issues.length > 0) {
    throw new SeriesIntegrationError(
      'series_snapshot_invalid',
      result.issues[0]?.message ?? 'The stored Series sync snapshot is incomplete.'
    );
  }
  return result.intent;
}

export function applySeriesIntentToMatter(
  matter: MatterData,
  intent: SeriesPlacementIntent | undefined
): void {
  SERIES_DEPENDENT_KEYS.forEach(key => delete matter[key]);
  if (!intent) {
    delete matter.series;
    return;
  }
  if (intent.kind === 'clear') {
    matter.series = '';
    return;
  }
  const placement = intent.placement;
  matter.series = placement.series;
  if (placement.seriesSeason !== undefined) {
    matter.seriesSeason = placement.seriesSeason;
  }
  if (placement.seriesRole !== SeriesRole.Article) {
    matter.seriesRole = placement.seriesRole;
  }
  if (placement.seriesScope) {
    matter.seriesScope = placement.seriesScope;
  }
  if (placement.seriesLabel) {
    matter.seriesLabel = placement.seriesLabel;
  }
}

export function describeSeriesIntent(
  intent: SeriesPlacementIntent | undefined,
  definitions: readonly SeriesDefinition[] = [],
  labels: {
    keepRemote: string;
    explicitClear: string;
    role: Partial<Record<SeriesRole, string>>;
    scope: Partial<Record<SeriesScope, string>>;
    formatLabel: (value: string) => string;
  } = {
    keepRemote: 'Keep remote Series unchanged',
    explicitClear: 'No Series (explicit clear)',
    role: {
      [SeriesRole.Intro]: 'intro',
      [SeriesRole.Epilogue]: 'epilogue',
      [SeriesRole.Appendix]: 'appendix'
    },
    scope: {
      [SeriesScope.Series]: 'series',
      [SeriesScope.Season]: 'season'
    },
    formatLabel: value => 'label: ' + value
  }
): string {
  if (!intent) return labels.keepRemote;
  if (intent.kind === 'clear') return labels.explicitClear;
  const placement = intent.placement;
  const definition = definitions.find(item => item.slug === placement.series);
  const season = definition?.seasons.find(
    item => item.publicId === placement.seriesSeason
  );
  return [
    definition?.name ?? placement.series,
    season ? season.label + ' (#' + season.publicId + ')' : undefined,
    placement.seriesRole !== SeriesRole.Article
      ? labels.role[placement.seriesRole] ?? placement.seriesRole
      : undefined,
    placement.seriesScope
      ? labels.scope[placement.seriesScope] ?? placement.seriesScope
      : undefined,
    placement.seriesLabel ? labels.formatLabel(placement.seriesLabel) : undefined
  ].filter(Boolean).join(' / ');
}

export function describeSeriesIntentForUi(
  intent: SeriesPlacementIntent | undefined,
  t: SeriesTranslator,
  definitions: readonly SeriesDefinition[] = []
): string {
  return describeSeriesIntent(intent, definitions, {
    keepRemote: t('seriesDescription_keepRemote'),
    explicitClear: t('seriesDescription_explicitClear'),
    role: {
      [SeriesRole.Intro]: t('seriesDescription_roleIntro'),
      [SeriesRole.Epilogue]: t('seriesDescription_roleEpilogue'),
      [SeriesRole.Appendix]: t('seriesDescription_roleAppendix')
    },
    scope: {
      [SeriesScope.Series]: t('seriesDescription_scopeSeries'),
      [SeriesScope.Season]: t('seriesDescription_scopeSeason')
    },
    formatLabel: value => t('seriesDescription_label', { value })
  });
}

export function describeSerializedSeriesIntent(value: string): string {
  try {
    return describeSeriesIntent(deserializeSeriesIntent(value));
  } catch {
    return value;
  }
}

export function describeSerializedSeriesIntentForUi(
  value: string,
  t: SeriesTranslator,
  definitions: readonly SeriesDefinition[] = []
): string {
  try {
    return describeSeriesIntentForUi(
      deserializeSeriesIntent(value),
      t,
      definitions
    );
  } catch {
    return value;
  }
}

const SERIES_ISSUE_TRANSLATIONS: Partial<Record<string, TranslateKey>> = {
  series_invalid_group: 'seriesIssue_invalidGroup',
  series_missing_owner: 'seriesIssue_missingOwner',
  series_invalid_type: 'seriesIssue_invalidType',
  series_clear_has_dependents: 'seriesIssue_clearHasDependents',
  series_invalid_season: 'seriesIssue_invalidSeason',
  series_invalid_role_type: 'seriesIssue_invalidRoleType',
  series_invalid_role: 'seriesIssue_invalidRole',
  series_invalid_scope_type: 'seriesIssue_invalidScopeType',
  series_invalid_scope: 'seriesIssue_invalidScope',
  series_invalid_label: 'seriesIssue_invalidLabel'
};

export function describeSeriesIssueForUi(
  issue: SeriesParseIssue,
  t: SeriesTranslator
): string {
  const key = SERIES_ISSUE_TRANSLATIONS[issue.code];
  return key ? t(key, { field: issue.field }) : issue.message;
}

export function seriesPlacementsEqual(
  left: SeriesPlacementIntent | undefined,
  right: SeriesPlacementIntent | undefined
): boolean {
  if (!left || !right) return left === right;
  return serializeSeriesIntent(left) === serializeSeriesIntent(right);
}
