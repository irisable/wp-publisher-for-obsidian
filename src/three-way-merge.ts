import type { MatterData } from './types';
import type {
  PullField,
  PullFieldValue
} from './sync-diff';
import type {
  SyncBaseline,
  SyncDocument,
  SyncFieldSnapshot
} from './sync-baseline';

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
  MetaDescription: 'metaDescription',
  SecondaryTitle: 'secondaryTitle'
} as const;

const FIELD_ORDER: PullField[] = [
  FIELD.Title,
  FIELD.SecondaryTitle,
  FIELD.Body,
  FIELD.Slug,
  FIELD.Excerpt,
  FIELD.Status,
  FIELD.CommentStatus,
  FIELD.Categories,
  FIELD.Tags,
  FIELD.FeaturedMedia,
  FIELD.FocusKeyword,
  FIELD.MetaDescription
];

export const ThreeWayFieldKind = {
  Unchanged: 'unchanged',
  LocalOnly: 'local-only',
  RemoteOnly: 'remote-only',
  BothSame: 'both-same',
  AutoMerged: 'auto-merged',
  Conflict: 'conflict',
  Excluded: 'excluded'
} as const;

export type ThreeWayFieldKind = typeof ThreeWayFieldKind[
  keyof typeof ThreeWayFieldKind
];

export const MergeChoice = {
  Local: 'local',
  Remote: 'remote',
  Edited: 'edited'
} as const;

export type MergeChoice = typeof MergeChoice[keyof typeof MergeChoice];

export interface MergeConflictResolution {
  choice: MergeChoice;
  editedValue?: PullFieldValue;
}

export interface BodyMergeConflict {
  id: string;
  base: string;
  local: string;
  remote: string;
  containsProtectedSource: boolean;
  reason: 'overlap' | 'different-baselines' | 'comparison-limit';
}

export type BodyMergePart =
  | { kind: 'merged', value: string }
  | { kind: 'conflict', conflict: BodyMergeConflict };

export interface ThreeWayBodyPlan {
  parts: BodyMergePart[];
  conflictCount: number;
  autoMergedChangeCount: number;
}

export interface ThreeWayFieldPlan {
  field: PullField;
  kind: ThreeWayFieldKind;
  baseLocal?: SyncFieldSnapshot;
  baseRemote?: SyncFieldSnapshot;
  local?: SyncFieldSnapshot;
  remote?: SyncFieldSnapshot;
  merged?: SyncFieldSnapshot;
  body?: ThreeWayBodyPlan;
}

export interface ThreeWayMergePlan {
  fields: ThreeWayFieldPlan[];
  conflictCount: number;
  excludedFields: PullField[];
}

export interface ResolvedThreeWayMerge {
  document: SyncDocument;
  unresolvedConflictIds: string[];
}

export interface AppliedMergeMatter {
  matter: MatterData;
  changedFields: PullField[];
}

interface BodyAtom {
  value: string;
  protected: boolean;
}

interface SequenceChange {
  start: number;
  end: number;
  replacement: BodyAtom[];
  side: 'local' | 'remote';
}

