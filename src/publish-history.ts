import type { WordPressPostParams } from './wp-client';

export const PUBLISH_HISTORY_LIMIT = 100;

export const PublishHistoryAction = {
  Create: 'create',
  FullUpdate: 'full-update',
  ContentOnly: 'content-only',
  Pull: 'pull',
  Merge: 'merge'
} as const;

export type PublishHistoryAction = typeof PublishHistoryAction[
  keyof typeof PublishHistoryAction
];

export const PublishHistoryOutcome = {
  Success: 'success',
  Failure: 'failure'
} as const;

export type PublishHistoryOutcome = typeof PublishHistoryOutcome[
  keyof typeof PublishHistoryOutcome
];

export interface PublishHistoryEntry {
  id: string;
  timestamp: string;
  outcome: PublishHistoryOutcome;
  action: PublishHistoryAction;
  notePath: string;
  noteTitle: string;
  profileName: string;
  profileId?: string;
  endpoint: string;
  postType: string;
  postId?: string;
  message?: string;
  warningCount?: number;
  selectedFieldCount?: number;
}

export interface PublishHistoryEntryInput extends Omit<PublishHistoryEntry, 'id' | 'timestamp'> {
  id?: string;
  timestamp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function validTimestamp(value: unknown): string | undefined {
  const timestamp = optionalText(value, 64);
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : undefined;
}

function padTimestampPart(value: number): string {
  return String(value).padStart(2, '0');
}

/** Format a readable ISO timestamp while preserving the local UTC offset. */
export function formatLocalPublishTimestamp(
  date: Date,
  utcOffsetMinutes = -date.getTimezoneOffset()
): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid publish timestamp');
  }
  const offset = Math.max(-14 * 60, Math.min(14 * 60, Math.trunc(utcOffsetMinutes)));
  const localClock = new Date(date.getTime() + offset * 60_000);
  const sign = offset >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offset);
  return localClock.getUTCFullYear()
    + '-' + padTimestampPart(localClock.getUTCMonth() + 1)
    + '-' + padTimestampPart(localClock.getUTCDate())
    + 'T' + padTimestampPart(localClock.getUTCHours())
    + ':' + padTimestampPart(localClock.getUTCMinutes())
    + ':' + padTimestampPart(localClock.getUTCSeconds())
    + sign + padTimestampPart(Math.floor(absoluteOffset / 60))
    + ':' + padTimestampPart(absoluteOffset % 60);
}

export function normalizePublishHistoryAction(
  value: unknown
): PublishHistoryAction | undefined {
  return Object.values(PublishHistoryAction).includes(value as PublishHistoryAction)
    ? value as PublishHistoryAction
    : undefined;
}

function normalizeOutcome(value: unknown): PublishHistoryOutcome | undefined {
  return Object.values(PublishHistoryOutcome).includes(value as PublishHistoryOutcome)
    ? value as PublishHistoryOutcome
    : undefined;
}

function normalizePostId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const postId = optionalText(value, 64);
  return postId && /^[1-9]\d*$/.test(postId) ? postId : undefined;
}

function fallbackTitle(notePath: string): string {
  const fileName = notePath.split('/').pop() ?? notePath;
  return fileName.replace(/\.md$/i, '') || notePath;
}

function normalizeEntry(value: unknown): PublishHistoryEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = optionalText(value.id, 160);
  const timestamp = validTimestamp(value.timestamp);
  const outcome = normalizeOutcome(value.outcome);
  const action = normalizePublishHistoryAction(value.action);
  const notePath = optionalText(value.notePath, 1000);
  const profileName = optionalText(value.profileName, 200);
  const profileId = optionalText(value.profileId, 200);
  const endpoint = optionalText(value.endpoint, 1000);
  const postType = optionalText(value.postType, 100);
  if (!id || !timestamp || !outcome || !action || !notePath
    || !profileName || !endpoint || !postType
  ) {
    return undefined;
  }
  const noteTitle = optionalText(value.noteTitle, 500) ?? fallbackTitle(notePath);
  const postId = normalizePostId(value.postId);
  const message = optionalText(value.message);
  const warningCount = typeof value.warningCount === 'number'
    && Number.isSafeInteger(value.warningCount)
    && value.warningCount > 0
    ? value.warningCount
    : undefined;
  const selectedFieldCount = typeof value.selectedFieldCount === 'number'
    && Number.isSafeInteger(value.selectedFieldCount)
    && value.selectedFieldCount >= 0
    ? value.selectedFieldCount
    : undefined;
  return {
    id,
    timestamp,
    outcome,
    action,
    notePath,
    noteTitle,
    profileName,
    ...(profileId ? { profileId } : {}),
    endpoint,
    postType,
    ...(postId ? { postId } : {}),
    ...(message ? { message } : {}),
    ...(warningCount ? { warningCount } : {}),
    ...(selectedFieldCount !== undefined ? { selectedFieldCount } : {})
  };
}

export function normalizePublishHistory(value: unknown): PublishHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries = value
    .map(normalizeEntry)
    .filter((entry): entry is PublishHistoryEntry => entry !== undefined)
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  }).slice(0, PUBLISH_HISTORY_LIMIT);
}

export function createPublishHistoryEntry(
  input: PublishHistoryEntryInput
): PublishHistoryEntry {
  const timestamp = validTimestamp(input.timestamp) ?? new Date().toISOString();
  const id = optionalText(input.id, 160)
    ?? timestamp + '-' + Math.random().toString(36).slice(2, 10);
  const entry = normalizeEntry({ ...input, id, timestamp });
  if (!entry) {
    throw new Error('Invalid publish history entry');
  }
  return entry;
}

export function addPublishHistoryEntry(
  history: unknown,
  entry: PublishHistoryEntry
): PublishHistoryEntry[] {
  return normalizePublishHistory([ entry, ...normalizePublishHistory(history) ]);
}

export function filterPublishHistory(
  history: readonly PublishHistoryEntry[],
  query: string
): PublishHistoryEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [ ...history ];
  }
  return history.filter(entry => [
    entry.noteTitle,
    entry.notePath,
    entry.profileName,
    entry.profileId,
    entry.endpoint,
    entry.postId,
    entry.postType,
    entry.action,
    entry.outcome,
    entry.message
  ].some(value => value?.toLocaleLowerCase().includes(normalizedQuery)));
}

export function resolvePublishHistoryAction(
  params: Pick<WordPressPostParams, 'postId' | 'updateStrategy'>
): PublishHistoryAction {
  if (!params.postId) {
    return PublishHistoryAction.Create;
  }
  return params.updateStrategy === 'content-only'
    ? PublishHistoryAction.ContentOnly
    : PublishHistoryAction.FullUpdate;
}
