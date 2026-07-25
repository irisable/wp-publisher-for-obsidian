import { LanguageWithAuto } from './i18n';
import { WpProfile } from './wp-profile';
import { CommentStatus, PostStatus } from './wp-api';
import { isNil, isUndefined } from 'lodash-es';
import { PassCrypto } from './pass-crypto';
import { WP_DEFAULT_PROFILE_NAME } from './consts';
import { WordPressContentFormat } from './wordpress-blocks';
import { ApiType } from './api-types';
import type { PublishingTemplate } from './publishing-templates';
import type { PublishHistoryEntry } from './publish-history';
import type { MultiSiteTargetStore } from './multi-site-targets';
import { createProfileId } from './profile-identity';
import type { PullRestoreSnapshot } from './note-sync-transaction';
import type { SyncBaselineCache } from './sync-baseline';

export const enum SettingsVersion {
  V2 = '2'
}

export const enum MathJaxOutputType {
  TeX = 'tex',
  SVG = 'svg'
}

export const enum CommentConvertMode {
  Ignore = 'ignore',
  HTML = 'html'
}

export interface WordpressPluginSettings {

  version?: SettingsVersion;

  /**
   * Plugin language.
   */
  lang: LanguageWithAuto;

  profiles: WpProfile[];

  /** Reusable publishing presets that are independent of WordPress profiles. */
  publishingTemplates: PublishingTemplate[];

  /** Bounded local audit trail without post bodies or credentials. */
  publishHistory: PublishHistoryEntry[];

  /** Per-note WordPress targets, keyed by stable profile identity. */
  multiSiteTargets: MultiSiteTargetStore;

  /** Exact, bounded pre-pull note revisions used by guarded Undo. */
  pullRestoreSnapshots: PullRestoreSnapshot[];

  /** Bounded field-level agreement revisions for two-way sync state detection. */
  syncBaselineCache: SyncBaselineCache;

  /**
   * Show plugin icon in side.
   */
  showRibbonIcon: boolean;

  /**
   * Default post status.
   */
  defaultPostStatus: PostStatus;

  /**
   * Default comment status.
   */
  defaultCommentStatus: CommentStatus;

  /**
   * Remember last selected post categories.
   */
  rememberLastSelectedCategories: boolean;

  /**
   * If WordPress edit confirm modal will be shown when published successfully.
   */
  showWordPressEditConfirm: boolean;

  /** Format stored in WordPress post_content. */
  contentFormat: WordPressContentFormat;

  mathJaxOutputType: MathJaxOutputType;

  commentConvertMode: CommentConvertMode;

  enableHtml: boolean;

  /**
   * Whether media links should be replaced after uploading to WordPress.
   */
  replaceMediaLinks: boolean;
}

export const DEFAULT_SETTINGS: WordpressPluginSettings = {
  lang: 'auto',
  profiles: [],
  publishingTemplates: [],
  publishHistory: [],
  multiSiteTargets: {},
  pullRestoreSnapshots: [],
  syncBaselineCache: { entries: [] },
  showRibbonIcon: true,
  defaultPostStatus: PostStatus.Draft,
  defaultCommentStatus: CommentStatus.Open,
  rememberLastSelectedCategories: true,
  showWordPressEditConfirm: false,
  contentFormat: WordPressContentFormat.BlockEditor,
  mathJaxOutputType: MathJaxOutputType.SVG,
  commentConvertMode: CommentConvertMode.Ignore,
  enableHtml: false,
  replaceMediaLinks: true,
}

interface LegacyWordpressPluginSettings
  extends Partial<WordpressPluginSettings> {
  endpoint?: string;
  apiType?: ApiType;
  xmlRpcPath?: string;
  username?: string;
  password?: string;
  lastSelectedCategories?: number[];
}

export async function upgradeSettings(
  existingSettings: LegacyWordpressPluginSettings,
  to: SettingsVersion
): Promise<{ needUpgrade: boolean, settings: WordpressPluginSettings }> {
  const mergedSettings: WordpressPluginSettings = Object.assign(
    {},
    DEFAULT_SETTINGS,
    existingSettings
  );
  if (isUndefined(existingSettings.version)) {
    // V1
    if (to === SettingsVersion.V2) {
      const newSettings: WordpressPluginSettings = Object.assign({}, DEFAULT_SETTINGS, {
        version: SettingsVersion.V2,
        lang: existingSettings.lang,
        showRibbonIcon: existingSettings.showRibbonIcon
          ?? DEFAULT_SETTINGS.showRibbonIcon,
        defaultPostStatus: existingSettings.defaultPostStatus,
        defaultCommentStatus: existingSettings.defaultCommentStatus,
        defaultPostType: 'post',
        rememberLastSelectedCategories: existingSettings.rememberLastSelectedCategories,
        showWordPressEditConfirm: existingSettings.showWordPressEditConfirm,
        mathJaxOutputType: existingSettings.mathJaxOutputType,
        commentConvertMode: existingSettings.commentConvertMode,
      });
      if (existingSettings.endpoint) {
        const endpoint = existingSettings.endpoint;
        const apiType = existingSettings.apiType ?? ApiType.XML_RPC;
        const xmlRpcPath = existingSettings.xmlRpcPath;
        const username = existingSettings.username;
        const password = existingSettings.password;
        const lastSelectedCategories = existingSettings.lastSelectedCategories;
        const crypto = new PassCrypto();
        const encryptedPassword = password
          ? await crypto.encrypt(password)
          : undefined;
        const profile = {
          id: createProfileId(),
          name: WP_DEFAULT_PROFILE_NAME,
          apiType: apiType,
          endpoint: endpoint,
          xmlRpcPath: xmlRpcPath,
          saveUsername: !isNil(username),
          savePassword: !isNil(password),
          isDefault: true,
          lastSelectedCategories: lastSelectedCategories ?? [ 1 ],
          username: username,
          encryptedPassword: encryptedPassword
        };
        newSettings.profiles = [
          profile
        ];
      } else {
        newSettings.profiles = [];
      }
      return {
        needUpgrade: true,
        settings: newSettings
      };
    }
  }
  return {
    needUpgrade: false,
    settings: mergedSettings
  };
}
