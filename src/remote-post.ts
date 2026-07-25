export const RemotePostSourceFormat = {
  BlockEditor: 'block-editor',
  ClassicHtml: 'classic-html',
  Empty: 'empty'
} as const;

export type RemotePostSourceFormat = typeof RemotePostSourceFormat[
  keyof typeof RemotePostSourceFormat
];

export interface RemotePostTarget {
  postId: string;
  postType: string;
}

export interface RemotePostTerm {
  id: string;
  name?: string;
  slug?: string;
  taxonomy: string;
  parentId?: string;
}

export interface RemoteFeaturedMedia {
  id?: string;
  url?: string;
  altText?: string;
  title?: string;
  caption?: string;
}

export interface RemotePostFieldCapabilities {
  slug: boolean;
  excerpt: boolean;
  status: boolean;
  commentStatus: boolean;
  publishedAt: boolean;
  modifiedAt: boolean;
  categories: boolean;
  tags: boolean;
  featuredMedia: boolean;
  focusKeyword: boolean;
  metaDescription: boolean;
  secondaryTitle: boolean;
}

export interface RemotePostDocument {
  postId: string;
  postType: string;
  title: string;
  content: string;
  sourceFormat: RemotePostSourceFormat;
  slug?: string;
  excerpt?: string;
  status?: string;
  commentStatus?: string;
  publishedAt?: string;
  modifiedAt?: string;
  link?: string;
  categoryIds: string[];
  tagIds: string[];
  terms: RemotePostTerm[];
  featuredMedia?: RemoteFeaturedMedia;
  focusKeyword?: string;
  metaDescription?: string;
  secondaryTitle?: string;
  capabilities: RemotePostFieldCapabilities;
}

export interface RemotePostSnapshot extends RemotePostDocument {
  profileId: string;
  profileName: string;
  endpoint: string;
  editUrl: string;
  fetchedAt: string;
}

export interface CoreRestPostRoute {
  namespace: string;
  restBase: string;
}

export const RemotePostErrorCode = {
  InvalidTarget: 'remote_post_invalid_target',
  IdentityMismatch: 'remote_post_identity_mismatch',
  MalformedResponse: 'remote_post_malformed_response',
  Missing: 'remote_post_missing',
  Authentication: 'remote_post_authentication_failed',
  Permission: 'remote_post_permission_denied',
  UnsupportedType: 'remote_post_type_unsupported',
  Network: 'remote_post_network_error'
} as const;

export type RemotePostErrorCode = typeof RemotePostErrorCode[
  keyof typeof RemotePostErrorCode
];

export class RemotePostError extends Error {
  readonly code: RemotePostErrorCode;

  constructor(code: RemotePostErrorCode, message: string) {
    super(message);
    this.name = 'RemotePostError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, trim = true): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const normalized = String(value);
  const result = trim ? normalized.trim() : normalized;
  return result || undefined;
}

function textAllowEmpty(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function positiveId(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized && /^[1-9]\d*$/.test(normalized) ? normalized : undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [ ...new Set(values.filter((value): value is string => Boolean(value))) ];
}

function normalizeTimestamp(value: unknown, assumeUtc = false): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const raw = text(value);
  if (!raw) {
    return undefined;
  }
  const candidate = assumeUtc
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? raw + 'Z'
    : raw;
  const timestamp = Date.parse(candidate);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function editableText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return textAllowEmpty(value.raw);
}

function renderedOrRawText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return textAllowEmpty(value.raw) ?? textAllowEmpty(value.rendered);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (!Array.isArray(value)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  value.forEach(item => {
    if (!isRecord(item)) {
      return;
    }
    const key = text(item.key);
    if (key) {
      result[key] = item.value;
    }
  });
  return result;
}

function termFromRecord(
  value: unknown,
  fallbackTaxonomy?: string
): RemotePostTerm | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = positiveId(value.id ?? value.ID ?? value.term_id);
  const taxonomy = text(value.taxonomy) ?? fallbackTaxonomy;
  if (!id || !taxonomy) {
    return undefined;
  }
  return {
    id,
    taxonomy,
    ...(text(value.name) ? { name: text(value.name) } : {}),
    ...(text(value.slug) ? { slug: text(value.slug) } : {}),
    ...(positiveId(value.parent ?? value.parent_id)
      ? { parentId: positiveId(value.parent ?? value.parent_id) }
      : {})
  };
}