const BODY_MATRIX_CELL_LIMIT = 250_000;
const PROTECTED_OPEN = /^\s*%%\s+wp-source:v\d+(?:\s+[a-z0-9_\/-]+)?\s*$/i;
const PROTECTED_CLOSE = /^\s*%%\s*$/;
const FENCE = /^(\s{0,3})(`{3,}|~{3,})/;

function cloneValue(value: PullFieldValue): PullFieldValue {
  return Array.isArray(value) ? [ ...value ] : value;
}

function cloneSnapshot(snapshot: SyncFieldSnapshot): SyncFieldSnapshot {
  return {
    present: snapshot.present,
    value: cloneValue(snapshot.value)
  };
}

function isListField(field: PullField): boolean {
  return field === FIELD.Categories || field === FIELD.Tags;
}

function canonicalizeField(
  field: PullField,
  snapshot: SyncFieldSnapshot
): SyncFieldSnapshot {
  if (!snapshot.present) {
    return { present: false, value: isListField(field) ? [] : '' };
  }
  if (isListField(field)) {
    const values = Array.isArray(snapshot.value) ? snapshot.value : [ snapshot.value ];
    return {
      present: true,
      value: [ ...new Set(values.map(item => String(item).trim()).filter(Boolean)) ].sort()
    };
  }
  let value = Array.isArray(snapshot.value)
    ? snapshot.value.join(',')
    : String(snapshot.value);
  value = value.replace(/\r\n?/g, '\n');
  if (field === FIELD.Body && value.endsWith('\n')) {
    value = value.slice(0, -1);
  }
  return { present: true, value };
}

function hashText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return (first >>> 0).toString(16).padStart(8, '0')
    + (second >>> 0).toString(16).padStart(8, '0');
}

function hashField(field: PullField, snapshot: SyncFieldSnapshot): string {
  const canonical = canonicalizeField(field, snapshot);
  return hashText(JSON.stringify([ canonical.present, canonical.value ]));
}

function snapshotsEqual(
  field: PullField,
  left: SyncFieldSnapshot,
  right: SyncFieldSnapshot
): boolean {
  return hashField(field, left) === hashField(field, right);
}

function stringValue(snapshot: SyncFieldSnapshot): string {
  return Array.isArray(snapshot.value)
    ? snapshot.value.join('\n')
    : snapshot.value;
}

function lineRecords(value: string): Array<{ text: string, start: number, end: number }> {
  const records: Array<{ text: string, start: number, end: number }> = [];
  let start = 0;
  while (start < value.length) {
    const newline = value.indexOf('\n', start);
    const end = newline === -1 ? value.length : newline + 1;
    records.push({
      text: value.slice(start, newline === -1 ? end : newline).replace(/\r$/, ''),
      start,
      end
    });
    start = end;
  }
  return records;
}

function textAtoms(value: string): BodyAtom[] {
  const atoms: BodyAtom[] = [];
  let start = 0;
  while (start < value.length) {
    const newline = value.indexOf('\n', start);
    const end = newline === -1 ? value.length : newline + 1;
    atoms.push({ value: value.slice(start, end), protected: false });
    start = end;
  }
  return atoms;
}

/** Keep a complete protected WordPress source marker as one diff atom. */
function bodyAtoms(value: string): BodyAtom[] {
  const records = lineRecords(value);
  const atoms: BodyAtom[] = [];
  let sourceStart = 0;
  let fence: { marker: '`' | '~', length: number } | null = null;

  const appendText = (end: number): void => {
    if (end > sourceStart) {
      atoms.push(...textAtoms(value.slice(sourceStart, end)));
    }
  };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const fenceMatch = record.text.match(FENCE);
    if (fenceMatch) {
      const marker = fenceMatch[2][0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: fenceMatch[2].length };
      } else if (fence.marker === marker && fenceMatch[2].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence || !PROTECTED_OPEN.test(record.text)) {
      continue;
    }
    let close = index + 1;
    while (close < records.length && !PROTECTED_CLOSE.test(records[close].text)) {
      close += 1;
    }
    if (close >= records.length) {
      throw new Error(`Protected WordPress source at line ${index + 1} is not closed.`);
    }
    const payload = records
      .slice(index + 1, close)
      .map(item => item.text.trim())
      .join('');
    if (!payload || payload.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(payload)) {
      throw new Error('The protected WordPress source payload is not valid base64.');
    }
    try {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('The protected WordPress source payload is not valid base64.');
    }
    appendText(record.start);
    atoms.push({
      value: value.slice(record.start, records[close].end),
      protected: true
    });
    sourceStart = records[close].end;
    index = close;
  }
  appendText(value.length);
  return atoms;
}

function atomsEqual(left: readonly BodyAtom[], right: readonly BodyAtom[]): boolean {
  return left.length === right.length
    && left.every((atom, index) => atom.value === right[index].value);
}

function atomText(atoms: readonly BodyAtom[]): string {
  return atoms.map(atom => atom.value).join('');
}

