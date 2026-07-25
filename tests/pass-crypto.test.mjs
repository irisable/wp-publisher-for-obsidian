import test from 'node:test';
import assert from 'node:assert/strict';
import { PassCrypto } from '../src/pass-crypto.ts';

test('encrypts and decrypts a remembered password', async () => {
  const crypto = new PassCrypto();
  const encrypted = await crypto.encrypt('correct horse battery staple');

  assert.notEqual(encrypted.encrypted, 'correct horse battery staple');
  assert.equal(
    await crypto.decrypt(encrypted.encrypted, encrypted.key, encrypted.vector),
    'correct horse battery staple'
  );
});

test('decrypts a legacy fallback password when no key material exists', async () => {
  const password = '旧密码 password';
  const reversed = [ ...password ].reverse().join('');
  const encoded = Buffer.from(reversed, 'utf8').toString('base64');
  const legacyPayload = [ ...encoded ].reverse().join('');

  assert.equal(await new PassCrypto().decrypt(legacyPayload), password);
});
