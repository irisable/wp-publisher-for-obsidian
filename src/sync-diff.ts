import type { MatterData } from './types';

export const PullField = {
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
  MetaDescription: 'metaDescription',
  SecondaryTitle: 'secondaryTitle'
} as const;

export type PullField = typeof PullField[keyof typeof PullField];
export type PullFieldValue = string | string[];

export const PULL_FIELD_ORDER: PullField[] = [
  PullField.Title,
  PullField.SecondaryTitle,
  PullField.Body,
  PullField.Slug,
  PullField.Excerpt,
  PullField.Status,
  PullField.CommentStatus,
  PullField.Categories,
  PullField.Tags,
  PullField.FeaturedMedia,
  PullField.FocusKeyword,
  PullField.MetaDescription
];

export interface PullTermValue {
  id: string;
  taxonomy: string;
  name?: string;
  slug?: string;
}

export interface PullRemoteSource {
  title: string;
  body: string;
  slug?: string;
  excerpt?: string;
  status?: string;
  commentStatus?: string;
  categoryIds: string[];
  tagIds: string[];
  terms: PullTermValue[];
  featuredMedia?: {
    id?: string;
    url?: string;
  };
  focusKeyword?: string;
  metaDescription?: string;
  secondaryTitle?: string;
  capabilities: {
    slug: boolean;
    excerpt: boolean;
    status: boolean;
    commentStatus: boolean;
    categories: boolean;
    tags: boolean;
    featuredMedia: boolean;
    focusKeyword: boolean;
    metaDescription: boolean;
    secondaryTitle: boolean;
  };
}

export interface PullFieldDiff {
  key: PullField;
  available: boolean;
  changed: boolean;
  localValue: PullFieldValue;
  remoteValue: PullFieldValue;
  issue?: 'missing-category-slugs' | 'missing-tag-names'
    | 'missing-featured-media-url';
  missingIds?: string[];
}

export interface MarkdownNoteParts {
  hasFrontMatter: boolean;
  yamlStart: number;
  yamlEnd: number;
  contentStart: number;
  frontMatter: string;
  body: string;
  eol: '\n' | '\r\n';
  bom: string;
}

export interface UnifiedDiffRow {
  kind: 'equal' | 'remove' | 'add';
  line: string;
  localLine?: number;
  remoteLine?: number;
}

export interface UnifiedDiffResult {
  rows: UnifiedDiffRow[];
  omittedRows: number;
}

function ownString(matter: MatterData, ...keys: string[]): string {
  for (const key of keys) {
    if (typeof matter[key] === 'string') {
      return matter[key];
    }
  }
  return '';
}

function featuredImageValue(matter: MatterData): string {
  const value = matter.featuredImage;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return typeof value === 'string' ? value : '';
}

function focusKeywordValue(matter: MatterData): string {
  const value = matter.focusKeyword ?? matter.focus_keyword;
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .join(', ');
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [ value ];
  return [ ...new Set(values
    .flatMap(item => typeof item === 'string' ? item.split(/[,，]/u) : [])
    .map(item => item.trim())
    .filter(Boolean)) ];
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
}

function valuesEqual(left: PullFieldValue, right: PullFieldValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return [ ...left ].sort().join('\u0000') === [ ...right ].sort().join('\u0000');
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left === right;
  }
  return false;
}

function createField(
  key: PullField,
  localValue: PullFieldValue,
  remoteValue: PullFieldValue,
  available = true,
  issue?: PullFieldDiff['issue'],
  missingIds?: string[]
): PullFieldDiff {
  const comparableLocal = key === PullField.Body && typeof localValue === 'string'
    ? normalizeBody(localValue)
    : localValue;
  const comparableRemote = key === PullField.Body && typeof remoteValue === 'string'
    ? normalizeBody(remoteValue)
    : remoteValue;
  return {
    key,
    available,
    changed: available && !valuesEqual(comparableLocal, comparableRemote),
    localValue,
    remoteValue,
    ...(issue ? { issue } : {}),
    ...(missingIds && missingIds.length > 0 ? { missingIds } : {})
  };
}

function portableTerms(
  ids: readonly string[],
  taxonomy: string,
  terms: readonly PullTermValue[],
  preferred: 'slug' | 'name'
): { values: string[], missingIds: string[] } {
  const byId = new Map(
    terms
      .filter(term => term.taxonomy === taxonomy)
      .map(term => [ term.id, term ])
  );
  const values: string[] = [];
  const missingIds: string[] = [];
  ids.forEach(id => {
    const term = byId.get(id);
    const value = preferred === 'slug'
      ? term?.slug
      : term?.name ?? term?.slug;
    if (!value) {
      missingIds.push(id);
    } else if (!values.includes(value)) {
      values.push(value);
    }
  });
  return { values, missingIds };
}