function sequenceChanges(
  base: readonly BodyAtom[],
  variant: readonly BodyAtom[],
  side: SequenceChange['side']
): SequenceChange[] | null {
  if ((base.length + 1) * (variant.length + 1) > BODY_MATRIX_CELL_LIMIT) {
    return null;
  }
  const matrix = Array.from(
    { length: base.length + 1 },
    () => new Uint32Array(variant.length + 1)
  );
  for (let left = base.length - 1; left >= 0; left -= 1) {
    for (let right = variant.length - 1; right >= 0; right -= 1) {
      matrix[left][right] = base[left].value === variant[right].value
        ? matrix[left + 1][right + 1] + 1
        : Math.max(matrix[left + 1][right], matrix[left][right + 1]);
    }
  }

  const changes: SequenceChange[] = [];
  let left = 0;
  let right = 0;
  let pending: SequenceChange | null = null;
  const ensurePending = (): SequenceChange => {
    pending ??= { start: left, end: left, replacement: [], side };
    return pending;
  };
  const flush = (): void => {
    if (pending) {
      changes.push(pending);
      pending = null;
    }
  };

  while (left < base.length || right < variant.length) {
    if (left < base.length && right < variant.length
      && base[left].value === variant[right].value
    ) {
      flush();
      left += 1;
      right += 1;
      continue;
    }
    if (right < variant.length
      && (left >= base.length || matrix[left][right + 1] >= matrix[left + 1][right])
    ) {
      ensurePending().replacement.push(variant[right]);
      right += 1;
    } else {
      ensurePending().end = left + 1;
      left += 1;
    }
  }
  flush();
  return changes;
}

function changesOverlap(left: SequenceChange, right: SequenceChange): boolean {
  const leftInsertion = left.start === left.end;
  const rightInsertion = right.start === right.end;
  if (leftInsertion && rightInsertion) {
    return left.start === right.start;
  }
  if (leftInsertion) {
    return left.start > right.start && left.start < right.end;
  }
  if (rightInsertion) {
    return right.start > left.start && right.start < left.end;
  }
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

function groupedChanges(changes: SequenceChange[]): SequenceChange[][] {
  const parents = changes.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < changes.length; left += 1) {
    for (let right = left + 1; right < changes.length; right += 1) {
      if (changes[left].side !== changes[right].side
        && changesOverlap(changes[left], changes[right])
      ) {
        union(left, right);
      }
    }
  }
  const groups = new Map<number, SequenceChange[]>();
  changes.forEach((change, index) => {
    const key = root(index);
    groups.set(key, [ ...(groups.get(key) ?? []), change ]);
  });
  return [ ...groups.values() ].sort((left, right) => {
    const leftStart = Math.min(...left.map(change => change.start));
    const rightStart = Math.min(...right.map(change => change.start));
    if (leftStart !== rightStart) return leftStart - rightStart;
    const leftEnd = Math.max(...left.map(change => change.end));
    const rightEnd = Math.max(...right.map(change => change.end));
    return leftEnd - rightEnd;
  });
}

function applyChanges(
  base: readonly BodyAtom[],
  start: number,
  end: number,
  changes: readonly SequenceChange[]
): BodyAtom[] {
  const output: BodyAtom[] = [];
  let cursor = start;
  [ ...changes ]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .forEach(change => {
      output.push(...base.slice(cursor, change.start));
      output.push(...change.replacement);
      cursor = change.end;
    });
  output.push(...base.slice(cursor, end));
  return output;
}

function appendMerged(parts: BodyMergePart[], value: string): void {
  if (!value) return;
  const previous = parts[parts.length - 1];
  if (previous?.kind === 'merged') {
    previous.value += value;
  } else {
    parts.push({ kind: 'merged', value });
  }
}

function wholeBodyConflict(options: {
  base: string;
  local: string;
  remote: string;
  reason: BodyMergeConflict['reason'];
}): ThreeWayBodyPlan {
  return {
    parts: [ {
      kind: 'conflict',
      conflict: {
        id: 'body-1',
        ...options,
        containsProtectedSource: /(^|\n)\s*%%\s+wp-source:v\d+/i.test(
          options.base + '\n' + options.local + '\n' + options.remote
        )
      }
    } ],
    conflictCount: 1,
    autoMergedChangeCount: 0
  };
}

