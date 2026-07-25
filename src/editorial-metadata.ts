export const RANK_MATH_FOCUS_KEYWORD_META = 'rank_math_focus_keyword';
export const RANK_MATH_DESCRIPTION_META = 'rank_math_description';
export const SECONDARY_TITLE_META = '_secondary_title';

export interface EditorialMetadataCapabilities {
  focusKeyword: boolean;
  metaDescription: boolean;
  secondaryTitle: boolean;
}

export interface EditorialMetadataValues {
  slug?: string;
  excerpt?: string;
  featuredMediaId?: number;
  focusKeyword?: string;
  metaDescription?: string;
  secondaryTitle?: string;
  updateStrategy?: string;
  updateFields?: readonly string[];
}

export type FeaturedImageReference =
  | { type: 'attachment-id', id: number }
  | { type: 'vault-path', path: string }
  | { type: 'remote-url', url: string };

function cleanText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function exactFieldSelected(
  values: EditorialMetadataValues,
  field: string
): boolean {
  return values.updateStrategy === 'merge' && values.updateFields?.includes(field) === true;
}

function baseEditorialMetadata(values: EditorialMetadataValues): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const slug = cleanText(values.slug);
  const excerpt = cleanText(values.excerpt);
  if (slug) {
    metadata.slug = slug;
  }
  if (excerpt) {
    metadata.excerpt = excerpt;
  }
  return metadata;
}

export function buildRestEditorialMetadata(
  values: EditorialMetadataValues
): Record<string, unknown> {
  const metadata = baseEditorialMetadata(values);
  if (values.featuredMediaId
    || (exactFieldSelected(values, 'featuredMedia')
      && values.featuredMediaId !== undefined)
  ) {
    metadata.featured_media = values.featuredMediaId;
  }
  return metadata;
}

export function buildWpComEditorialMetadata(
  values: EditorialMetadataValues
): Record<string, unknown> {
  const metadata = baseEditorialMetadata(values);
  if (values.featuredMediaId
    || (exactFieldSelected(values, 'featuredMedia')
      && values.featuredMediaId !== undefined)
  ) {
    metadata.featured_image = String(values.featuredMediaId);
  }
  const customMetadata: Record<string, unknown>[] = [];
  const focusKeyword = cleanText(values.focusKeyword);
  const metaDescription = cleanText(values.metaDescription);
  if (focusKeyword || exactFieldSelected(values, 'focusKeyword')) {
    customMetadata.push({
      key: RANK_MATH_FOCUS_KEYWORD_META,
      value: focusKeyword ?? '',
      operation: 'update'
    });
  }
  if (metaDescription || exactFieldSelected(values, 'metaDescription')) {
    customMetadata.push({
      key: RANK_MATH_DESCRIPTION_META,
      value: metaDescription ?? '',
      operation: 'update'
    });
  }
  if (customMetadata.length > 0) {
    metadata.metadata = customMetadata;
  }
  return metadata;
}

export function buildRankMathSeoMetadata(
  values: EditorialMetadataValues
): Record<string, string> {
  const metadata: Record<string, string> = {};
  const focusKeyword = cleanText(values.focusKeyword);
  const metaDescription = cleanText(values.metaDescription);
  if (focusKeyword || exactFieldSelected(values, 'focusKeyword')) {
    metadata[RANK_MATH_FOCUS_KEYWORD_META] = focusKeyword ?? '';
  }
  if (metaDescription || exactFieldSelected(values, 'metaDescription')) {
    metadata[RANK_MATH_DESCRIPTION_META] = metaDescription ?? '';
  }
  return metadata;
}

export function buildSecondaryTitleMetadata(
  values: EditorialMetadataValues
): Record<string, string> {
  const explicitlyProvided = Object.prototype.hasOwnProperty.call(values, 'secondaryTitle');
  if (!explicitlyProvided && !exactFieldSelected(values, 'secondaryTitle')) {
    return {};
  }
  return {
    [SECONDARY_TITLE_META]: values.secondaryTitle?.trim() ?? ''
  };
}

export function buildXmlRpcEditorialMetadata(
  values: EditorialMetadataValues
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const slug = cleanText(values.slug);
  const excerpt = cleanText(values.excerpt);
  if (slug) {
    metadata.post_name = slug;
  }
  if (excerpt) {
    metadata.post_excerpt = excerpt;
  }
  if (values.featuredMediaId
    || (exactFieldSelected(values, 'featuredMedia')
      && values.featuredMediaId !== undefined)
  ) {
    metadata.post_thumbnail = values.featuredMediaId;
  }
  return metadata;
}

/** Accept attachment IDs, Obsidian embeds, Markdown images, or raw paths. */
export function parseFeaturedImageReference(value: string): FeaturedImageReference | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (/^[1-9]\d*$/.test(normalized)) {
    return { type: 'attachment-id', id: Number(normalized) };
  }

  const wikiLink = normalized.match(/^!?\[\[([^|\]]+)(?:\|[^\]]*)?]]$/);
  const markdownImage = normalized.match(/^!\[[^\]]*]\((.+)\)$/);
  const path = (wikiLink?.[1] ?? markdownImage?.[1] ?? normalized)
    .trim()
    .replace(/^<|>$/g, '');
  if (/^https?:\/\//i.test(path)) {
    return { type: 'remote-url', url: path };
  }
  return { type: 'vault-path', path };
}