function embeddedRestTerms(value: unknown): RemotePostTerm[] {
  if (!isRecord(value) || !Array.isArray(value['wp:term'])) {
    return [];
  }
  return value['wp:term']
    .flatMap(group => Array.isArray(group) ? group : [])
    .flatMap(item => {
      const term = termFromRecord(item);
      return term ? [ term ] : [];
    });
}

function objectTerms(value: unknown, taxonomy: string): RemotePostTerm[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.values(value).flatMap(item => {
    const term = termFromRecord(item, taxonomy);
    return term ? [ term ] : [];
  });
}

function arrayTerms(value: unknown): RemotePostTerm[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(item => {
    const term = termFromRecord(item);
    return term ? [ term ] : [];
  });
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(value.map(positiveId));
}

function featuredMediaFromRest(response: Record<string, unknown>): RemoteFeaturedMedia | undefined {
  const id = positiveId(response.featured_media);
  const embedded = isRecord(response._embedded)
    && Array.isArray(response._embedded['wp:featuredmedia'])
    ? response._embedded['wp:featuredmedia'][0]
    : undefined;
  if (!id && !isRecord(embedded)) {
    return undefined;
  }
  const media = isRecord(embedded) ? embedded : {};
  return {
    ...(id ?? positiveId(media.id) ? { id: id ?? positiveId(media.id) } : {}),
    ...(text(media.source_url) ? { url: text(media.source_url) } : {}),
    ...(text(media.alt_text) ? { altText: text(media.alt_text) } : {}),
    ...(renderedOrRawText(media.title) ? { title: renderedOrRawText(media.title) } : {}),
    ...(renderedOrRawText(media.caption) ? { caption: renderedOrRawText(media.caption) } : {})
  };
}

function featuredMediaFromWpCom(response: Record<string, unknown>): RemoteFeaturedMedia | undefined {
  const thumbnail = isRecord(response.post_thumbnail) ? response.post_thumbnail : {};
  const id = positiveId(thumbnail.ID ?? thumbnail.id);
  const url = text(
    thumbnail.URL ?? thumbnail.url ?? thumbnail.guid ?? response.featured_image
  );
  if (!id && !url) {
    return undefined;
  }
  return {
    ...(id ? { id } : {}),
    ...(url ? { url } : {}),
    ...(text(thumbnail.alt) ? { altText: text(thumbnail.alt) } : {}),
    ...(renderedOrRawText(thumbnail.title) ? { title: renderedOrRawText(thumbnail.title) } : {}),
    ...(renderedOrRawText(thumbnail.caption) ? { caption: renderedOrRawText(thumbnail.caption) } : {})
  };
}

export function detectRemotePostSourceFormat(content: string): RemotePostSourceFormat {
  if (!content.trim()) {
    return RemotePostSourceFormat.Empty;
  }
  return /<!--\s+wp:[a-z0-9-]+(?:\/[a-z0-9-]+)?(?:\s+\{[^\n]*})?\s+(?:-->|\/-->)/i
    .test(content)
    ? RemotePostSourceFormat.BlockEditor
    : RemotePostSourceFormat.ClassicHtml;
}

export function parseCoreRestPostTypeRoute(
  response: unknown,
  expectedPostType: string
): CoreRestPostRoute {
  if (!isRecord(response)) {
    throw new RemotePostError(
      RemotePostErrorCode.UnsupportedType,
      'WordPress did not return post type routing information.'
    );
  }
  const returnedType = text(response.slug);
  if (returnedType && returnedType !== expectedPostType) {
    throw new RemotePostError(
      RemotePostErrorCode.IdentityMismatch,
      'WordPress returned routing information for a different post type.'
    );
  }
  const defaultBase = expectedPostType === 'post'
    ? 'posts'
    : expectedPostType === 'page'
      ? 'pages'
      : expectedPostType;
  const namespace = safeRoutePart(response.rest_namespace, true) ?? 'wp/v2';
  const restBase = safeRoutePart(response.rest_base, true) ?? defaultBase;
  if (!namespace || !restBase) {
    throw new RemotePostError(
      RemotePostErrorCode.UnsupportedType,
      'WordPress returned an invalid REST route for this post type.'
    );
  }
  return { namespace, restBase };
}

