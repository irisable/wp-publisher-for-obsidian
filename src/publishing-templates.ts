import type { CommentStatus, PostStatus, PostType } from './wp-api';

export interface PublishingTemplate {
  id: string;
  name: string;
  status: PostStatus;
  commentStatus: CommentStatus;
  postType: PostType;
  tags: string[];
}

export interface TemplatePublishingFields {
  status: PostStatus;
  commentStatus: CommentStatus;
  postType: PostType;
  tags: string[];
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim() || undefined;
}

function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [ value ];
  const tags = values
    .flatMap(item => typeof item === 'string' ? item.split(/[,，]/u) : [])
    .map(tag => tag.trim())
    .filter(Boolean);
  return [ ...new Set(tags) ];
}

function normalizeStatus(value: unknown): PostStatus {
  return value === 'publish' || value === 'private'
    ? value as PostStatus
    : 'draft' as PostStatus;
}

function normalizeCommentStatus(value: unknown): CommentStatus {
  return value === 'closed'
    ? 'closed' as CommentStatus
    : 'open' as CommentStatus;
}

export function createPublishingTemplate(id: string): PublishingTemplate {
  return {
    id,
    name: '',
    status: 'draft' as PostStatus,
    commentStatus: 'open' as CommentStatus,
    postType: 'post',
    tags: []
  };
}

export function normalizePublishingTemplate(
  value: unknown,
  fallbackId = 'template'
): PublishingTemplate {
  const item = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    id: optionalText(item.id) ?? fallbackId,
    name: optionalText(item.name) ?? '',
    status: normalizeStatus(item.status),
    commentStatus: normalizeCommentStatus(item.commentStatus),
    postType: optionalText(item.postType) ?? 'post',
    tags: normalizeTags(item.tags)
  };
}

export function normalizePublishingTemplates(value: unknown): PublishingTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const usedIds = new Set<string>();
  return value.map((item, index) => {
    const template = normalizePublishingTemplate(item, `template-${index + 1}`);
    let uniqueId = template.id;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${template.id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(uniqueId);
    return { ...template, id: uniqueId };
  });
}

function selectPostType(preferred: PostType, available: readonly PostType[]): PostType {
  if (available.includes(preferred)) {
    return preferred;
  }
  if (available.includes('post')) {
    return 'post';
  }
  return available[0] ?? 'post';
}

export function applyPublishingTemplate(
  base: TemplatePublishingFields,
  template: PublishingTemplate | undefined,
  matter: Record<string, unknown>,
  availablePostTypes: readonly PostType[],
  lockedPostType?: PostType
): TemplatePublishingFields {
  const source = template
    ? normalizePublishingTemplate(template, template.id)
    : {
      ...base,
      tags: normalizeTags(base.tags)
    };
  const preferredPostType = lockedPostType ?? source.postType;
  return {
    status: source.status,
    commentStatus: source.commentStatus,
    postType: selectPostType(preferredPostType, availablePostTypes),
    tags: Object.prototype.hasOwnProperty.call(matter, 'tags')
      ? normalizeTags(matter.tags)
      : normalizeTags(source.tags)
  };
}
