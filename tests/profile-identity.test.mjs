import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureStableProfileIds } from '../src/profile-identity.ts';

function profile(id) {
  return { id };
}

test('preserves valid unique profile IDs across profile renames', () => {
  const profiles = [ profile('wp-profile-stable-1') ];
  assert.equal(ensureStableProfileIds(profiles), false);
  profiles[0].name = 'Renamed profile';
  assert.equal(ensureStableProfileIds(profiles), false);
  assert.equal(profiles[0].id, 'wp-profile-stable-1');
});

test('adds missing IDs and repairs duplicate IDs without changing the first', () => {
  const generated = [ 'wp-profile-new-one', 'wp-profile-new-two' ];
  const profiles = [
    profile('wp-profile-shared'),
    profile('wp-profile-shared'),
    profile(undefined)
  ];
  assert.equal(ensureStableProfileIds(profiles, () => generated.shift()), true);
  assert.deepEqual(profiles.map(item => item.id), [
    'wp-profile-shared',
    'wp-profile-new-one',
    'wp-profile-new-two'
  ]);
});
