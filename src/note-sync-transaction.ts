export const PULL_RESTORE_LIMIT = 5;
export const PULL_RESTORE_TOTAL_BYTES = 8 * 1024 * 1024;

export const PullTransactionErrorCode = {
  StaleLocalRevision: 'stale-local-revision',
  StaleUndoRevision: 'stale-undo-revision',
  RestoreSnapshotTooLarge: 'restore-snapshot-too-large'
} as const;

export type PullTransactionErrorCode = typeof PullTransactionErrorCode[
  keyof typeof PullTransactionErrorCode
];

export class PullTransactionError extends Error {
  readonly code: PullTransactionErrorCode;

  constructor(code: PullTransactionErrorCode, message: string) {
    super(message);
    this.name = 'PullTransactionError';
    this.code = code;
  }
}

export interface PullDownloadedMedia {
  vaultPath: string;
  contentHash: string;
}

export interface PullRestoreSnapshot {
  id: string;
  createdAt: string;
  notePath: string;
  profileId: string;
  profileName: string;
  endpoint: string;
  postId: string;
  postType: string;
  beforeContent: string;
  beforeHash: string;
  appliedHash: string;
  createdMedia?: PullDownloadedMedia[];
}

export interface PullRestoreSnapshotInput extends Omit<
  PullRestoreSnapshot,
  'id' | 'createdAt' | 'beforeHash' | 'appliedHash'
> {
  id?: string;
  createdAt?: string;
  appliedContent: string;
}

export interface FrozenNoteRevision {
  content: string;
  hash: string;
}

export interface AtomicNoteStore<FileRef> {
  read(file: FileRef): Promise<string>;
  process(file: FileRef, transform: (content: string) => string): Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength = 1000): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function timestamp(value: unknown): string | undefined {
  const normalized = text(value, 64);
  return normalized && !Number.isNaN(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    ? value
    : undefined;
}

function normalizeSnapshot(value: unknown): PullRestoreSnapshot | undefined {
  if (!isRecord(value) || typeof value.beforeContent !== 'string') {
    return undefined;
  }
  const createdMedia = Array.isArray(value.createdMedia)
    ? value.createdMedia.flatMap(item => {
      if (!isRecord(item)) return [];
      const vaultPath = text(item.vaultPath);
      const contentHash = hash(item.contentHash);
      return vaultPath && contentHash ? [ { vaultPath, contentHash } ] : [];
    }).slice(0, 100)
    : [];
  const normalized = {
    id: text(value.id, 160),
    createdAt: timestamp(value.createdAt),
    notePath: text(value.notePath),
    profileId: text(value.profileId, 200),
    profileName: text(value.profileName, 200),
    endpoint: text(value.endpoint),
    postId: text(value.postId, 64),
    postType: text(value.postType, 100),
    beforeHash: hash(value.beforeHash),
    appliedHash: hash(value.appliedHash)
  };
  if (Object.values(normalized).some(item => !item)
    || !/^[1-9]\d*$/.test(normalized.postId ?? '')
  ) {
    return undefined;
  }
  return {
    ...normalized,
    beforeContent: value.beforeContent,
    ...(createdMedia.length > 0 ? { createdMedia } : {})
  } as PullRestoreSnapshot;
}

function snapshotBytes(snapshot: PullRestoreSnapshot): number {
  return new TextEncoder().encode(snapshot.beforeContent).byteLength;
}

export async function hashNoteRevision(content: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content)
  );
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function freezeNoteRevision(content: string): Promise<FrozenNoteRevision> {
  return { content, hash: await hashNoteRevision(content) };
}

