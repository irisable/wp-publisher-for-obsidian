import type { MatterData } from './types';
import type {
  PullField,
  PullFieldValue,
  PullRemoteSource
} from './sync-diff';

const FIELD = {
  Title: 'title',
  Body: 'body',
  Slug: 'slug',
  Excerpt: 'excerpt',
  Status: 'status',
  CommentStatus: 'commentStatus',
  Categories: 'categories',
  Tags: 'tags',
  FeaturedMedia: 'featuredMedia',
  FocusKeyword: 'focusKeyword',
  MetaDescription: 'metaDescription',
  SecondaryTitle: 'secondaryTitle'
} as const;

export const SYNC_FIELD_ORDER: PullField[] = [
  FIELD.Title,
  FIELD.SecondaryTitle,
  FIELD.Body,
  FIELD.Slug,
  FIELD.Excerpt,
  FIELD.Status,
  FIELD.CommentStatus,
  FIELD.Categories,
  FIELD.Tags,
  FIELD.FeaturedMedia,
  FIELD.FocusKeyword,
  FIELD.MetaDescription
];

export const SYNC_BASELINE_SCHEMA_VERSION = 1;
export const SYNC_CONVERTER_VERSION = 'wordpress-markdown-v1';
export const DEFAULT_SYNC_BASELINE_LIMITS = {
  maxEntries: 100,
  maxBytes: 16 * 1024 * 1024
} as const;

export const SyncState = {
  InSync: 'in-sync',
  LocalOnly: 'local-only',
  RemoteOnly: 'remote-only',
  Diverged: 'diverged',
  Unknown: 'unknown',
  RemoteMissing: 'remote-missing'
} as const;

export type SyncState = typeof SyncState[keyof typeof SyncState];

export interface SyncFieldSnapshot {
  present: boolean;
  value: PullFieldValue;
}

export interface SyncDocument {
  fields: Partial<Record<PullField, SyncFieldSnapshot>>;
}

export interface SyncFieldBase {
  local: SyncFieldSnapshot;
  remote: SyncFieldSnapshot;
  localHash: string;
  remoteHash: string;
}

export interface SyncBaseline {
  schemaVersion: number;
  converterVersion: string;
  notePath: string;
  profileId: string;
  profileName: string;
  profileEndpoint: string;
  postId: string;
  postType: string;
  fields: Partial<Record<PullField, SyncFieldBase>>;
  localHash: string;
  remoteHash: string;
  remoteModifiedAt?: string;
  lastAgreedAt: string;
  lastUsedAt: string;
  lastObservedState?: SyncState;
  lastObservedAt?: string;
}

export interface SyncBaselineCache {
  entries: SyncBaseline[];
}

export interface SyncStateResult {
  state: SyncState;
  localChangedFields: PullField[];
  remoteChangedFields: PullField[];
  remoteMarkerChanged: boolean;
}

export interface SyncBaselineIdentity {
  notePath: string;
  profileId: string;
  profileName: string;
  profileEndpoint: string;
  postId: string | number;
  postType: string;
}

export interface SyncBaselineLimits {
  maxEntries: number;
  maxBytes: number;
}

const syncStates = new Set<string>(Object.values(SyncState));

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isListField(field: PullField): boolean {
  return field === FIELD.Categories || field === FIELD.Tags;
}

function defaultValue(field: PullField): PullFieldValue {
  return isListField(field) ? [] : '';
}

function cloneValue(value: PullFieldValue): PullFieldValue {
  return Array.isArray(value) ? [ ...value ] : value;
}

function uniqueFields(fields: readonly PullField[]): PullField[] {
  const requested = new Set(fields);
  return SYNC_FIELD_ORDER.filter(field => requested.has(field));
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [ value ];
  return [ ...new Set(values
    .flatMap(item => typeof item === 'string' ? item.split(/[,，]/u) : [])
    .map(item => item.trim())
    .filter(Boolean)) ];
}

function textSnapshot(
  matter: MatterData,
  keys: readonly string[]
): SyncFieldSnapshot {
  for (const key of keys) {
    if (hasOwn(matter, key) && typeof matter[key] === 'string') {
      return { present: true, value: matter[key] as string };
    }
  }
  return { present: false, value: '' };
}