export function mergeBodyThreeWay(options: {
  baseLocal: string;
  baseRemote: string;
  local: string;
  remote: string;
}): ThreeWayBodyPlan {
  const baseLocal = bodyAtoms(options.baseLocal);
  const baseRemote = bodyAtoms(options.baseRemote);
  if (!atomsEqual(baseLocal, baseRemote)) {
    return wholeBodyConflict({
      base: options.baseLocal,
      local: options.local,
      remote: options.remote,
      reason: 'different-baselines'
    });
  }
  const local = bodyAtoms(options.local);
  const remote = bodyAtoms(options.remote);
  const localChanges = sequenceChanges(baseLocal, local, 'local');
  const remoteChanges = sequenceChanges(baseLocal, remote, 'remote');
  if (!localChanges || !remoteChanges) {
    return wholeBodyConflict({
      base: options.baseLocal,
      local: options.local,
      remote: options.remote,
      reason: 'comparison-limit'
    });
  }

  const groups = groupedChanges([ ...localChanges, ...remoteChanges ]);
  const parts: BodyMergePart[] = [];
  let cursor = 0;
  let conflictIndex = 0;
  let autoMergedChangeCount = 0;
  groups.forEach(group => {
    const start = Math.min(...group.map(change => change.start));
    const end = Math.max(...group.map(change => change.end));
    appendMerged(parts, atomText(baseLocal.slice(cursor, start)));
    const localGroup = group.filter(change => change.side === 'local');
    const remoteGroup = group.filter(change => change.side === 'remote');
    const localValue = applyChanges(baseLocal, start, end, localGroup);
    const remoteValue = applyChanges(baseLocal, start, end, remoteGroup);
    if (localGroup.length > 0 && remoteGroup.length > 0
      && !atomsEqual(localValue, remoteValue)
    ) {
      conflictIndex += 1;
      parts.push({
        kind: 'conflict',
        conflict: {
          id: 'body-' + conflictIndex,
          base: atomText(baseLocal.slice(start, end)),
          local: atomText(localValue),
          remote: atomText(remoteValue),
          containsProtectedSource: [
            ...baseLocal.slice(start, end),
            ...localValue,
            ...remoteValue
          ].some(atom => atom.protected),
          reason: 'overlap'
        }
      });
    } else {
      const selected = localGroup.length > 0 ? localValue : remoteValue;
      appendMerged(parts, atomText(selected));
      autoMergedChangeCount += group.length;
    }
    cursor = end;
  });
  appendMerged(parts, atomText(baseLocal.slice(cursor)));
  return {
    parts,
    conflictCount: conflictIndex,
    autoMergedChangeCount
  };
}

function bodyPlanForField(options: {
  baseLocal: SyncFieldSnapshot;
  baseRemote: SyncFieldSnapshot;
  local: SyncFieldSnapshot;
  remote: SyncFieldSnapshot;
}): ThreeWayBodyPlan {
  return mergeBodyThreeWay({
    baseLocal: stringValue(options.baseLocal),
    baseRemote: stringValue(options.baseRemote),
    local: stringValue(options.local),
    remote: stringValue(options.remote)
  });
}

