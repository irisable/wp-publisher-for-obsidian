import test from 'node:test';
import assert from 'node:assert/strict';
import { removeUnrememberedCredentials } from '../src/profile-credentials.ts';

test('removes temporary credentials when remember toggles are disabled', () => {
  const profile = {
    saveUsername: false,
    savePassword: false,
    username: 'temporary-user',
    password: 'temporary-password',
    encryptedPassword: {
      encrypted: 'ciphertext',
      key: 'key',
      vector: 'vector'
    }
  };

  assert.equal(removeUnrememberedCredentials(profile), true);
  assert.equal('username' in profile, false);
  assert.equal('password' in profile, false);
  assert.equal('encryptedPassword' in profile, false);
});

test('preserves credentials only when the user chose to remember them', () => {
  const profile = {
    saveUsername: true,
    savePassword: true,
    username: 'remembered-user',
    password: 'remembered-password',
    encryptedPassword: {
      encrypted: 'ciphertext'
    }
  };

  assert.equal(removeUnrememberedCredentials(profile), false);
  assert.equal(profile.username, 'remembered-user');
  assert.equal(profile.password, 'remembered-password');
  assert.equal(profile.encryptedPassword.encrypted, 'ciphertext');
});

test('removes a legacy WordPress.com token after changing transport', () => {
  const profile = {
    apiType: 'application-passwords',
    saveUsername: true,
    savePassword: false,
    username: 'editor',
    wpComOAuth2Token: {
      accessToken: 'legacy-token'
    }
  };

  assert.equal(removeUnrememberedCredentials(profile), true);
  assert.equal('wpComOAuth2Token' in profile, false);
});

test('preserves a token only for a legacy WordPress.com profile', () => {
  const profile = {
    apiType: 'WpComOAuth2',
    saveUsername: false,
    savePassword: false,
    wpComOAuth2Token: {
      accessToken: 'legacy-token'
    }
  };

  assert.equal(removeUnrememberedCredentials(profile), false);
  assert.equal(profile.wpComOAuth2Token.accessToken, 'legacy-token');
});