function featuredImageSnapshot(matter: MatterData): SyncFieldSnapshot {
  if (!hasOwn(matter, 'featuredImage')) {
    return { present: false, value: '' };
  }
  const value = matter.featuredImage;
  return typeof value === 'string'
    ? { present: true, value }
    : typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? { present: true, value: String(value) }
      : { present: false, value: '' };
}

function focusKeywordSnapshot(matter: MatterData): SyncFieldSnapshot {
  const key = hasOwn(matter, 'focusKeyword')
    ? 'focusKeyword'
    : hasOwn(matter, 'focus_keyword')
      ? 'focus_keyword'
      : undefined;
  if (!key) return { present: false, value: '' };
  const value = matter[key];
  if (typeof value === 'string') return { present: true, value };
  if (Array.isArray(value)) {
    return {
      present: true,
      value: value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
        .join(', ')
    };
  }
  return { present: false, value: '' };
}

function listSnapshot(matter: MatterData, key: string): SyncFieldSnapshot {
  return hasOwn(matter, key)
    ? { present: true, value: stringList(matter[key]) }
    : { present: false, value: [] };
}

function splitNoteBody(raw: string): string {
  const start = raw.startsWith('\uFEFF') ? 1 : 0;
  const firstBreak = raw.indexOf('\n', start);
  if (firstBreak === -1
    || raw.slice(start, firstBreak).replace(/\r$/, '').trim() !== '---') {
    return raw.slice(start);
  }
  let cursor = firstBreak + 1;
  while (cursor <= raw.length) {
    const nextBreak = raw.indexOf('\n', cursor);
    const lineEnd = nextBreak === -1 ? raw.length : nextBreak;
    const line = raw.slice(cursor, lineEnd).replace(/\r$/, '').trim();
    if (line === '---' || line === '...') {
      return raw.slice(nextBreak === -1 ? raw.length : nextBreak + 1);
    }
    if (nextBreak === -1) {
      break;
    }
    cursor = nextBreak + 1;
  }
  return raw.slice(start);
}

export function createLocalSyncDocument(options: {
  noteRaw: string;
  /** Use when the caller already holds the body without front matter. */
  body?: string;
  matter: MatterData;
  fallbackTitle: string;
  fields?: readonly PullField[];
}): SyncDocument {
  const requested = uniqueFields(options.fields ?? SYNC_FIELD_ORDER);
  const document: SyncDocument = { fields: {} };
  requested.forEach(field => {
    switch (field) {
      case FIELD.Title:
        document.fields[field] = {
          present: true,
          value: typeof options.matter.title === 'string'
            ? options.matter.title
            : options.fallbackTitle
        };
        break;
      case FIELD.Body:
        document.fields[field] = {
          present: true,
          value: options.body ?? splitNoteBody(options.noteRaw)
        };
        break;
      case FIELD.Slug:
        document.fields[field] = textSnapshot(options.matter, [ 'slug' ]);
        break;
      case FIELD.Excerpt:
        document.fields[field] = textSnapshot(options.matter, [ 'excerpt' ]);
        break;
      case FIELD.Status:
        document.fields[field] = textSnapshot(options.matter, [ 'status' ]);
        break;
      case FIELD.CommentStatus:
        document.fields[field] = textSnapshot(
          options.matter,
          [ 'commentStatus', 'comment_status' ]
        );
        break;
      case FIELD.Categories:
        document.fields[field] = listSnapshot(options.matter, 'categories');
        break;
      case FIELD.Tags:
        document.fields[field] = listSnapshot(options.matter, 'tags');
        break;
      case FIELD.FeaturedMedia:
        document.fields[field] = featuredImageSnapshot(options.matter);
        break;
      case FIELD.FocusKeyword:
        document.fields[field] = focusKeywordSnapshot(options.matter);
        break;
      case FIELD.MetaDescription:
        document.fields[field] = textSnapshot(
          options.matter,
          [ 'metaDescription', 'meta_description' ]
        );
        break;
      case FIELD.SecondaryTitle:
        document.fields[field] = textSnapshot(
          options.matter,
          [ 'secondaryTitle', 'secondary_title' ]
        );
        break;
    }
  });
  return document;
}

