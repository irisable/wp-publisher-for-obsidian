export const PublishTargetMode = {
  Create: 'create',
  Update: 'update',
  ProfileMismatch: 'profile-mismatch',
  MissingProfile: 'missing-profile',
  InvalidPostId: 'invalid-post-id'
} as const;

export type PublishTargetMode = typeof PublishTargetMode[keyof typeof PublishTargetMode];

export interface PublishTargetMetadata {
  profileName?: unknown;
  postId?: unknown;
}

export interface PublishTarget {
  mode: PublishTargetMode;
  selectedProfileName: string;
  storedProfileName?: string;
  postId?: string;
  rawPostId?: string;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizePostId(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  const normalized = normalizeText(value);
  return normalized && /^[1-9]\d*$/.test(normalized) ? normalized : undefined;
}

/** Decide whether publishing creates or updates without mutating note metadata. */
export function determinePublishTarget(
  metadata: PublishTargetMetadata,
  selectedProfileName: string
): PublishTarget {
  const selectedProfile = selectedProfileName.trim();
  const rawPostId = metadata.postId === undefined || metadata.postId === null
    ? undefined
    : String(metadata.postId).trim();

  if (!rawPostId) {
    return {
      mode: PublishTargetMode.Create,
      selectedProfileName: selectedProfile
    };
  }

  const postId = normalizePostId(metadata.postId);
  if (!postId) {
    return {
      mode: PublishTargetMode.InvalidPostId,
      selectedProfileName: selectedProfile,
      rawPostId
    };
  }

  const storedProfileName = normalizeText(metadata.profileName);
  if (!storedProfileName) {
    return {
      mode: PublishTargetMode.MissingProfile,
      selectedProfileName: selectedProfile,
      postId
    };
  }

  if (storedProfileName !== selectedProfile) {
    return {
      mode: PublishTargetMode.ProfileMismatch,
      selectedProfileName: selectedProfile,
      storedProfileName,
      postId
    };
  }

  return {
    mode: PublishTargetMode.Update,
    selectedProfileName: selectedProfile,
    storedProfileName,
    postId
  };
}
