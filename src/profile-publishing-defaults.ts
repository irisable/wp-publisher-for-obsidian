import type { CommentStatus, PostStatus, PostType } from './wp-api';
import { readWordPressTagsFrontMatter } from './front-matter';

function normalizeDefaultTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [ value ];
  const tags = values
    .flatMap(item => typeof item === 'string' ? item.split(/[,，]/u) : [])
    .map(tag => tag.trim())
    .filter(Boolean);
  return [ ...new Set(tags) ];
}

export interface ProfilePublishingDefaults {
  status?: PostStatus;
  commentStatus?: CommentStatus;
  postType?: PostType;
  tags?: string[];
}

export interface ResolvedProfilePublishingDefaults {
  status: PostStatus;
  commentStatus: CommentStatus;
  postType: PostType;
  tags: string[];
}

export function resolveProfilePublishingDefaults(
  profile: { publishDefaults?: ProfilePublishingDefaults },
  globalDefaults: {
    status: PostStatus;
    commentStatus: CommentStatus;
  }
): ResolvedProfilePublishingDefaults {
  const postType = profile.publishDefaults?.postType?.trim();
  return {
    status: profile.publishDefaults?.status ?? globalDefaults.status,
    commentStatus: profile.publishDefaults?.commentStatus
      ?? globalDefaults.commentStatus,
    postType: postType || 'post',
    tags: normalizeDefaultTags(profile.publishDefaults?.tags)
  };
}

export function resolvePublishingTags(
  matter: Record<string, unknown>,
  profileTags: readonly string[]
): string[] {
  const noteTags = readWordPressTagsFrontMatter(matter);
  return noteTags.present
    ? noteTags.tags
    : normalizeDefaultTags(profileTags);
}

export function selectAvailablePostType(
  preferred: PostType,
  available: readonly PostType[]
): PostType {
  if (available.includes(preferred)) {
    return preferred;
  }
  if (available.includes('post')) {
    return 'post';
  }
  return available[0] ?? 'post';
}