function portableRemoteTerms(
  ids: readonly string[],
  taxonomy: string,
  terms: PullRemoteSource['terms'],
  preferred: 'slug' | 'name'
): string[] | undefined {
  const byId = new Map(terms
    .filter(term => term.taxonomy === taxonomy)
    .map(term => [ term.id, term ]));
  const values: string[] = [];
  for (const id of ids) {
    const term = byId.get(id);
    const value = preferred === 'slug' ? term?.slug : term?.name ?? term?.slug;
    if (!value) {
      return undefined;
    }
    if (!values.includes(value)) {
      values.push(value);
    }
  }
  return values;
}

export function createRemoteSyncDocument(options: {
  remote: PullRemoteSource;
  fields?: readonly PullField[];
}): SyncDocument {
  const requested = uniqueFields(options.fields ?? SYNC_FIELD_ORDER);
  const remote = options.remote;
  const categories = remote.capabilities.categories
    ? portableRemoteTerms(remote.categoryIds, 'category', remote.terms, 'slug')
    : undefined;
  const tags = remote.capabilities.tags
    ? portableRemoteTerms(remote.tagIds, 'post_tag', remote.terms, 'name')
    : undefined;
  const values: Partial<Record<PullField, PullFieldValue | undefined>> = {
    [FIELD.Title]: remote.title,
    [FIELD.Body]: remote.body,
    [FIELD.Slug]: remote.capabilities.slug ? remote.slug ?? '' : undefined,
    [FIELD.Excerpt]: remote.capabilities.excerpt ? remote.excerpt ?? '' : undefined,
    [FIELD.Status]: remote.capabilities.status ? remote.status ?? '' : undefined,
    [FIELD.CommentStatus]: remote.capabilities.commentStatus
      ? remote.commentStatus ?? ''
      : undefined,
    [FIELD.Categories]: categories,
    [FIELD.Tags]: tags,
    [FIELD.FeaturedMedia]: remote.capabilities.featuredMedia
      && (!remote.featuredMedia?.id || remote.featuredMedia.url)
      ? remote.featuredMedia?.url ?? ''
      : undefined,
    [FIELD.FocusKeyword]: remote.capabilities.focusKeyword
      ? remote.focusKeyword ?? ''
      : undefined,
    [FIELD.MetaDescription]: remote.capabilities.metaDescription
      ? remote.metaDescription ?? ''
      : undefined,
    [FIELD.SecondaryTitle]: remote.capabilities.secondaryTitle
      ? remote.secondaryTitle ?? ''
      : undefined
  };
  const document: SyncDocument = { fields: {} };
  requested.forEach(field => {
    const value = values[field];
    if (value !== undefined) {
      document.fields[field] = { present: true, value: cloneValue(value) };
    }
  });
  return document;
}

export function canonicalizeSyncField(
  field: PullField,
  snapshot: SyncFieldSnapshot
): SyncFieldSnapshot {
  if (!snapshot.present) {
    return { present: false, value: defaultValue(field) };
  }
  if (isListField(field)) {
    const value = Array.isArray(snapshot.value) ? snapshot.value : [ snapshot.value ];
    return {
      present: true,
      value: [ ...new Set(value.map(item => String(item).trim()).filter(Boolean)) ].sort()
    };
  }
  let value = Array.isArray(snapshot.value)
    ? snapshot.value.join(',')
    : String(snapshot.value);
  value = value.replace(/\r\n?/g, '\n');
  if (field === FIELD.Body && value.endsWith('\n')) {
    value = value.slice(0, -1);
  }
  return { present: true, value };
}

function hashText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return (first >>> 0).toString(16).padStart(8, '0')
    + (second >>> 0).toString(16).padStart(8, '0');
}

export function hashSyncField(
  field: PullField,
  snapshot: SyncFieldSnapshot
): string {
  const canonical = canonicalizeSyncField(field, snapshot);
  return hashText(JSON.stringify([ canonical.present, canonical.value ]));
}

