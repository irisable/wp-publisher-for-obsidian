export const MULTI_SITE_NOTE_LIMIT = 500;

export interface MultiSiteTarget {
  profileId: string;
  profileName: string;
  endpoint: string;
  postId: string;
  postType: string;
  updatedAt: string;
}

export type MultiSiteTargetStore = Record<string, Record<string, MultiSiteTarget>>;

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim() || undefined;
}

function postId(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  const normalized = text(value);
  return normalized && /^[1-9]\d*$/.test(normalized) ? normalized : undefined;
}

function timestamp(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized && !Number.isNaN(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : undefined;
}

function normalizeTarget(value: unknown): MultiSiteTarget | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const normalized = {
    profileId: text(item.profileId),
    profileName: text(item.profileName),
    endpoint: text(item.endpoint),
    postId: postId(item.postId),
    postType: text(item.postType),
    updatedAt: timestamp(item.updatedAt)
  };
  if (Object.values(normalized).some(item => !item)) {
    return undefined;
  }
  return normalized as MultiSiteTarget;
}

function safeKey(value: string): boolean {
  return value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

export function normalizeMultiSiteTargets(value: unknown): MultiSiteTargetStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const notes = Object.entries(value as Record<string, unknown>)
    .flatMap(([notePath, profileValues]) => {
      if (!text(notePath) || !safeKey(notePath)
        || !profileValues || typeof profileValues !== 'object'
        || Array.isArray(profileValues)
      ) {
        return [];
      }
      const targets: Record<string, MultiSiteTarget> = {};
      Object.values(profileValues as Record<string, unknown>).forEach(rawTarget => {
        const target = normalizeTarget(rawTarget);
        if (target && safeKey(target.profileId)) {
          const existing = targets[target.profileId];
          if (!existing || existing.updatedAt < target.updatedAt) {
            targets[target.profileId] = target;
          }
        }
      });
      const values = Object.values(targets);
      if (values.length === 0) {
        return [];
      }
      return [ {
        notePath,
        targets,
        latest: values.reduce((latest, target) =>
          target.updatedAt > latest ? target.updatedAt : latest, '')
      } ];
    })
    .sort((left, right) => right.latest.localeCompare(left.latest))
    .slice(0, MULTI_SITE_NOTE_LIMIT);

  return Object.fromEntries(notes.map(note => [ note.notePath, note.targets ]));
}

export function findMultiSiteTarget(
  store: MultiSiteTargetStore,
  notePath: string,
  profileId: string
): MultiSiteTarget | undefined {
  return normalizeTarget(store[notePath]?.[profileId]);
}

export function rememberMultiSiteTarget(
  store: MultiSiteTargetStore,
  notePath: string,
  target: MultiSiteTarget
): MultiSiteTargetStore {
  const normalizedTarget = normalizeTarget(target);
  if (!text(notePath) || !normalizedTarget) {
    return normalizeMultiSiteTargets(store);
  }
  return normalizeMultiSiteTargets({
    ...store,
    [notePath]: {
      ...store[notePath],
      [normalizedTarget.profileId]: normalizedTarget
    }
  });
}

export function moveMultiSiteNoteTargets(
  store: MultiSiteTargetStore,
  oldPath: string,
  newPath: string
): MultiSiteTargetStore {
  if (oldPath === newPath || !store[oldPath]) {
    return store;
  }
  const next = { ...store };
  const merged = { ...next[newPath] };
  Object.entries(next[oldPath]).forEach(([profileId, target]) => {
    const existing = merged[profileId];
    if (!existing || existing.updatedAt < target.updatedAt) {
      merged[profileId] = target;
    }
  });
  delete next[oldPath];
  next[newPath] = merged;
  return normalizeMultiSiteTargets(next);
}

export function forgetProfileMultiSiteTargets(
  store: MultiSiteTargetStore,
  profileId: string
): MultiSiteTargetStore {
  const next: MultiSiteTargetStore = {};
  Object.entries(store).forEach(([notePath, targets]) => {
    const remaining = Object.fromEntries(
      Object.entries(targets).filter(([id]) => id !== profileId)
    );
    if (Object.keys(remaining).length > 0) {
      next[notePath] = remaining;
    }
  });
  return normalizeMultiSiteTargets(next);
}
