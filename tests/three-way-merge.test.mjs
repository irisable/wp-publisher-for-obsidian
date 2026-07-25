import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyResolvedMergeToMatter,
  createThreeWayMergePlan,
  MergeChoice,
  mergeBodyThreeWay,
  mergeConflictId,
  resolveThreeWayMergePlan,
  ThreeWayFieldKind
} from '../src/three-way-merge.ts';
import {
  createOrUpdateSyncBaseline
} from '../src/sync-baseline.ts';
import { PullField } from '../src/sync-diff.ts';
import { protectWordPressSource } from '../src/wordpress-block-parser.ts';

function snapshot(value, present = true) {
  return { present, value };
}

function document(values) {
  return {
    fields: Object.fromEntries(Object.entries(values).map(([ field, value ]) => [
      field,
      snapshot(value)
    ]))
  };
}

function baseline(local, remote = local) {
  return createOrUpdateSyncBaseline({
    identity: {
      notePath: 'posts/example.md',
      profileId: 'profile-a',
      profileName: 'Site A',
      profileEndpoint: 'https://example.com',
      postId: '42',
      postType: 'post'
    },
    local: document(local),
    remote: document(remote),
    fields: Object.keys(local),
    now: '2026-07-21T00:00:00.000Z'
  });
}

test('auto-merges independent metadata changes from one shared baseline', () => {
  const base = baseline({
    title: 'Base title',
    excerpt: 'Base excerpt',
    body: 'Base body'
  });
  const plan = createThreeWayMergePlan({
    baseline: base,
    local: document({
      title: 'Local title',
      excerpt: 'Base excerpt',
      body: 'Base body'
    }),
    remote: document({
      title: 'Base title',
      excerpt: 'Remote excerpt',
      body: 'Base body'
    })
  });
  const resolved = resolveThreeWayMergePlan(plan, {});
  assert.deepEqual(resolved.unresolvedConflictIds, []);
  assert.equal(resolved.document.fields.title.value, 'Local title');
  assert.equal(resolved.document.fields.excerpt.value, 'Remote excerpt');
  assert.equal(plan.conflictCount, 0);
});

test('requires a decision when both sides change one metadata field differently', () => {
  const base = baseline({ title: 'Base' });
  const plan = createThreeWayMergePlan({
    baseline: base,
    local: document({ title: 'Local' }),
    remote: document({ title: 'Remote' })
  });
  assert.equal(plan.fields[0].kind, ThreeWayFieldKind.Conflict);
  assert.deepEqual(
    resolveThreeWayMergePlan(plan, {}).unresolvedConflictIds,
    [ mergeConflictId(PullField.Title) ]
  );
  const edited = resolveThreeWayMergePlan(plan, {
    [mergeConflictId(PullField.Title)]: {
      choice: MergeChoice.Edited,
      editedValue: 'Reviewed title'
    }
  });
  assert.equal(edited.document.fields.title.value, 'Reviewed title');
});

test('treats equal simultaneous metadata edits as already resolved', () => {
  const base = baseline({ status: 'draft' });
  const plan = createThreeWayMergePlan({
    baseline: base,
    local: document({ status: 'publish' }),
    remote: document({ status: 'publish' })
  });
  assert.equal(plan.fields[0].kind, ThreeWayFieldKind.BothSame);
  assert.equal(plan.conflictCount, 0);
});

test('auto-merges non-overlapping body lines', () => {
  const plan = mergeBodyThreeWay({
    baseLocal: 'one\ntwo\nthree',
    baseRemote: 'one\ntwo\nthree',
    local: 'ONE\ntwo\nthree',
    remote: 'one\ntwo\nTHREE'
  });
  assert.equal(plan.conflictCount, 0);
  assert.equal(plan.parts.map(part => part.value ?? '').join(''), 'ONE\ntwo\nTHREE');
});

test('returns one explicit hunk for overlapping body edits', () => {
  const plan = mergeBodyThreeWay({
    baseLocal: 'one\ntwo\nthree',
    baseRemote: 'one\ntwo\nthree',
    local: 'one\nLOCAL\nthree',
    remote: 'one\nREMOTE\nthree'
  });
  assert.equal(plan.conflictCount, 1);
  const conflict = plan.parts.find(part => part.kind === 'conflict').conflict;
  assert.equal(conflict.local, 'LOCAL\n');
  assert.equal(conflict.remote, 'REMOTE\n');
});