function safeRoutePart(value: unknown, allowSlash: boolean): string | undefined {
  const normalized = text(value)?.replace(/^\/+|\/+$/g, '');
  if (!normalized
    || normalized.includes('..')
    || /[?#\\]/.test(normalized)
    || (!allowSlash && normalized.includes('/'))
  ) {
    return undefined;
  }
  return /^[a-z0-9_\-/]+$/i.test(normalized) ? normalized : undefined;
}

export function buildCoreRestPostPath(
  route: CoreRestPostRoute,
  target: RemotePostTarget
): string {
  const postId = positiveId(target.postId);
  if (!postId) {
    throw new RemotePostError(
      RemotePostErrorCode.InvalidTarget,
      'The WordPress post ID is invalid.'
    );
  }
  return 'wp-json/' + route.namespace + '/' + route.restBase + '/' + postId
    + '?context=edit&_embed=wp:featuredmedia,wp:term';
}

export function parseCoreRestRemotePost(response: unknown): RemotePostDocument {
  if (!isRecord(response)) {
    throw malformed('WordPress returned a non-object post response.');
  }
  const postId = positiveId(response.id);
  const postType = text(response.type);
  const title = editableText(response.title);
  const content = editableText(response.content);
  if (!postId || !postType || title === undefined || content === undefined) {
    throw malformed('WordPress did not return editable post identity, title, and content.');
  }
  const terms = embeddedRestTerms(response._embedded);
  const categoryIds = unique([
    ...ids(response.categories),
    ...terms.filter(term => term.taxonomy === 'category').map(term => term.id)
  ]);
  const tagIds = unique([
    ...ids(response.tags),
    ...terms.filter(term => term.taxonomy === 'post_tag').map(term => term.id)
  ]);
  const meta = metadataRecord(response.meta);
  const focusKeyword = text(meta.rank_math_focus_keyword);
  const metaDescription = text(meta.rank_math_description);
  const secondaryTitle = textAllowEmpty(meta._secondary_title);
  return {
    postId,
    postType,
    title,
    content,
    sourceFormat: detectRemotePostSourceFormat(content),
    ...(text(response.slug) ? { slug: text(response.slug) } : {}),
    ...(editableText(response.excerpt) !== undefined
      ? { excerpt: editableText(response.excerpt) }
      : {}),
    ...(text(response.status) ? { status: text(response.status) } : {}),
    ...(text(response.comment_status)
      ? { commentStatus: text(response.comment_status) }
      : {}),
    ...(normalizeTimestamp(response.date_gmt, true) ?? normalizeTimestamp(response.date)
      ? { publishedAt: normalizeTimestamp(response.date_gmt, true) ?? normalizeTimestamp(response.date) }
      : {}),
    ...(normalizeTimestamp(response.modified_gmt, true) ?? normalizeTimestamp(response.modified)
      ? { modifiedAt: normalizeTimestamp(response.modified_gmt, true) ?? normalizeTimestamp(response.modified) }
      : {}),
    ...(text(response.link) ? { link: text(response.link) } : {}),
    categoryIds,
    tagIds,
    terms,
    ...(featuredMediaFromRest(response)
      ? { featuredMedia: featuredMediaFromRest(response) }
      : {}),
    ...(focusKeyword ? { focusKeyword } : {}),
    ...(metaDescription ? { metaDescription } : {}),
    ...(secondaryTitle !== undefined ? { secondaryTitle } : {}),
    capabilities: {
      slug: hasOwn(response, 'slug'),
      excerpt: editableText(response.excerpt) !== undefined,
      status: hasOwn(response, 'status'),
      commentStatus: hasOwn(response, 'comment_status'),
      publishedAt: hasOwn(response, 'date') || hasOwn(response, 'date_gmt'),
      modifiedAt: hasOwn(response, 'modified') || hasOwn(response, 'modified_gmt'),
      categories: hasOwn(response, 'categories'),
      tags: hasOwn(response, 'tags'),
      featuredMedia: hasOwn(response, 'featured_media'),
      focusKeyword: hasOwn(meta, 'rank_math_focus_keyword'),
      metaDescription: hasOwn(meta, 'rank_math_description'),
      secondaryTitle: hasOwn(meta, '_secondary_title')
    }
  };
}

export function parseWpComRemotePost(response: unknown): RemotePostDocument {
  if (!isRecord(response)) {
    throw malformed('WordPress.com returned a non-object post response.');
  }
  const postId = positiveId(response.ID);
  const postType = text(response.type);
  const title = textAllowEmpty(response.title);
  const content = textAllowEmpty(response.content);
  if (!postId || !postType || title === undefined || content === undefined) {
    throw malformed('WordPress.com did not return editable post identity, title, and content.');
  }
  const categories = objectTerms(response.categories, 'category');
  const tags = objectTerms(response.tags, 'post_tag');
  const extraTerms = isRecord(response.terms)
    ? Object.entries(response.terms).flatMap(([ taxonomy, values ]) =>
      objectTerms(values, taxonomy)
    )
    : [];
  const terms = deduplicateTerms([ ...categories, ...tags, ...extraTerms ]);
  const metadata = metadataRecord(response.metadata);
  const focusKeyword = text(metadata.rank_math_focus_keyword);
  const metaDescription = text(metadata.rank_math_description);
  const secondaryTitle = textAllowEmpty(metadata._secondary_title);
  const discussion = isRecord(response.discussion) ? response.discussion : {};
  const commentStatus = text(discussion.comment_status)
    ?? (typeof discussion.comments_open === 'boolean'
      ? discussion.comments_open ? 'open' : 'closed'
      : undefined);
  return {
    postId,
    postType,
    title,
    content,
    sourceFormat: detectRemotePostSourceFormat(content),
    ...(text(response.slug) ? { slug: text(response.slug) } : {}),
    ...(textAllowEmpty(response.excerpt) !== undefined
      ? { excerpt: textAllowEmpty(response.excerpt) }
      : {}),
    ...(text(response.status) ? { status: text(response.status) } : {}),
    ...(commentStatus ? { commentStatus } : {}),
    ...(normalizeTimestamp(response.date)
      ? { publishedAt: normalizeTimestamp(response.date) }
      : {}),
    ...(normalizeTimestamp(response.modified)
      ? { modifiedAt: normalizeTimestamp(response.modified) }
      : {}),
    ...(text(response.URL) ? { link: text(response.URL) } : {}),
    categoryIds: unique(categories.map(term => term.id)),
    tagIds: unique(tags.map(term => term.id)),
    terms,
    ...(featuredMediaFromWpCom(response)
      ? { featuredMedia: featuredMediaFromWpCom(response) }
      : {}),
    ...(focusKeyword ? { focusKeyword } : {}),
    ...(metaDescription ? { metaDescription } : {}),
    ...(secondaryTitle !== undefined ? { secondaryTitle } : {}),
    capabilities: {
      slug: hasOwn(response, 'slug'),
      excerpt: hasOwn(response, 'excerpt'),
      status: hasOwn(response, 'status'),
      commentStatus: hasOwn(response, 'discussion'),
      publishedAt: hasOwn(response, 'date'),
      modifiedAt: hasOwn(response, 'modified'),
      categories: hasOwn(response, 'categories'),
      tags: hasOwn(response, 'tags'),
      featuredMedia: hasOwn(response, 'featured_image') || hasOwn(response, 'post_thumbnail'),
      focusKeyword: hasOwn(metadata, 'rank_math_focus_keyword'),
      metaDescription: hasOwn(metadata, 'rank_math_description'),
      secondaryTitle: hasOwn(metadata, '_secondary_title')
    }
  };
}

export function parseXmlRpcRemotePost(response: unknown): RemotePostDocument {
  if (!isRecord(response)) {
    throw malformed('WordPress XML-RPC returned a non-object post response.');
  }
  const postId = positiveId(response.post_id);
  const postType = text(response.post_type);
  const title = textAllowEmpty(response.post_title);
  const content = textAllowEmpty(response.post_content);
  if (!postId || !postType || title === undefined || content === undefined) {
    throw malformed('WordPress XML-RPC did not return post identity, title, and content.');
  }
  const terms = arrayTerms(response.terms);
  const categoryIds = unique(
    terms.filter(term => term.taxonomy === 'category').map(term => term.id)
  );
  const tagIds = unique(
    terms.filter(term => term.taxonomy === 'post_tag').map(term => term.id)
  );
  const customFields = metadataRecord(response.custom_fields);
  const focusKeyword = text(customFields.rank_math_focus_keyword);
  const metaDescription = text(customFields.rank_math_description);
  const secondaryTitle = textAllowEmpty(customFields._secondary_title);
  const featuredId = positiveId(response.post_thumbnail);
  return {
    postId,
    postType,
    title,
    content,
    sourceFormat: detectRemotePostSourceFormat(content),
    ...(text(response.post_name) ? { slug: text(response.post_name) } : {}),
    ...(textAllowEmpty(response.post_excerpt) !== undefined
      ? { excerpt: textAllowEmpty(response.post_excerpt) }
      : {}),
    ...(text(response.post_status) ? { status: text(response.post_status) } : {}),
    ...(text(response.comment_status)
      ? { commentStatus: text(response.comment_status) }
      : {}),
    ...(normalizeTimestamp(response.post_date_gmt ?? response.post_date)
      ? { publishedAt: normalizeTimestamp(response.post_date_gmt ?? response.post_date) }
      : {}),
    ...(normalizeTimestamp(response.post_modified_gmt ?? response.post_modified)
      ? { modifiedAt: normalizeTimestamp(response.post_modified_gmt ?? response.post_modified) }
      : {}),
    ...(text(response.link) ? { link: text(response.link) } : {}),
    categoryIds,
    tagIds,
    terms,
    ...(featuredId ? { featuredMedia: { id: featuredId } } : {}),
    ...(focusKeyword ? { focusKeyword } : {}),
    ...(metaDescription ? { metaDescription } : {}),
    ...(secondaryTitle !== undefined ? { secondaryTitle } : {}),
    capabilities: {
      slug: hasOwn(response, 'post_name'),
      excerpt: hasOwn(response, 'post_excerpt'),
      status: hasOwn(response, 'post_status'),
      commentStatus: hasOwn(response, 'comment_status'),
      publishedAt: hasOwn(response, 'post_date') || hasOwn(response, 'post_date_gmt'),
      modifiedAt: hasOwn(response, 'post_modified') || hasOwn(response, 'post_modified_gmt'),
      categories: Array.isArray(response.terms) || Array.isArray(response.categories),
      tags: Array.isArray(response.terms) || Array.isArray(response.tags),
      featuredMedia: hasOwn(response, 'post_thumbnail'),
      focusKeyword: hasOwn(customFields, 'rank_math_focus_keyword'),
      metaDescription: hasOwn(customFields, 'rank_math_description'),
      secondaryTitle: hasOwn(customFields, '_secondary_title')
    }
  };
}

function deduplicateTerms(terms: RemotePostTerm[]): RemotePostTerm[] {
  const seen = new Set<string>();
  return terms.filter(term => {
    const key = term.taxonomy + ':' + term.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function malformed(message: string): RemotePostError {
  return new RemotePostError(RemotePostErrorCode.MalformedResponse, message);
}

export function withRemotePostSeoMetadata(
  document: RemotePostDocument,
  values: { focusKeyword?: string, metaDescription?: string }
): RemotePostDocument {
  return {
    ...document,
    ...(values.focusKeyword ? { focusKeyword: values.focusKeyword } : {}),
    ...(values.metaDescription ? { metaDescription: values.metaDescription } : {}),
    capabilities: {
      ...document.capabilities,
      focusKeyword: true,
      metaDescription: true
    }
  };
}

export function withRemotePostSecondaryTitle(
  document: RemotePostDocument,
  secondaryTitle: string
): RemotePostDocument {
  return {
    ...document,
    secondaryTitle,
    capabilities: {
      ...document.capabilities,
      secondaryTitle: true
    }
  };
}

export function withRemotePostCapabilities(
  document: RemotePostDocument,
  capabilities: Partial<RemotePostFieldCapabilities>
): RemotePostDocument {
  return {
    ...document,
    capabilities: {
      ...document.capabilities,
      ...capabilities
    }
  };
}

export function createRemotePostSnapshot(
  document: RemotePostDocument,
  identity: {
    profileId: string;
    profileName: string;
    endpoint: string;
    fetchedAt?: string;
  }
): RemotePostSnapshot {
  return {
    ...document,
    profileId: identity.profileId,
    profileName: identity.profileName,
    endpoint: identity.endpoint,
    editUrl: identity.endpoint.replace(/\/+$/, '')
      + '/wp-admin/post.php?action=edit&post=' + encodeURIComponent(document.postId),
    fetchedAt: identity.fetchedAt ?? new Date().toISOString()
  };
}

export function validateRemotePostIdentity(
  document: RemotePostDocument,
  target: RemotePostTarget
): void {
  if (!positiveId(target.postId) || !/^[a-z0-9_-]+$/i.test(target.postType)) {
    throw new RemotePostError(
      RemotePostErrorCode.InvalidTarget,
      'The linked WordPress target is invalid.'
    );
  }
  if (document.postId !== target.postId || document.postType !== target.postType) {
    throw new RemotePostError(
      RemotePostErrorCode.IdentityMismatch,
      'WordPress returned a different post than the linked target.'
    );
  }
}