export async function createPullRestoreSnapshot(
  input: PullRestoreSnapshotInput
): Promise<PullRestoreSnapshot> {
  const createdAt = timestamp(input.createdAt) ?? new Date().toISOString();
  const snapshot: PullRestoreSnapshot = {
    id: text(input.id, 160)
      ?? createdAt + '-' + Math.random().toString(36).slice(2, 10),
    createdAt,
    notePath: input.notePath,
    profileId: input.profileId,
    profileName: input.profileName,
    endpoint: input.endpoint,
    postId: input.postId,
    postType: input.postType,
    beforeContent: input.beforeContent,
    beforeHash: await hashNoteRevision(input.beforeContent),
    appliedHash: await hashNoteRevision(input.appliedContent),
    ...(input.createdMedia && input.createdMedia.length > 0
      ? { createdMedia: input.createdMedia.map(item => ({ ...item })) }
      : {})
  };
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    throw new Error('Invalid pull restore snapshot');
  }
  if (snapshotBytes(normalized) > PULL_RESTORE_TOTAL_BYTES) {
    throw new PullTransactionError(
      PullTransactionErrorCode.RestoreSnapshotTooLarge,
      'The note is too large for the bounded pull restore store.'
    );
  }
  return normalized;
}

export function normalizePullRestoreSnapshots(value: unknown): PullRestoreSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const candidates = value
    .map(normalizeSnapshot)
    .filter((item): item is PullRestoreSnapshot => item !== undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const result: PullRestoreSnapshot[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (result.length >= PULL_RESTORE_LIMIT || seen.has(candidate.id)) {
      continue;
    }
    const bytes = snapshotBytes(candidate);
    if (totalBytes + bytes > PULL_RESTORE_TOTAL_BYTES) {
      continue;
    }
    result.push(candidate);
    seen.add(candidate.id);
    totalBytes += bytes;
  }
  return result;
}

export function addPullRestoreSnapshot(
  snapshots: unknown,
  snapshot: PullRestoreSnapshot
): PullRestoreSnapshot[] {
  const next = normalizePullRestoreSnapshots([
    snapshot,
    ...normalizePullRestoreSnapshots(snapshots)
  ]);
  if (!next.some(item => item.id === snapshot.id)) {
    throw new PullTransactionError(
      PullTransactionErrorCode.RestoreSnapshotTooLarge,
      'The pull restore snapshot exceeds the bounded local store.'
    );
  }
  return next;
}

export function removePullRestoreSnapshot(
  snapshots: unknown,
  snapshotId: string
): PullRestoreSnapshot[] {
  return normalizePullRestoreSnapshots(snapshots)
    .filter(item => item.id !== snapshotId);
}

export function findLatestPullRestoreSnapshot(
  snapshots: unknown,
  notePath: string
): PullRestoreSnapshot | undefined {
  return normalizePullRestoreSnapshots(snapshots)
    .find(item => item.notePath === notePath);
}

export function movePullRestoreNotePaths(
  snapshots: unknown,
  oldPath: string,
  newPath: string
): PullRestoreSnapshot[] {
  return normalizePullRestoreSnapshots(snapshots).map(snapshot =>
    snapshot.notePath === oldPath ? { ...snapshot, notePath: newPath } : snapshot
  );
}

export async function applyGuardedNoteRevision<FileRef>(
  store: AtomicNoteStore<FileRef>,
  file: FileRef,
  frozen: FrozenNoteRevision,
  nextContent: string
): Promise<string> {
  const latest = await store.read(file);
  if (await hashNoteRevision(latest) !== frozen.hash) {
    throw new PullTransactionError(
      PullTransactionErrorCode.StaleLocalRevision,
      'The note changed after the pull preview was created.'
    );
  }
  return store.process(file, current => {
    if (current !== frozen.content) {
      throw new PullTransactionError(
        PullTransactionErrorCode.StaleLocalRevision,
        'The note changed while the pull was being applied.'
      );
    }
    return nextContent;
  });
}

export async function undoGuardedPull<FileRef>(
  store: AtomicNoteStore<FileRef>,
  file: FileRef,
  snapshot: PullRestoreSnapshot
): Promise<string> {
  const latest = await store.read(file);
  if (await hashNoteRevision(latest) !== snapshot.appliedHash) {
    throw new PullTransactionError(
      PullTransactionErrorCode.StaleUndoRevision,
      'The note changed after the pull and cannot be overwritten by Undo.'
    );
  }
  return store.process(file, current => {
    if (current !== latest) {
      throw new PullTransactionError(
        PullTransactionErrorCode.StaleUndoRevision,
        'The note changed while Undo was being applied.'
      );
    }
    return snapshot.beforeContent;
  });
}