function aggregateHash(
  fields: Partial<Record<PullField, SyncFieldBase>>,
  side: 'localHash' | 'remoteHash'
): string {
  return hashText(SYNC_FIELD_ORDER
    .filter(field => fields[field])
    .map(field => field + ':' + fields[field]![side])
    .join('|'));
}

export function getSyncBaseline(
  cache: SyncBaselineCache,
  notePath: string,
  profileId: string
): SyncBaseline | undefined {
  return cache.entries.find(entry => (
    entry.notePath === notePath && entry.profileId === profileId
  ));
}

export function createOrUpdateSyncBaseline(options: {
  existing?: SyncBaseline;
  identity: SyncBaselineIdentity;
  local: SyncDocument;
  remote: SyncDocument;
  fields: readonly PullField[];
  remoteModifiedAt?: string;
  now?: string;
  converterVersion?: string;
}): SyncBaseline {
  const converterVersion = options.converterVersion ?? SYNC_CONVERTER_VERSION;
  const postId = String(options.identity.postId);
  const canPreserve = options.existing
    && options.existing.converterVersion === converterVersion
    && options.existing.profileEndpoint === options.identity.profileEndpoint
    && options.existing.postId === postId
    && options.existing.postType === options.identity.postType;
  const fields: Partial<Record<PullField, SyncFieldBase>> = canPreserve
    ? { ...options.existing!.fields }
    : {};
  const updated: PullField[] = [];
  uniqueFields(options.fields).forEach(field => {
    const local = options.local.fields[field];
    const remote = options.remote.fields[field];
    if (!local || !remote) {
      return;
    }
    const canonicalLocal = canonicalizeSyncField(field, local);
    const canonicalRemote = canonicalizeSyncField(field, remote);
    fields[field] = {
      local: canonicalLocal,
      remote: canonicalRemote,
      localHash: hashSyncField(field, canonicalLocal),
      remoteHash: hashSyncField(field, canonicalRemote)
    };
    updated.push(field);
  });
  if (updated.length === 0) {
    throw new Error('Cannot create a sync baseline without comparable fields.');
  }
  const now = options.now ?? new Date().toISOString();
  const allFieldsUpdated = SYNC_FIELD_ORDER
    .filter(field => fields[field])
    .every(field => updated.includes(field));
  return {
    schemaVersion: SYNC_BASELINE_SCHEMA_VERSION,
    converterVersion,
    notePath: options.identity.notePath,
    profileId: options.identity.profileId,
    profileName: options.identity.profileName,
    profileEndpoint: options.identity.profileEndpoint,
    postId,
    postType: options.identity.postType,
    fields,
    localHash: aggregateHash(fields, 'localHash'),
    remoteHash: aggregateHash(fields, 'remoteHash'),
    ...(options.remoteModifiedAt ? { remoteModifiedAt: options.remoteModifiedAt } : {}),
    lastAgreedAt: now,
    lastUsedAt: now,
    lastObservedState: allFieldsUpdated ? SyncState.InSync : SyncState.Unknown,
    lastObservedAt: now
  };
}

export function classifySyncState(options: {
  baseline?: SyncBaseline;
  local?: SyncDocument;
  remote?: SyncDocument;
  remoteMissing?: boolean;
  remoteModifiedAt?: string;
  converterVersion?: string;
}): SyncStateResult {
  if (options.remoteMissing) {
    return {
      state: SyncState.RemoteMissing,
      localChangedFields: [],
      remoteChangedFields: [],
      remoteMarkerChanged: false
    };
  }
  const baseline = options.baseline;
  if (!baseline || !options.local || !options.remote
    || baseline.converterVersion !== (options.converterVersion ?? SYNC_CONVERTER_VERSION)
  ) {
    return {
      state: SyncState.Unknown,
      localChangedFields: [],
      remoteChangedFields: [],
      remoteMarkerChanged: false
    };
  }
  const baselineFields = SYNC_FIELD_ORDER.filter(field => baseline.fields[field]);
  if (baselineFields.length === 0 || baselineFields.some(field => (
    !options.local!.fields[field] || !options.remote!.fields[field]
  ))) {
    return {
      state: SyncState.Unknown,
      localChangedFields: [],
      remoteChangedFields: [],
      remoteMarkerChanged: false
    };
  }
  const localChangedFields = baselineFields.filter(field => (
    hashSyncField(field, options.local!.fields[field]!)
      !== baseline.fields[field]!.localHash
  ));
  const remoteChangedFields = baselineFields.filter(field => (
    hashSyncField(field, options.remote!.fields[field]!)
      !== baseline.fields[field]!.remoteHash
  ));
  let state: SyncState;
  if (localChangedFields.length > 0 && remoteChangedFields.length > 0) {
    state = SyncState.Diverged;
  } else if (localChangedFields.length > 0) {
    state = SyncState.LocalOnly;
  } else if (remoteChangedFields.length > 0) {
    state = SyncState.RemoteOnly;
  } else {
    state = SyncState.InSync;
  }
  return {
    state,
    localChangedFields,
    remoteChangedFields,
    remoteMarkerChanged: Boolean(
      baseline.remoteModifiedAt
      && options.remoteModifiedAt
      && baseline.remoteModifiedAt !== options.remoteModifiedAt
    )
  };
}