export function splitMarkdownNote(raw: string): MarkdownNoteParts {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const start = bom.length;
  const firstBreak = raw.indexOf('\n', start);
  const firstEnd = firstBreak === -1 ? raw.length : firstBreak + 1;
  const firstLine = raw.slice(start, firstBreak === -1 ? raw.length : firstBreak)
    .replace(/\r$/, '');
  if (firstLine.trim() !== '---' || firstBreak === -1) {
    return {
      hasFrontMatter: false,
      yamlStart: start,
      yamlEnd: start,
      contentStart: start,
      frontMatter: '',
      body: raw.slice(start),
      eol,
      bom
    };
  }

  let cursor = firstEnd;
  while (cursor <= raw.length) {
    const nextBreak = raw.indexOf('\n', cursor);
    const lineEnd = nextBreak === -1 ? raw.length : nextBreak;
    const line = raw.slice(cursor, lineEnd).replace(/\r$/, '');
    if (line.trim() === '---' || line.trim() === '...') {
      const contentStart = nextBreak === -1 ? raw.length : nextBreak + 1;
      return {
        hasFrontMatter: true,
        yamlStart: firstEnd,
        yamlEnd: cursor,
        contentStart,
        frontMatter: raw.slice(firstEnd, cursor),
        body: raw.slice(contentStart),
        eol,
        bom
      };
    }
    if (nextBreak === -1) {
      break;
    }
    cursor = nextBreak + 1;
  }

  return {
    hasFrontMatter: false,
    yamlStart: start,
    yamlEnd: start,
    contentStart: start,
    frontMatter: '',
    body: raw.slice(start),
    eol,
    bom
  };
}

export function buildPullFieldDiffs(options: {
  noteRaw: string;
  matter: MatterData;
  fallbackTitle: string;
  remote: PullRemoteSource;
}): PullFieldDiff[] {
  const parts = splitMarkdownNote(options.noteRaw);
  const { matter, remote } = options;
  const categories = portableTerms(
    remote.categoryIds,
    'category',
    remote.terms,
    'slug'
  );
  const tags = portableTerms(remote.tagIds, 'post_tag', remote.terms, 'name');
  const categoryAvailable = remote.capabilities.categories
    && categories.missingIds.length === 0;
  const tagsAvailable = remote.capabilities.tags && tags.missingIds.length === 0;
  const featuredAvailable = remote.capabilities.featuredMedia
    && (!remote.featuredMedia?.id || Boolean(remote.featuredMedia.url));

  return [
    createField(
      PullField.Title,
      typeof matter.title === 'string' ? matter.title : options.fallbackTitle,
      remote.title
    ),
    createField(
      PullField.SecondaryTitle,
      ownString(matter, 'secondaryTitle', 'secondary_title'),
      remote.secondaryTitle ?? '',
      remote.capabilities.secondaryTitle
    ),
    createField(PullField.Body, parts.body, remote.body),
    createField(
      PullField.Slug,
      ownString(matter, 'slug'),
      remote.slug ?? '',
      remote.capabilities.slug
    ),
    createField(
      PullField.Excerpt,
      ownString(matter, 'excerpt'),
      remote.excerpt ?? '',
      remote.capabilities.excerpt
    ),
    createField(
      PullField.Status,
      ownString(matter, 'status'),
      remote.status ?? '',
      remote.capabilities.status
    ),
    createField(
      PullField.CommentStatus,
      ownString(matter, 'commentStatus', 'comment_status'),
      remote.commentStatus ?? '',
      remote.capabilities.commentStatus
    ),
    createField(
      PullField.Categories,
      stringList(matter.categories),
      categories.values,
      categoryAvailable,
      categoryAvailable || !remote.capabilities.categories
        ? undefined
        : 'missing-category-slugs',
      categories.missingIds
    ),
    createField(
      PullField.Tags,
      stringList(matter.tags),
      tags.values,
      tagsAvailable,
      tagsAvailable || !remote.capabilities.tags ? undefined : 'missing-tag-names',
      tags.missingIds
    ),
    createField(
      PullField.FeaturedMedia,
      featuredImageValue(matter),
      remote.featuredMedia?.url ?? '',
      featuredAvailable,
      featuredAvailable || !remote.capabilities.featuredMedia
        ? undefined
        : 'missing-featured-media-url'
    ),
    createField(
      PullField.FocusKeyword,
      focusKeywordValue(matter),
      remote.focusKeyword ?? '',
      remote.capabilities.focusKeyword
    ),
    createField(
      PullField.MetaDescription,
      ownString(matter, 'metaDescription', 'meta_description'),
      remote.metaDescription ?? '',
      remote.capabilities.metaDescription
    )
  ];
}

function setOptionalText(
  matter: MatterData,
  key: string,
  value: string,
  aliases: string[] = []
): void {
  aliases.forEach(alias => delete matter[alias]);
  if (value === '') {
    delete matter[key];
  } else {
    matter[key] = value;
  }
}

