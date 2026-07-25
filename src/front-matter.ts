import type { MatterData } from './types';
import type { CommentStatus, PostStatus, PostType } from './wp-api';
import type { PublishHistoryAction } from './publish-history';

export interface PublishFrontMatterMetadata {
  profileName: string;
  postId: string;
  postType: PostType;
  categories?: readonly string[];
  lastPublishedAt?: string;
  lastPublishAction?: PublishHistoryAction;
}

export interface StoredPublishFrontMatter {
  profileName?: string;
  postId?: string;
  postType?: PostType;
  lastPublishedAt?: string;
  lastPublishAction?: PublishHistoryAction;
}

export interface EditorialFrontMatterMetadata {
  slug?: string;
  excerpt?: string;
  featuredImage?: string;
  focusKeyword?: string;
  metaDescription?: string;
  secondaryTitle?: string;
}

export interface PublishingControlFrontMatter {
  status?: PostStatus;
  commentStatus?: CommentStatus;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalScalarText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return optionalText(value);
}

function ownText(
  matter: MatterData,
  canonical: string,
  alias: string
): { present: boolean, value?: string } {
  const key = Object.prototype.hasOwnProperty.call(matter, canonical)
    ? canonical
    : Object.prototype.hasOwnProperty.call(matter, alias)
      ? alias
      : undefined;
  if (!key || typeof matter[key] !== 'string') {
    return { present: false };
  }
  return { present: true, value: matter[key].trim() };
}

function publishHistoryAction(value: unknown): PublishHistoryAction | undefined {
  return value === 'create' || value === 'full-update' || value === 'content-only'
    || value === 'merge'
    ? value
    : undefined;
}

export function fillExcerptFromMetaDescription(
  metadata: EditorialFrontMatterMetadata
): EditorialFrontMatterMetadata {
  const excerpt = optionalText(metadata.excerpt);
  const metaDescription = optionalText(metadata.metaDescription);
  const completed = { ...metadata };
  if (excerpt) {
    completed.excerpt = excerpt;
  } else if (metaDescription) {
    completed.excerpt = metaDescription;
  }
  if (metaDescription) {
    completed.metaDescription = metaDescription;
  }
  return completed;
}

export function normalizeWordPressTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [ value ];
  const tags = values
    .flatMap(item => typeof item === 'string' ? item.split(/[,，]/u) : [])
    .map(tag => tag.trim())
    .filter(Boolean);
  return [ ...new Set(tags) ];
}

export function readTagsFrontMatter(matter: MatterData): string[] {
  return normalizeWordPressTags(matter.tags);
}

function featuredImageValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return optionalText(value);
}

function focusKeywordValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return optionalText(value);
  }
  const keywords = value
    .map(optionalText)
    .filter((keyword): keyword is string => keyword !== undefined);
  return keywords.length > 0 ? keywords.join(', ') : undefined;
}

export function readPublishingControlFrontMatter(
  matter: MatterData
): PublishingControlFrontMatter {
  const status = matter.status;
  const commentStatus = matter.commentStatus ?? matter.comment_status;
  const validStatus = status === 'draft'
    || status === 'publish'
    || status === 'private'
    || status === 'future'
    ? status as PostStatus
    : undefined;
  const validCommentStatus = commentStatus === 'open' || commentStatus === 'closed'
    ? commentStatus as CommentStatus
    : undefined;
  return {
    ...(validStatus ? { status: validStatus } : {}),
    ...(validCommentStatus ? { commentStatus: validCommentStatus } : {})
  };
}

export function resolveWordPressTitle(
  matter: MatterData,
  fallbackTitle: string
): string {
  return typeof matter.title === 'string' ? matter.title : fallbackTitle;
}

/** Read canonical editorial properties without guessing from note content. */
export function readEditorialFrontMatter(
  matter: MatterData
): EditorialFrontMatterMetadata {
  const metadata: EditorialFrontMatterMetadata = {};
  const slug = optionalText(matter.slug);
  const excerpt = optionalText(matter.excerpt);
  const featuredImage = featuredImageValue(matter.featuredImage);
  const focusKeyword = focusKeywordValue(matter.focusKeyword)
    ?? focusKeywordValue(matter.focus_keyword);
  const metaDescription = optionalText(matter.metaDescription)
    ?? optionalText(matter.meta_description);
  const secondaryTitle = ownText(matter, 'secondaryTitle', 'secondary_title');

  if (slug) metadata.slug = slug;
  if (excerpt) metadata.excerpt = excerpt;
  if (featuredImage) metadata.featuredImage = featuredImage;
  if (focusKeyword) metadata.focusKeyword = focusKeyword;
  if (metaDescription) metadata.metaDescription = metaDescription;
  if (secondaryTitle.present) metadata.secondaryTitle = secondaryTitle.value ?? '';
  return metadata;
}

/** Read current keys first while remaining compatible with existing notes. */
export function readPublishFrontMatter(matter: MatterData): StoredPublishFrontMatter {
  const metadata: StoredPublishFrontMatter = {
    profileName: optionalText(matter.wpProfile) ?? optionalText(matter.profileName),
    postId: optionalScalarText(matter.wpPostId) ?? optionalScalarText(matter.postId),
    postType: optionalText(matter.wpPostType) ?? optionalText(matter.postType)
  };
  const lastPublishedAt = optionalText(matter.wpLastPublishedAt);
  const lastPublishAction = publishHistoryAction(matter.wpLastPublishAction);
  if (lastPublishedAt) metadata.lastPublishedAt = lastPublishedAt;
  if (lastPublishAction) metadata.lastPublishAction = lastPublishAction;
  return metadata;
}

/**
 * Update only metadata owned by the publishing workflow.
 * Unrelated note properties, including tags and page categories, are preserved.
 */
export function updatePublishFrontMatter(
  matter: MatterData,
  metadata: PublishFrontMatterMetadata
): void {
  matter.wpProfile = metadata.profileName;
  matter.wpPostId = metadata.postId;
  matter.wpPostType = metadata.postType;
  if (metadata.lastPublishedAt) {
    matter.wpLastPublishedAt = metadata.lastPublishedAt;
  }
  if (metadata.lastPublishAction) {
    matter.wpLastPublishAction = metadata.lastPublishAction;
  }

  if (metadata.postType === 'post' && metadata.categories) {
    matter.categories = [ ...metadata.categories ];
  }

  // These keys were owned by earlier plugin versions and are migrated on publish.
  delete matter.profileName;
  delete matter.postId;
  delete matter.postType;
}
