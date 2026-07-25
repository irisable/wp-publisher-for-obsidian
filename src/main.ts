import { Notice, Plugin, TFile } from 'obsidian';
import { WordpressSettingTab } from './settings';
import { addIcons } from './icons';
import { WordPressPostParams } from './wp-client';
import { I18n } from './i18n';
import { CommentStatus, PostStatus } from './wp-api';
import { openProfileChooserModal } from './wp-profile-chooser-modal';
import { AppState } from './app-state';
import { DEFAULT_SETTINGS, SettingsVersion, upgradeSettings, WordpressPluginSettings } from './plugin-settings';
import { PassCrypto } from './pass-crypto';
import { doClientPublish, setupMarkdownParser, showError } from './utils';
import { cloneDeep } from 'lodash-es';
import { resolveProfilePublishingDefaults } from './profile-publishing-defaults';
import { normalizePublishHistory } from './publish-history';
import { openPublishHistoryModal } from './wp-publish-history-modal';
import { ensureStableProfileIds } from './profile-identity';
import {
  moveMultiSiteNoteTargets,
  normalizeMultiSiteTargets
} from './multi-site-targets';
import { openMultiSitePublishModal } from './wp-multi-site-publish-modal';
import { openBatchPublishModal } from './wp-batch-publish-modal';
import { openRemoteInspectorModal } from './wp-remote-inspector-modal';
import { openSyncConflictModal } from './wp-sync-conflict-modal';
import { openWordPressSyncModal } from './wp-sync-modal';
import {
  openPullPreviewModal,
  undoLastWordPressPull
} from './wp-pull-preview-modal';
import {
  movePullRestoreNotePaths,
  normalizePullRestoreSnapshots
} from './note-sync-transaction';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import {
  moveSyncBaselinesForNote,
  normalizeSyncBaselineCache,
  reconcileSyncBaselineProfiles
} from './sync-baseline';
import { removeUnrememberedCredentials } from './profile-credentials';

export default class WordpressPlugin extends Plugin {

  #settings: WordpressPluginSettings | undefined;
  get settings() {
    return this.#settings!;
  }

  #i18n: I18n | undefined;
  get i18n() {
    return this.#i18n!;
  }

  private ribbonWpIcon: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    // lang should be load early, but after settings
    this.#i18n = new I18n(this.#settings?.lang);

    setupMarkdownParser(this.settings);

    addIcons();

    this.registerMultiSiteTargetRename();
    this.updateRibbonIcon();

    this.addCommand({
      id: 'defaultPublish',
      name: this.#i18n.t('command_publishWithDefault'),
      editorCallback: () => {
        const defaultProfile = this.#settings?.profiles.find(it => it.isDefault);
        if (defaultProfile) {
          const defaults = resolveProfilePublishingDefaults(defaultProfile, {
            status: this.#settings?.defaultPostStatus ?? PostStatus.Draft,
            commentStatus: this.#settings?.defaultCommentStatus ?? CommentStatus.Open
          });
          const params: WordPressPostParams = {
            status: defaults.status,
            commentStatus: defaults.commentStatus,
            categories: defaultProfile.lastSelectedCategories ?? [ 1 ],
            postType: defaults.postType,
            tags: defaults.tags,
            title: '',
            content: ''
          };
          doClientPublish(this, defaultProfile, params);
        } else {
          showError(this.#i18n?.t('error_noDefaultProfile') ?? 'No default profile found.');
        }
      }
    });

    this.addCommand({
      id: 'publish',
      name: this.#i18n.t('command_publish'),
      editorCallback: () => {
        this.openProfileChooser();
      }
    });

    this.addCommand({
      id: 'publishMultiSite',
      name: this.#i18n.t('command_publishMultiSite'),
      editorCallback: () => {
        openMultiSitePublishModal(this);
      }
    });

    this.addCommand({
      id: 'publishBatch',
      name: this.#i18n.t('command_publishBatch'),
      callback: () => {
        openBatchPublishModal(this);
      }
    });

    this.addCommand({
      id: 'publishHistory',
      name: this.#i18n.t('command_publishHistory'),
      callback: () => {
        openPublishHistoryModal(this);
      }
    });

    this.addCommand({
      id: 'remoteInspector',
      name: this.#i18n.t('command_remoteInspector'),
      editorCallback: () => {
        openRemoteInspectorModal(this);
      }
    });

    this.addCommand({
      id: 'syncWithWordPress',
      name: this.#i18n.t('command_syncWithWordPress'),
      editorCallback: () => {
        openWordPressSyncModal(this);
      }
    });

    this.addCommand({
      id: 'pullChangesFromWordPress',
      name: this.#i18n.t('command_pullChanges'),
      editorCallback: () => {
        openPullPreviewModal(this);
      }
    });

    this.addCommand({
      id: 'resolveWordPressSyncConflict',
      name: this.#i18n.t('command_resolveSyncConflict'),
      editorCallback: () => {
        openSyncConflictModal(this);
      }
    });

    this.addCommand({
      id: 'undoLastWordPressPull',
      name: this.#i18n.t('command_undoPull'),
      editorCallback: () => {
        void undoLastWordPressPull(this);
      }
    });

    this.addCommand({
      id: 'clearSyncBaselines',
      name: this.#i18n.t('command_clearSyncBaselines'),
      callback: async () => {
        const count = this.settings.syncBaselineCache.entries.length;
        if (count === 0) {
          new Notice(this.i18n.t('syncBaseline_clearEmpty'));
          return;
        }
        const result = await openConfirmModal({
          message: this.i18n.t('syncBaseline_clearConfirm', {
            count: String(count)
          }),
          confirmText: this.i18n.t('syncBaseline_clearConfirmButton')
        }, this);
        if (result.code !== ConfirmCode.Confirm) {
          return;
        }
        this.settings.syncBaselineCache = { entries: [] };
        await this.saveSettings();
        new Notice(this.i18n.t('syncBaseline_clearSuccess'));
      }
    });

    this.addSettingTab(new WordpressSettingTab(this));
  }

