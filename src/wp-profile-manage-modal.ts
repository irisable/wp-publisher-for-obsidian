import { Setting } from 'obsidian';
import WordpressPlugin from './main';
import { WpProfile } from './wp-profile';
import { openProfileModal } from './wp-profile-modal';
import { isNil } from 'lodash-es';
import { rendererProfile } from './utils';
import { AbstractModal } from './abstract-modal';
import { forgetProfileMultiSiteTargets } from './multi-site-targets';
import {
  reconcileSyncBaselineProfiles,
  removeProfileSyncBaselines
} from './sync-baseline';


/**
 * WordPress profiles manage modal.
 */
export class WpProfileManageModal extends AbstractModal {

  private readonly profiles: WpProfile[];

  constructor(
    readonly plugin: WordpressPlugin
  ) {
    super(plugin);

    this.profiles = plugin.settings.profiles;
  }

  onOpen() {
    const renderProfiles = (): void => {
      content.empty();
      this.profiles.forEach((profile, index) => {
        const setting = rendererProfile(profile, content);
        if (!profile.isDefault) {
          setting
            .addButton(button => button
              .setButtonText(this.t('profilesManageModal_setDefault'))
              .onClick(() => {
                this.profiles.forEach(it => it.isDefault = false);
                profile.isDefault = true;
                renderProfiles();
                this.plugin.saveSettings().then();
              }));
        }
        setting.addButton(button => button
          .setButtonText(this.t('profilesManageModal_showDetails'))
          .onClick(async () => {
            const result = await openProfileModal(
              this.plugin,
              profile,
              index
            );
            if (!result) {
              return;
            }
            const { profile: newProfile, atIndex } = result;
            if (!isNil(atIndex) && atIndex > -1) {
              if (newProfile.isDefault) {
                this.profiles.forEach(it => it.isDefault = false);
              }
              this.profiles[atIndex] = newProfile;
              this.plugin.settings.syncBaselineCache = reconcileSyncBaselineProfiles(
                this.plugin.settings.syncBaselineCache,
                this.profiles
              );
              renderProfiles();
              this.plugin.saveSettings().then();
            }
          }));
        setting.addExtraButton(button => button
          .setIcon('lucide-trash')
          .setTooltip(this.t('profilesManageModal_deleteTooltip'))
          .onClick(() => {
            this.profiles.splice(index, 1);
            this.plugin.settings.multiSiteTargets = forgetProfileMultiSiteTargets(
              this.plugin.settings.multiSiteTargets,
              profile.id
            );
            this.plugin.settings.syncBaselineCache = removeProfileSyncBaselines(
              this.plugin.settings.syncBaselineCache,
              profile.id
            );
            if (profile.isDefault) {
              if (this.profiles.length > 0) {
                this.profiles[0].isDefault = true;
              }
            }
            renderProfiles();
            this.plugin.saveSettings().then();
          }));
      });
    }

    this.createHeader(this.t('profilesManageModal_title'));

    const { contentEl } = this;
    new Setting(contentEl)
      .setName(this.t('profilesManageModal_create'))
      .setDesc(this.t('profilesManageModal_createDesc'))
      .addButton(button => button
        .setButtonText(this.t('profilesManageModal_create'))
        .setCta()
        .onClick(async () => {
          const result = await openProfileModal(
            this.plugin
          );
          if (!result) {
            return;
          }
          const { profile } = result;
          // if no profile, make the first one default
          if (this.profiles.length === 0) {
            profile.isDefault = true;
          }
          if (profile.isDefault) {
            this.profiles.forEach(it => it.isDefault = false);
          }
          this.profiles.push(profile);
          renderProfiles();
          await this.plugin.saveSettings();
        }));

    const content = contentEl.createEl('div');
    renderProfiles();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

}
