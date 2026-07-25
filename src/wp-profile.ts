import type { ApiType } from './api-types';
import type { MediaCache } from './media-cache';
import type { ProfilePublishingDefaults } from './profile-publishing-defaults';

export interface WpProfile {

  /** Stable local identity that survives profile renames. */
  id: string;

  /**
   * Profile name.
   */
  name: string;

  /**
   * API type.
   */
  apiType: ApiType;

  /**
   * Endpoint.
   */
  endpoint: string;

  /**
   * XML-RPC path.
   */
  xmlRpcPath?: string;

  /**
   * WordPress username.
   */
  username?: string;

  /**
   * WordPress password.
   */
  password?: string;

  /**
   * Encrypted password which will be saved locally.
   */
  encryptedPassword?: {
    encrypted: string;
    key?: string;
    vector?: string;
  };

  /** Saved token retained only for legacy WordPress.com profile compatibility. */
  wpComOAuth2Token?: LegacyWordPressOAuth2Token;

  /**
   * Save username to local data.
   */
  saveUsername: boolean;

  /**
   * Save user password to local data.
   */
  savePassword: boolean;

  /**
   * Is default profile.
   */
  isDefault: boolean;

  /**
   * Last selected post categories.
   */
  lastSelectedCategories: number[];

  /** Uploaded media indexed by a SHA-256 content fingerprint. */
  mediaCache?: MediaCache;

  /** Vault-relative folder used only for explicit remote-media downloads. */
  syncMediaFolder?: string;

  /** Optional defaults used only when the note does not provide a value. */
  publishDefaults?: ProfilePublishingDefaults;
}

export interface LegacyWordPressOAuth2Token {
  accessToken: string;
  tokenType: string;
  blogId: string;
  blogUrl: string;
  scope: string;
}