  onunload() {
  }

  async loadSettings() {
    this.#settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const { needUpgrade, settings } = await upgradeSettings(this.#settings, SettingsVersion.V2);
    this.#settings = settings;
    this.#settings.publishHistory = normalizePublishHistory(
      this.#settings.publishHistory
    );
    this.#settings.multiSiteTargets = normalizeMultiSiteTargets(
      this.#settings.multiSiteTargets
    );
    this.#settings.pullRestoreSnapshots = normalizePullRestoreSnapshots(
      this.#settings.pullRestoreSnapshots
    );
    const rawBaselineCache = JSON.stringify(this.#settings.syncBaselineCache);
    this.#settings.syncBaselineCache = normalizeSyncBaselineCache(
      this.#settings.syncBaselineCache
    );
    const profileIdsChanged = ensureStableProfileIds(this.#settings.profiles);
    this.#settings.syncBaselineCache = reconcileSyncBaselineProfiles(
      this.#settings.syncBaselineCache,
      this.#settings.profiles
    );
    const baselineCacheChanged = rawBaselineCache
      !== JSON.stringify(this.#settings.syncBaselineCache);
    const credentialsChanged = this.#settings.profiles
      .map(profile => removeUnrememberedCredentials(profile))
      .some(Boolean);
    if (needUpgrade || profileIdsChanged || baselineCacheChanged || credentialsChanged) {
      await this.saveSettings();
    }

    const crypto = new PassCrypto();
    const count = this.#settings?.profiles.length ?? 0;
    for (let i = 0; i < count; i++) {
      const profile = this.#settings?.profiles[i];
      const enPass = profile.encryptedPassword;
      if (enPass) {
        profile.password = await crypto.decrypt(enPass.encrypted, enPass.key, enPass.vector);
      }
    }

    AppState.markdownParser.set({
      html: this.#settings?.enableHtml ?? false
    });
  }

  async saveSettings() {
    const settings = cloneDeep(this.settings);
    for (let i = 0; i < settings.profiles.length; i++) {
      const profile = settings.profiles[i];
      removeUnrememberedCredentials(profile);
      const password = profile.password;
      if (profile.savePassword && password) {
        const crypto = new PassCrypto();
        profile.encryptedPassword = await crypto.encrypt(password);
      }
      delete profile.password;
    }
    await this.saveData(settings);
  }

  updateRibbonIcon(): void {
    const ribbonIconTitle = this.#i18n?.t('ribbon_iconTitle') ?? 'Publish to WordPress';
    if (this.#settings?.showRibbonIcon) {
      if (!this.ribbonWpIcon) {
        this.ribbonWpIcon = this.addRibbonIcon('wp-logo', ribbonIconTitle, () => {
          this.openProfileChooser();
        });
      }
    } else {
      if (this.ribbonWpIcon) {
        this.ribbonWpIcon.remove();
        this.ribbonWpIcon = null;
      }
    }
  }

  private async openProfileChooser() {
    if (this.settings.profiles.length === 1) {
      doClientPublish(this, this.settings.profiles[0]);
    } else if (this.settings.profiles.length > 1) {
      const profile = await openProfileChooserModal(this);
      doClientPublish(this, profile);
    } else {
      showError(this.i18n.t('error_noProfile'));
    }
  }

  private registerMultiSiteTargetRename(): void {
    this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
      if (!(file instanceof TFile)) {
        return;
      }
      const moved = moveMultiSiteNoteTargets(
        this.settings.multiSiteTargets,
        oldPath,
        file.path
      );
      let changed = false;
      if (moved !== this.settings.multiSiteTargets) {
        this.settings.multiSiteTargets = moved;
        changed = true;
      }
      if (this.settings.pullRestoreSnapshots.some(item => item.notePath === oldPath)) {
        this.settings.pullRestoreSnapshots = movePullRestoreNotePaths(
          this.settings.pullRestoreSnapshots,
          oldPath,
          file.path
        );
        changed = true;
      }
      if (this.settings.syncBaselineCache.entries.some(
        item => item.notePath === oldPath
      )) {
        this.settings.syncBaselineCache = moveSyncBaselinesForNote(
          this.settings.syncBaselineCache,
          oldPath,
          file.path
        );
        changed = true;
      }
      if (changed) {
        await this.saveSettings();
      }
    }));
  }

}