function cacheBytes(cache: SyncBaselineCache): number {
  return new TextEncoder().encode(JSON.stringify(cache)).byteLength;
}

export function upsertSyncBaseline(
  cache: SyncBaselineCache,
  baseline: SyncBaseline,
  limits: SyncBaselineLimits = DEFAULT_SYNC_BASELINE_LIMITS
): { cache: SyncBaselineCache, evicted: SyncBaseline[] } {
  if (limits.maxEntries < 1 || limits.maxBytes < 1) {
    throw new Error('Sync baseline cache limits must be positive.');
  }
  const entries = cache.entries.filter(entry => !(
    entry.notePath === baseline.notePath && entry.profileId === baseline.profileId
  ));
  entries.push(baseline);
  const evicted: SyncBaseline[] = [];
  while (entries.length > limits.maxEntries || cacheBytes({ entries }) > limits.maxBytes) {
    const removable = entries
      .filter(entry => entry !== baseline)
      .sort((left, right) => left.lastUsedAt.localeCompare(right.lastUsedAt))[0];
    if (!removable) {
      throw new Error('Sync baseline exceeds the configured cache size.');
    }
    entries.splice(entries.indexOf(removable), 1);
    evicted.push(removable);
  }
  return { cache: { entries }, evicted };
}

export function observeSyncBaseline(
  cache: SyncBaselineCache,
  notePath: string,
  profileId: string,
  state: SyncState,
  now = new Date().toISOString()
): SyncBaselineCache {
  const baseline = getSyncBaseline(cache, notePath, profileId);
  if (!baseline) {
    return cache;
  }
  return upsertSyncBaseline(cache, {
    ...baseline,
    lastUsedAt: now,
    lastObservedState: state,
    lastObservedAt: now
  }).cache;
}

export function moveSyncBaselinesForNote(
  cache: SyncBaselineCache,
  oldPath: string,
  newPath: string
): SyncBaselineCache {
  const movedProfiles = new Set(cache.entries
    .filter(entry => entry.notePath === oldPath)
    .map(entry => entry.profileId));
  return {
    entries: cache.entries
      .filter(entry => !(entry.notePath === newPath && movedProfiles.has(entry.profileId)))
      .map(entry => entry.notePath === oldPath ? { ...entry, notePath: newPath } : entry)
  };
}

export function removeProfileSyncBaselines(
  cache: SyncBaselineCache,
  profileId: string
): SyncBaselineCache {
  return { entries: cache.entries.filter(entry => entry.profileId !== profileId) };
}

export function reconcileSyncBaselineProfiles(
  cache: SyncBaselineCache,
  profiles: readonly { id: string, name: string, endpoint: string }[]
): SyncBaselineCache {
  const byId = new Map(profiles.map(profile => [ profile.id, profile ]));
  return {
    entries: cache.entries.flatMap(entry => {
      const profile = byId.get(entry.profileId);
      if (!profile || profile.endpoint !== entry.profileEndpoint) {
        return [];
      }
      return [ profile.name === entry.profileName
        ? entry
        : { ...entry, profileName: profile.name } ];
    })
  };
}

