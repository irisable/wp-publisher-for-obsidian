import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import type { PublishHistoryEntry } from './publish-history';
import {
  findMultiSiteTarget,
  type MultiSiteTarget,
  type MultiSiteTargetStore
} from './multi-site-targets';
import { readPublishFrontMatter } from './front-matter';
import { determinePublishTarget, PublishTargetMode } from './publish-target';

export interface ResolveProfileNoteTargetOptions {
  store: MultiSiteTargetStore;
  notePath: string;
  profile: Pick<WpProfile, 'id' | 'name' | 'endpoint'>;
  matter: MatterData;
  publishHistory: readonly PublishHistoryEntry[];
  defaultPostType: string;
}

function validTimestamp(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function normalizedEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** Resolve one note's target for a profile without mutating either source. */
export function resolveProfileNoteTarget(
  options: ResolveProfileNoteTargetOptions
): MultiSiteTarget | undefined {
  const { profile, notePath } = options;
  const stored = findMultiSiteTarget(options.store, notePath, profile.id);
  if (stored) {
    return stored;
  }

  const metadata = readPublishFrontMatter(options.matter);
  const legacyTarget = determinePublishTarget(metadata, profile.name);
  if (legacyTarget.mode === PublishTargetMode.Update && legacyTarget.postId) {
    return {
      profileId: profile.id,
      profileName: profile.name,
      endpoint: profile.endpoint,
      postId: legacyTarget.postId,
      postType: metadata.postType ?? options.defaultPostType,
      updatedAt: validTimestamp(metadata.lastPublishedAt)
        ?? new Date(0).toISOString()
    };
  }

  const endpoint = normalizedEndpoint(profile.endpoint);
  const historyTarget = options.publishHistory
    .filter(entry =>
      entry.outcome === 'success'
      && entry.notePath === notePath
      && entry.profileName === profile.name
      && normalizedEndpoint(entry.endpoint) === endpoint
      && entry.postId
    )
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  if (!historyTarget?.postId) {
    return undefined;
  }
  return {
    profileId: profile.id,
    profileName: profile.name,
    endpoint: profile.endpoint,
    postId: historyTarget.postId,
    postType: historyTarget.postType,
    updatedAt: historyTarget.timestamp
  };
}

export interface ResolveStableProfileNoteTargetsOptions {
  store: MultiSiteTargetStore;
  notePath: string;
  profiles: readonly Pick<
    WpProfile,
    'id' | 'name' | 'endpoint' | 'publishDefaults'
  >[];
  matter: MatterData;
}

/**
 * Resolve only explicit note/profile links. Publish history is deliberately
 * excluded because a recent successful action is not sufficient sync identity.
 */
export function resolveStableProfileNoteTargets(
  options: ResolveStableProfileNoteTargetsOptions
): MultiSiteTarget[] {
  const seenProfileIds = new Set<string>();
  return options.profiles.flatMap(profile => {
    if (!profile.id || seenProfileIds.has(profile.id)) {
      return [];
    }
    seenProfileIds.add(profile.id);
    const target = resolveProfileNoteTarget({
      store: options.store,
      notePath: options.notePath,
      profile,
      matter: options.matter,
      publishHistory: [],
      defaultPostType: profile.publishDefaults?.postType ?? 'post'
    });
    if (!target
      || target.profileId !== profile.id
      || normalizedEndpoint(target.endpoint) !== normalizedEndpoint(profile.endpoint)
    ) {
      return [];
    }
    return [ {
      ...target,
      profileName: profile.name,
      endpoint: profile.endpoint
    } ];
  });
}