export function applySelectedPullFields(
  matter: MatterData,
  diffs: readonly PullFieldDiff[],
  selectedFields: ReadonlySet<PullField>
): MatterData {
  const next: MatterData = { ...matter };
  diffs.forEach(diff => {
    if (!selectedFields.has(diff.key) || diff.key === PullField.Body) {
      return;
    }
    if (!diff.available || !diff.changed) {
      throw new Error('Pull field is not available for application: ' + diff.key);
    }
    switch (diff.key) {
      case PullField.Title:
        next.title = String(diff.remoteValue);
        break;
      case PullField.Slug:
        setOptionalText(next, 'slug', String(diff.remoteValue));
        break;
      case PullField.Excerpt:
        setOptionalText(next, 'excerpt', String(diff.remoteValue));
        break;
      case PullField.Status:
        setOptionalText(next, 'status', String(diff.remoteValue));
        break;
      case PullField.CommentStatus:
        setOptionalText(
          next,
          'commentStatus',
          String(diff.remoteValue),
          [ 'comment_status' ]
        );
        break;
      case PullField.Categories:
        next.categories = [ ...(diff.remoteValue as string[]) ];
        break;
      case PullField.Tags:
        next.tags = [ ...(diff.remoteValue as string[]) ];
        break;
      case PullField.FeaturedMedia:
        setOptionalText(next, 'featuredImage', String(diff.remoteValue));
        break;
      case PullField.FocusKeyword:
        setOptionalText(
          next,
          'focusKeyword',
          String(diff.remoteValue),
          [ 'focus_keyword' ]
        );
        break;
      case PullField.MetaDescription:
        setOptionalText(
          next,
          'metaDescription',
          String(diff.remoteValue),
          [ 'meta_description' ]
        );
        break;
      case PullField.SecondaryTitle:
        setOptionalText(
          next,
          'secondaryTitle',
          String(diff.remoteValue),
          [ 'secondary_title' ]
        );
        break;
    }
  });
  return next;
}

function normalizedYaml(yaml: string, eol: '\n' | '\r\n'): string {
  const normalized = yaml.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
  return normalized ? normalized.replace(/\n/g, eol) + eol : '';
}

function pulledBody(
  body: string,
  currentBody: string,
  eol: '\n' | '\r\n'
): string {
  const normalized = body.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
  if (!normalized) {
    return '';
  }
  const converted = normalized.replace(/\n/g, eol);
  return /(?:\r?\n)$/.test(currentBody) ? converted + eol : converted;
}

export function composePulledNoteRevision(options: {
  raw: string;
  serializedMatter?: string;
  pulledBody?: string;
}): string {
  const parts = splitMarkdownNote(options.raw);
  const body = options.pulledBody === undefined
    ? parts.body
    : pulledBody(options.pulledBody, parts.body, parts.eol);
  let prefix: string;
  if (options.serializedMatter === undefined) {
    prefix = options.raw.slice(0, parts.contentStart);
  } else if (parts.hasFrontMatter) {
    prefix = options.raw.slice(0, parts.yamlStart)
      + normalizedYaml(options.serializedMatter, parts.eol)
      + options.raw.slice(parts.yamlEnd, parts.contentStart);
  } else {
    const yaml = normalizedYaml(options.serializedMatter, parts.eol);
    prefix = parts.bom + '---' + parts.eol + yaml + '---' + parts.eol;
  }
  return prefix + body;
}

function splitLines(value: string): string[] {
  const normalized = normalizeBody(value);
  return normalized === '' ? [] : normalized.split('\n');
}

function coarseRows(local: string[], remote: string[]): UnifiedDiffRow[] {
  return [
    ...local.map((line, index) => ({
      kind: 'remove' as const,
      line,
      localLine: index + 1
    })),
    ...remote.map((line, index) => ({
      kind: 'add' as const,
      line,
      remoteLine: index + 1
    }))
  ];
}

export function createUnifiedLineDiff(
  localBody: string,
  remoteBody: string,
  maxRows = 600,
  maxMatrixCells = 160_000
): UnifiedDiffResult {
  const local = splitLines(localBody);
  const remote = splitLines(remoteBody);
  let rows: UnifiedDiffRow[];
  if (local.length * remote.length > maxMatrixCells) {
    rows = coarseRows(local, remote);
  } else {
    const matrix = Array.from(
      { length: local.length + 1 },
      () => new Uint32Array(remote.length + 1)
    );
    for (let left = local.length - 1; left >= 0; left -= 1) {
      for (let right = remote.length - 1; right >= 0; right -= 1) {
        matrix[left][right] = local[left] === remote[right]
          ? matrix[left + 1][right + 1] + 1
          : Math.max(matrix[left + 1][right], matrix[left][right + 1]);
      }
    }
    rows = [];
    let left = 0;
    let right = 0;
    while (left < local.length || right < remote.length) {
      if (left < local.length && right < remote.length && local[left] === remote[right]) {
        rows.push({
          kind: 'equal',
          line: local[left],
          localLine: left + 1,
          remoteLine: right + 1
        });
        left += 1;
        right += 1;
      } else if (right < remote.length
        && (left >= local.length || matrix[left][right + 1] >= matrix[left + 1][right])
      ) {
        rows.push({ kind: 'add', line: remote[right], remoteLine: right + 1 });
        right += 1;
      } else {
        rows.push({ kind: 'remove', line: local[left], localLine: left + 1 });
        left += 1;
      }
    }
  }
  const visible = rows.slice(0, Math.max(0, maxRows));
  return {
    rows: visible,
    omittedRows: Math.max(0, rows.length - visible.length)
  };
}