export function createThreeWayMergePlan(options: {
  baseline: SyncBaseline;
  local: SyncDocument;
  remote: SyncDocument;
}): ThreeWayMergePlan {
  const fields: ThreeWayFieldPlan[] = [];
  const excludedFields: PullField[] = [];
  let conflictCount = 0;
  FIELD_ORDER.forEach(field => {
    const base = options.baseline.fields[field];
    if (!base) return;
    const localRaw = options.local.fields[field];
    const remoteRaw = options.remote.fields[field];
    if (!localRaw || !remoteRaw) {
      fields.push({ field, kind: ThreeWayFieldKind.Excluded });
      excludedFields.push(field);
      return;
    }
    const baseLocal = canonicalizeField(field, base.local);
    const baseRemote = canonicalizeField(field, base.remote);
    const local = canonicalizeField(field, localRaw);
    const remote = canonicalizeField(field, remoteRaw);
    const localChanged = !snapshotsEqual(field, baseLocal, local);
    const remoteChanged = !snapshotsEqual(field, baseRemote, remote);
    const common = { field, baseLocal, baseRemote, local, remote };
    if (!localChanged && !remoteChanged) {
      fields.push({
        ...common,
        kind: ThreeWayFieldKind.Unchanged,
        merged: cloneSnapshot(local)
      });
    } else if (localChanged && !remoteChanged) {
      fields.push({
        ...common,
        kind: ThreeWayFieldKind.LocalOnly,
        merged: cloneSnapshot(local)
      });
    } else if (!localChanged && remoteChanged) {
      fields.push({
        ...common,
        kind: ThreeWayFieldKind.RemoteOnly,
        merged: cloneSnapshot(remote)
      });
    } else if (snapshotsEqual(field, local, remote)) {
      fields.push({
        ...common,
        kind: ThreeWayFieldKind.BothSame,
        merged: cloneSnapshot(local)
      });
    } else if (field === FIELD.Body) {
      const body = bodyPlanForField({ baseLocal, baseRemote, local, remote });
      conflictCount += body.conflictCount;
      fields.push({
        ...common,
        kind: body.conflictCount > 0
          ? ThreeWayFieldKind.Conflict
          : ThreeWayFieldKind.AutoMerged,
        ...(body.conflictCount === 0
          ? { merged: { present: true, value: body.parts.map(part =>
            part.kind === 'merged' ? part.value : '').join('') } }
          : {}),
        body
      });
    } else {
      conflictCount += 1;
      fields.push({ ...common, kind: ThreeWayFieldKind.Conflict });
    }
  });
  return { fields, conflictCount, excludedFields };
}

export function mergeConflictId(field: PullField): string {
  return 'field:' + field;
}

function resolvedSnapshot(
  plan: ThreeWayFieldPlan,
  resolution: MergeConflictResolution | undefined
): SyncFieldSnapshot | undefined {
  if (plan.merged) return cloneSnapshot(plan.merged);
  if (!resolution || !plan.local || !plan.remote) return undefined;
  if (resolution.choice === MergeChoice.Local) return cloneSnapshot(plan.local);
  if (resolution.choice === MergeChoice.Remote) return cloneSnapshot(plan.remote);
  if (resolution.editedValue === undefined) return undefined;
  return canonicalizeField(plan.field, {
    present: true,
    value: cloneValue(resolution.editedValue)
  });
}

function resolvedBody(
  plan: ThreeWayFieldPlan,
  resolutions: Readonly<Record<string, MergeConflictResolution>>,
  unresolved: string[]
): SyncFieldSnapshot | undefined {
  if (plan.merged) return cloneSnapshot(plan.merged);
  if (!plan.body) return undefined;
  let value = '';
  plan.body.parts.forEach(part => {
    if (part.kind === 'merged') {
      value += part.value;
      return;
    }
    const resolution = resolutions[part.conflict.id];
    if (!resolution) {
      unresolved.push(part.conflict.id);
      return;
    }
    if (resolution.choice === MergeChoice.Local) {
      value += part.conflict.local;
    } else if (resolution.choice === MergeChoice.Remote) {
      value += part.conflict.remote;
    } else if (typeof resolution.editedValue === 'string') {
      value += resolution.editedValue;
    } else {
      unresolved.push(part.conflict.id);
    }
  });
  return unresolved.some(id => id.startsWith('body-'))
    ? undefined
    : canonicalizeField(FIELD.Body, { present: true, value });
}

