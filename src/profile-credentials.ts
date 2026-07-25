export interface RememberedProfileCredentials {
  apiType?: unknown;
  saveUsername: boolean;
  savePassword: boolean;
  username?: string;
  password?: string;
  encryptedPassword?: {
    encrypted: string;
    key?: string;
    vector?: string;
  };
  wpComOAuth2Token?: unknown;
}

/**
 * Remove credentials that the user explicitly chose not to persist.
 *
 * This is enforced at the persistence boundary so temporary login values can
 * remain in memory without leaking into the plugin's data.json.
 */
export function removeUnrememberedCredentials(
  profile: RememberedProfileCredentials
): boolean {
  let changed = false;
  if (!profile.saveUsername && profile.username !== undefined) {
    delete profile.username;
    changed = true;
  }
  if (!profile.savePassword) {
    if (profile.password !== undefined) {
      delete profile.password;
      changed = true;
    }
    if (profile.encryptedPassword !== undefined) {
      delete profile.encryptedPassword;
      changed = true;
    }
  }
  if (profile.wpComOAuth2Token !== undefined
    && profile.apiType !== 'WpComOAuth2'
  ) {
    delete profile.wpComOAuth2Token;
    changed = true;
  }
  return changed;
}