test('keeps protected WordPress source regions indivisible', () => {
  const original = protectWordPressSource('<!-- wp:vendor/card -->A<!-- /wp:vendor/card -->', 'vendor/card');
  const changed = protectWordPressSource('<!-- wp:vendor/card -->B<!-- /wp:vendor/card -->', 'vendor/card');
  const plan = mergeBodyThreeWay({
    baseLocal: 'Before\n' + original + '\nAfter',
    baseRemote: 'Before\n' + original + '\nAfter',
    local: 'LOCAL\n' + original + '\nAfter',
    remote: 'Before\n' + changed + '\nAfter'
  });
  assert.equal(plan.conflictCount, 0);
  assert.match(plan.parts.map(part => part.value ?? '').join(''), /LOCAL/);
  assert.match(plan.parts.map(part => part.value ?? '').join(''), /wp-source:v1 vendor\/card/);

  const competing = mergeBodyThreeWay({
    baseLocal: original,
    baseRemote: original,
    local: changed,
    remote: protectWordPressSource('<!-- wp:vendor/card -->C<!-- /wp:vendor/card -->', 'vendor/card')
  });
  const conflict = competing.parts[0].conflict;
  assert.equal(competing.conflictCount, 1);
  assert.equal(conflict.containsProtectedSource, true);
  assert.equal(conflict.local, changed);
});

test('does not auto-project edits across different agreed body representations', () => {
  const plan = mergeBodyThreeWay({
    baseLocal: '![local](cover.jpg)',
    baseRemote: '![remote](https://example.com/cover.jpg)',
    local: 'Local caption\n![local](cover.jpg)',
    remote: '![remote](https://example.com/cover.jpg)\nRemote caption'
  });
  assert.equal(plan.conflictCount, 1);
  assert.equal(plan.parts[0].conflict.reason, 'different-baselines');
});

test('excludes a field unavailable from the current transport', () => {
  const base = baseline({ title: 'Base', excerpt: 'Base excerpt' });
  const plan = createThreeWayMergePlan({
    baseline: base,
    local: document({ title: 'Local', excerpt: 'Base excerpt' }),
    remote: document({ title: 'Base' })
  });
  assert.deepEqual(plan.excludedFields, [ PullField.Excerpt ]);
  assert.equal(plan.fields.find(field => field.field === PullField.Excerpt).kind, ThreeWayFieldKind.Excluded);
});

test('updates only resolved metadata that differs from the local revision', () => {
  const base = baseline({ title: 'Filename', excerpt: 'Old' });
  const plan = createThreeWayMergePlan({
    baseline: base,
    local: document({ title: 'Filename', excerpt: 'Old' }),
    remote: document({ title: 'Filename', excerpt: 'Remote' })
  });
  const resolved = resolveThreeWayMergePlan(plan, {});
  const applied = applyResolvedMergeToMatter(
    { custom: { keep: true }, excerpt: 'Old' },
    plan,
    resolved.document
  );
  assert.deepEqual(applied.matter, {
    custom: { keep: true },
    excerpt: 'Remote'
  });
  assert.deepEqual(applied.changedFields, [ PullField.Excerpt ]);
});

test('writes a merged subtitle to the canonical property and removes its alias', () => {
  const base = baseline({ secondaryTitle: 'Base subtitle' });
  const plan = createThreeWayMergePlan({
    baseline: base,
    local: document({ secondaryTitle: 'Base subtitle' }),
    remote: document({ secondaryTitle: 'Remote subtitle' })
  });
  const resolved = resolveThreeWayMergePlan(plan, {});
  const applied = applyResolvedMergeToMatter(
    { secondary_title: 'Base subtitle', custom: true },
    plan,
    resolved.document
  );
  assert.deepEqual(applied.matter, {
    secondaryTitle: 'Remote subtitle',
    custom: true
  });
  assert.deepEqual(applied.changedFields, [ PullField.SecondaryTitle ]);
});