export function resolveThreeWayMergePlan(
  plan: ThreeWayMergePlan,
  resolutions: Readonly<Record<string, MergeConflictResolution>>
): ResolvedThreeWayMerge {
  const document: SyncDocument = { fields: {} };
  const unresolvedConflictIds: string[] = [];
  plan.fields.forEach(fieldPlan => {
    if (fieldPlan.kind === ThreeWayFieldKind.Excluded) return;
    if (fieldPlan.field === FIELD.Body && fieldPlan.body) {
      const body = resolvedBody(fieldPlan, resolutions, unresolvedConflictIds);
      if (body) document.fields[fieldPlan.field] = body;
      return;
    }
    const id = mergeConflictId(fieldPlan.field);
    const snapshot = resolvedSnapshot(fieldPlan, resolutions[id]);
    if (snapshot) {
      document.fields[fieldPlan.field] = snapshot;
    } else if (fieldPlan.kind === ThreeWayFieldKind.Conflict) {
      unresolvedConflictIds.push(id);
    }
  });
  return { document, unresolvedConflictIds };
}

function setOptionalText(
  matter: MatterData,
  key: string,
  snapshot: SyncFieldSnapshot,
  aliases: readonly string[] = []
): void {
  aliases.forEach(alias => delete matter[alias]);
  const value = String(snapshot.value);
  if (!snapshot.present || value === '') {
    delete matter[key];
  } else {
    matter[key] = value;
  }
}

/** Apply only results that differ from the reviewed local snapshot. */
export function applyResolvedMergeToMatter(
  matter: MatterData,
  plan: ThreeWayMergePlan,
  resolved: SyncDocument
): AppliedMergeMatter {
  const next: MatterData = { ...matter };
  const changedFields: PullField[] = [];
  plan.fields.forEach(fieldPlan => {
    const field = fieldPlan.field;
    if (field === FIELD.Body || !fieldPlan.local) return;
    const snapshot = resolved.fields[field];
    if (!snapshot || snapshotsEqual(field, fieldPlan.local, snapshot)) return;
    changedFields.push(field);
    switch (field) {
      case FIELD.Title:
        if (snapshot.present) next.title = String(snapshot.value);
        else delete next.title;
        break;
      case FIELD.Slug:
        setOptionalText(next, 'slug', snapshot);
        break;
      case FIELD.Excerpt:
        setOptionalText(next, 'excerpt', snapshot);
        break;
      case FIELD.Status:
        setOptionalText(next, 'status', snapshot);
        break;
      case FIELD.CommentStatus:
        setOptionalText(next, 'commentStatus', snapshot, [ 'comment_status' ]);
        break;
      case FIELD.Categories:
        if (snapshot.present) next.categories = [ ...(snapshot.value as string[]) ];
        else delete next.categories;
        break;
      case FIELD.Tags:
        next.wpTags = snapshot.present
          ? [ ...(snapshot.value as string[]) ]
          : [];
        break;
      case FIELD.FeaturedMedia:
        setOptionalText(next, 'featuredImage', snapshot);
        break;
      case FIELD.FocusKeyword:
        setOptionalText(next, 'focusKeyword', snapshot, [ 'focus_keyword' ]);
        break;
      case FIELD.MetaDescription:
        setOptionalText(next, 'metaDescription', snapshot, [ 'meta_description' ]);
        break;
      case FIELD.SecondaryTitle:
        setOptionalText(next, 'secondaryTitle', snapshot, [ 'secondary_title' ]);
        break;
    }
  });
  return { matter: next, changedFields };
}

export function syncDocumentsMatch(
  left: SyncDocument,
  right: SyncDocument,
  fields: readonly PullField[]
): boolean {
  return fields.every(field => {
    const leftSnapshot = left.fields[field];
    const rightSnapshot = right.fields[field];
    return Boolean(leftSnapshot && rightSnapshot
      && snapshotsEqual(field, leftSnapshot!, rightSnapshot!));
  });
}

export function mergePlanFields(plan: ThreeWayMergePlan): PullField[] {
  const available = new Set(plan.fields
    .filter(field => field.kind !== ThreeWayFieldKind.Excluded)
    .map(field => field.field));
  return FIELD_ORDER.filter(field => available.has(field));
}