function parseSnapshot(field: PullField, value: unknown): SyncFieldSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<SyncFieldSnapshot>;
  if (typeof candidate.present !== 'boolean') {
    return undefined;
  }
  if (isListField(field)) {
    if (!Array.isArray(candidate.value)
      || candidate.value.some(item => typeof item !== 'string')) {
      return undefined;
    }
  } else if (typeof candidate.value !== 'string') {
    return undefined;
  }
  return canonicalizeSyncField(field, candidate as SyncFieldSnapshot);
}

function parseBaseline(value: unknown): SyncBaseline | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<SyncBaseline>;
  if (candidate.schemaVersion !== SYNC_BASELINE_SCHEMA_VERSION
    || typeof candidate.converterVersion !== 'string'
    || typeof candidate.notePath !== 'string'
    || typeof candidate.profileId !== 'string'
    || typeof candidate.profileName !== 'string'
    || typeof candidate.profileEndpoint !== 'string'
    || typeof candidate.postId !== 'string'
    || typeof candidate.postType !== 'string'
    || typeof candidate.lastAgreedAt !== 'string'
    || typeof candidate.lastUsedAt !== 'string'
    || !candidate.fields
    || typeof candidate.fields !== 'object'
  ) {
    return undefined;
  }
  const fields: Partial<Record<PullField, SyncFieldBase>> = {};
  SYNC_FIELD_ORDER.forEach(field => {
    const raw = candidate.fields![field] as Partial<SyncFieldBase> | undefined;
    const local = parseSnapshot(field, raw?.local);
    const remote = parseSnapshot(field, raw?.remote);
    if (local && remote) {
      fields[field] = {
        local,
        remote,
        localHash: hashSyncField(field, local),
        remoteHash: hashSyncField(field, remote)
      };
    }
  });
  if (!SYNC_FIELD_ORDER.some(field => fields[field])) {
    return undefined;
  }
  const lastObservedState = typeof candidate.lastObservedState === 'string'
    && syncStates.has(candidate.lastObservedState)
    ? candidate.lastObservedState as SyncState
    : undefined;
  return {
    schemaVersion: SYNC_BASELINE_SCHEMA_VERSION,
    converterVersion: candidate.converterVersion,
    notePath: candidate.notePath,
    profileId: candidate.profileId,
    profileName: candidate.profileName,
    profileEndpoint: candidate.profileEndpoint,
    postId: candidate.postId,
    postType: candidate.postType,
    fields,
    localHash: aggregateHash(fields, 'localHash'),
    remoteHash: aggregateHash(fields, 'remoteHash'),
    ...(typeof candidate.remoteModifiedAt === 'string'
      ? { remoteModifiedAt: candidate.remoteModifiedAt }
      : {}),
    lastAgreedAt: candidate.lastAgreedAt,
    lastUsedAt: candidate.lastUsedAt,
    ...(lastObservedState ? { lastObservedState } : {}),
    ...(typeof candidate.lastObservedAt === 'string'
      ? { lastObservedAt: candidate.lastObservedAt }
      : {})
  };
}

export function normalizeSyncBaselineCache(
  value: unknown,
  limits: SyncBaselineLimits = DEFAULT_SYNC_BASELINE_LIMITS
): SyncBaselineCache {
  const rawEntries = value && typeof value === 'object'
    && Array.isArray((value as Partial<SyncBaselineCache>).entries)
    ? (value as Partial<SyncBaselineCache>).entries!
    : [];
  const parsed = rawEntries
    .map(parseBaseline)
    .filter((entry): entry is SyncBaseline => Boolean(entry))
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  const deduplicated: SyncBaseline[] = [];
  parsed.forEach(entry => {
    if (!getSyncBaseline({ entries: deduplicated }, entry.notePath, entry.profileId)) {
      deduplicated.push(entry);
    }
  });
  let cache: SyncBaselineCache = { entries: [] };
  deduplicated.reverse().forEach(entry => {
    try {
      cache = upsertSyncBaseline(cache, entry, limits).cache;
    } catch {
      // An oversized or malformed legacy entry is safest to discard.
    }
  });
  return cache;
}
