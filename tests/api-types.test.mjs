import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiType,
  isLegacyWordPressComApiType,
  SELECTABLE_API_TYPES
} from '../src/api-types.ts';

test('offers only release-supported API types for new profiles', () => {
  assert.deepEqual(SELECTABLE_API_TYPES, [
    ApiType.XML_RPC,
    ApiType.RestAPI_miniOrange,
    ApiType.RestApi_ApplicationPasswords
  ]);
  assert.equal(SELECTABLE_API_TYPES.includes(ApiType.Legacy_WpComOAuth2), false);
});

test('recognizes saved WordPress.com profiles only as legacy data', () => {
  assert.equal(isLegacyWordPressComApiType('WpComOAuth2'), true);
  assert.equal(isLegacyWordPressComApiType(ApiType.XML_RPC), false);
  assert.equal(isLegacyWordPressComApiType(undefined), false);
});
