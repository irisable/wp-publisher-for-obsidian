import type { WordPressPostParams } from './wp-client';
import type { PullField } from './sync-diff';

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
  MetaDescription: 'metaDescription'
} as const;

const PAGE_POST_TYPE = 'page';
const FUTURE_POST_STATUS = 'future';

export const PublishUpdateStrategy = {
  Full: 'full',
  ContentOnly: 'content-only',
  Merge: 'merge'
} as const;

export type PublishUpdateStrategy = typeof PublishUpdateStrategy[
  keyof typeof PublishUpdateStrategy
];

export function isContentOnlyUpdate(
  params: Pick<WordPressPostParams, 'postId' | 'updateStrategy'>
): boolean {
  return Boolean(params.postId)
    && params.updateStrategy === PublishUpdateStrategy.ContentOnly;
}

export function isMergeUpdate(
  params: Pick<WordPressPostParams, 'postId' | 'updateStrategy'>
): boolean {
  return Boolean(params.postId)
    && params.updateStrategy === PublishUpdateStrategy.Merge;
}

function mergeFields(postParams: WordPressPostParams): ReadonlySet<PullField> {
  return new Set(postParams.updateFields ?? []);
}

function buildRestMergePayload(options: {
  title: string;
  content: string;
  postParams: WordPressPostParams;
  editorialMetadata: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const { title, content, postParams, editorialMetadata } = options;
  const fields = mergeFields(postParams);
  const payload: Record<string, unknown> = {};
  if (fields.has(FIELD.Title)) payload.title = title;
  if (fields.has(FIELD.Body)) payload.content = content;
  if (fields.has(FIELD.Slug)) payload.slug = postParams.slug ?? '';
  if (fields.has(FIELD.Excerpt)) payload.excerpt = postParams.excerpt ?? '';
  if (fields.has(FIELD.Status)) payload.status = postParams.status;
  if (fields.has(FIELD.CommentStatus)) {
    payload.comment_status = postParams.commentStatus;
  }
  if (fields.has(FIELD.Categories)) payload.categories = postParams.categories;
  if (fields.has(FIELD.Tags)) payload.tags = postParams.tags ?? [];
  if (fields.has(FIELD.FeaturedMedia)) {
    const key = Object.prototype.hasOwnProperty.call(editorialMetadata, 'featured_image')
      ? 'featured_image'
      : 'featured_media';
    payload[key] = editorialMetadata[key] ?? 0;
  }
  const seoKeys = new Set([
    ...(fields.has(FIELD.FocusKeyword) ? [ 'rank_math_focus_keyword' ] : []),
    ...(fields.has(FIELD.MetaDescription) ? [ 'rank_math_description' ] : [])
  ]);
  const meta = editorialMetadata.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const filtered = Object.fromEntries(
      Object.entries(meta).filter(([ key ]) => seoKeys.has(key))
    );
    if (Object.keys(filtered).length > 0) payload.meta = filtered;
  }
  if (Array.isArray(editorialMetadata.metadata)) {
    const filtered = editorialMetadata.metadata.filter(item => (
      item && typeof item === 'object'
      && seoKeys.has(String((item as { key?: unknown }).key ?? ''))
    ));
    if (filtered.length > 0) payload.metadata = filtered;
  }
  return payload;
}

export function buildRestPublishPayload(options: {
  title: string;
  content: string;
  postParams: WordPressPostParams;
  editorialMetadata: Readonly<Record<string, unknown>>;
  scheduledDate?: string;
}): Record<string, unknown> {
  const { title, content, postParams, editorialMetadata, scheduledDate } = options;
  if (isContentOnlyUpdate(postParams)) {
    return { content };
  }
  if (isMergeUpdate(postParams)) {
    return buildRestMergePayload({
      title,
      content,
      postParams,
      editorialMetadata
    });
  }
  return {
    title,
    content,
    status: postParams.status,
    comment_status: postParams.commentStatus,
    categories: postParams.categories,
    tags: postParams.tags ?? [],
    ...editorialMetadata,
    ...(scheduledDate ? { date: scheduledDate } : {})
  };
}

function buildXmlRpcMergePayload(options: {
  title: string;
  content: string;
  postParams: WordPressPostParams;
}): Record<string, unknown> {
  const { title, content, postParams } = options;
  const fields = mergeFields(postParams);
  const payload: Record<string, unknown> = {};
  if (fields.has(FIELD.Title)) payload.post_title = title;
  if (fields.has(FIELD.Body)) payload.post_content = content;
  if (fields.has(FIELD.Slug)) payload.post_name = postParams.slug ?? '';
  if (fields.has(FIELD.Excerpt)) payload.post_excerpt = postParams.excerpt ?? '';
  if (fields.has(FIELD.Status)) payload.post_status = postParams.status;
  if (fields.has(FIELD.CommentStatus)) {
    payload.comment_status = postParams.commentStatus;
  }
  if (fields.has(FIELD.FeaturedMedia)) {
    payload.post_thumbnail = postParams.featuredMediaId ?? 0;
  }
  if (postParams.postType !== PAGE_POST_TYPE) {
    if (fields.has(FIELD.Categories)) {
      payload.terms = { category: postParams.categories };
    }
    if (fields.has(FIELD.Tags)) {
      payload.terms_names = { post_tag: postParams.tags };
    }
  }
  return payload;
}

export function buildXmlRpcPublishPayload(options: {
  title: string;
  content: string;
  postParams: WordPressPostParams;
  editorialMetadata: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const { title, content, postParams, editorialMetadata } = options;
  if (isContentOnlyUpdate(postParams)) {
    return { post_content: content };
  }
  if (isMergeUpdate(postParams)) {
    return buildXmlRpcMergePayload({ title, content, postParams });
  }

  const payload: Record<string, unknown> = {
    post_type: postParams.postType,
    post_status: postParams.status,
    comment_status: postParams.commentStatus,
    post_title: title,
    post_content: content,
    ...editorialMetadata
  };
  if (postParams.postType !== PAGE_POST_TYPE) {
    payload.terms = { category: postParams.categories };
    payload.terms_names = { post_tag: postParams.tags };
  }
  if (postParams.status === FUTURE_POST_STATUS) {
    payload.post_date = postParams.datetime ?? new Date();
  }
  return payload;
}
