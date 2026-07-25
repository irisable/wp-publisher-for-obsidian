import { Setting } from 'obsidian';
import WordpressPlugin from './main';
import { WpProfile } from './wp-profile';
import { isValidUrl, showError } from './utils';
import {
  ApiType,
  isLegacyWordPressComApiType,
  SELECTABLE_API_TYPES
} from './api-types';
import { AbstractModal } from './abstract-modal';
import { CommentStatus, PostStatus } from './wp-api';
import { normalizeWordPressTags } from './front-matter';
import type { ProfilePublishingDefaults } from './profile-publishing-defaults';
import { createProfileId } from './profile-identity';
import { validSyncMediaFolder } from './sync-media';


export function openProfileModal(
  plugin: WordpressPlugin,
  profile: WpProfile = {
    id: createProfileId(),
    name: '',
    apiType: ApiType.XML_RPC,
    endpoint: '',
    xmlRpcPath: '/xmlrpc.php',
    saveUsername: false,
    savePassword: false,
    isDefault: false,
    lastSelectedCategories: [ 1 ],
  },
  atIndex = -1
): Promise<{ profile: WpProfile, atIndex?: number } | undefined> {
  return new Promise(resolve => {
    const modal = new WpProfileModal(plugin, (profile, atIndex) => {
      resolve({
        profile,
        atIndex
      });
    }, () => resolve(undefined), profile, atIndex);
    modal.open();
  });
}

/**
 * WordPress profile modal.
 */
class WpProfileModal extends AbstractModal {

  private readonly profileData: WpProfile;

  private submitted = false;

  constructor(
    readonly plugin: WordpressPlugin,
    private readonly onSubmit: (profile: WpProfile, atIndex?: number) => void,
    private readonly onCancel: () => void,
    private readonly profile: WpProfile = {
      id: createProfileId(),
      name: '',
      apiType: ApiType.XML_RPC,
      endpoint: '',
      xmlRpcPath: '/xmlrpc.php',
      saveUsername: false,
      savePassword: false,
      isDefault: false,
      lastSelectedCategories: [ 1 ],
    },
    private readonly atIndex: number = -1
  ) {
    super(plugin);

    this.profileData = Object.assign({}, profile);
  }

  onOpen() {
    const getApiTypeLabel = (apiType: ApiType): string => {
      switch (apiType) {
        case ApiType.XML_RPC:
          return this.t('settings_apiTypeXmlRpc');
        case ApiType.RestAPI_miniOrange:
          return this.t('settings_apiTypeRestMiniOrange');
        case ApiType.RestApi_ApplicationPasswords:
          return this.t('settings_apiTypeRestApplicationPasswords');
        case ApiType.Legacy_WpComOAuth2:
          return this.t('settings_apiTypeRestWpComOAuth2');
        default:
          return '';
      }
    };
    const getApiTypeDesc = (apiType: ApiType): string => {
      switch (apiType) {
        case ApiType.XML_RPC:
          return this.t('settings_apiTypeXmlRpcDesc');
        case ApiType.RestAPI_miniOrange:
          return this.t('settings_apiTypeRestMiniOrangeDesc');
        case ApiType.RestApi_ApplicationPasswords:
          return this.t('settings_apiTypeRestApplicationPasswordsDesc');
        case ApiType.Legacy_WpComOAuth2:
          return this.t('settings_apiTypeRestWpComOAuth2Desc');
        default:
          return '';
      }
    };
    let apiDesc = getApiTypeDesc(this.profileData.apiType);

    const renderProfile = () => {
      content.empty();

      new Setting(content)
        .setName(this.t('profileModal_name'))
        .setDesc(this.t('profileModal_nameDesc'))
        .addText(text => text
          .setPlaceholder('Profile name')
          .setValue(this.profileData.name ?? '')
          .onChange((value) => {
            this.profileData.name = value;
          })
        );
      new Setting(content)
        .setName(this.t('settings_url'))
        .setDesc(this.t('settings_urlDesc'))
        .addText(text => text
          .setPlaceholder(this.t('settings_urlPlaceholder'))
          .setValue(this.profileData.endpoint)
          .onChange((value) => {
            if (this.profileData.endpoint !== value) {
              this.profileData.endpoint = value;
            }
          }));
      new Setting(content)
        .setName(this.t('settings_apiType'))
        .setDesc(this.t('settings_apiTypeDesc'))
        .addDropdown((dropdown) => {
          SELECTABLE_API_TYPES.forEach(apiType => {
            dropdown.addOption(apiType, getApiTypeLabel(apiType));
          });
          if (isLegacyWordPressComApiType(this.profileData.apiType)) {
            dropdown.addOption(
              ApiType.Legacy_WpComOAuth2,
              getApiTypeLabel(ApiType.Legacy_WpComOAuth2)
            );
          }
          dropdown
            .setValue(this.profileData.apiType)
            .onChange((value) => {
              this.profileData.apiType = value as ApiType;
              apiDesc = getApiTypeDesc(this.profileData.apiType);
              renderProfile();
            });
        });
      content.createEl('p', {
        text: apiDesc,
        cls: 'setting-item-description'
      });
      if (this.profileData.apiType === ApiType.XML_RPC) {
        new Setting(content)
          .setName(this.t('settings_xmlRpcPath'))
          .setDesc(this.t('settings_xmlRpcPathDesc'))
          .addText(text => text
            .setPlaceholder('/xmlrpc.php')
            .setValue(this.profileData.xmlRpcPath ?? '')
            .onChange((value) => {
              this.profileData.xmlRpcPath = value;
            }));
      } else if (isLegacyWordPressComApiType(this.profileData.apiType)) {
        new Setting(content)
          .setName(this.t('settings_wpComLegacyProfile'))
          .setDesc(this.t('settings_wpComLegacyProfileDesc'));
      }

      if (!isLegacyWordPressComApiType(this.profileData.apiType)) {
        const usernameSetting = new Setting(content)
          .setName(this.t('profileModal_rememberUsername'));
        if (this.profileData.saveUsername) {
          usernameSetting
            .addText(text => text
              .setValue(this.profileData.username ?? '')
              .onChange((value) => {
                this.profileData.username = value;
              })
            );
        }
        usernameSetting.addToggle(toggle => toggle
          .setValue(this.profileData.saveUsername)
          .onChange(save => {
            this.profileData.saveUsername = save;
            renderProfile();
          })
        );
        const passwordSetting = new Setting(content)
          .setName(this.t('profileModal_rememberPassword'));
        if (this.profileData.savePassword) {
          passwordSetting
            .addText(text => {
              text.inputEl.type = 'password';
              text
                .setValue(this.profileData.password ?? '')
                .onChange((value) => {
                this.profileData.password = value;
                });
            });
        }
        passwordSetting.addToggle(toggle => toggle
          .setValue(this.profileData.savePassword)
          .onChange(save => {
            this.profileData.savePassword = save;
            renderProfile();
          })
        );
      }

      const defaultsHeader = content.createDiv({
        cls: 'wp-publisher-profile-defaults-heading'
      });
      defaultsHeader.createEl('h3', {
        text: this.t('profileModal_publishDefaults')
      });
      defaultsHeader.createEl('p', {
        text: this.t('profileModal_publishDefaultsDesc')
      });

      new Setting(content)
        .setName(this.t('profileModal_defaultStatus'))
        .setDesc(this.t('profileModal_defaultStatusDesc'))
        .addDropdown(dropdown => dropdown
          .addOption('', this.t('profileModal_inheritGlobal'))
          .addOption(PostStatus.Draft, this.t('publishModal_postStatusDraft'))
          .addOption(PostStatus.Publish, this.t('publishModal_postStatusPublish'))
          .addOption(PostStatus.Private, this.t('publishModal_postStatusPrivate'))
          .setValue(this.profileData.publishDefaults?.status ?? '')
          .onChange(value => {
            this.updatePublishingDefaults({
              status: value ? value as PostStatus : undefined
            });
          })
        );

      new Setting(content)
        .setName(this.t('profileModal_defaultCommentStatus'))
        .setDesc(this.t('profileModal_defaultCommentStatusDesc'))
        .addDropdown(dropdown => dropdown
          .addOption('', this.t('profileModal_inheritGlobal'))
          .addOption(CommentStatus.Open, this.t('publishModal_commentStatusOpen'))
          .addOption(CommentStatus.Closed, this.t('publishModal_commentStatusClosed'))
          .setValue(this.profileData.publishDefaults?.commentStatus ?? '')
          .onChange(value => {
            this.updatePublishingDefaults({
              commentStatus: value ? value as CommentStatus : undefined
            });
          })
        );

      new Setting(content)
        .setName(this.t('profileModal_defaultPostType'))
        .setDesc(this.t('profileModal_defaultPostTypeDesc'))
        .addText(text => text
          .setPlaceholder('post')
          .setValue(this.profileData.publishDefaults?.postType ?? '')
          .onChange(value => {
            this.updatePublishingDefaults({ postType: value.trim() || undefined });
          })
        );

      new Setting(content)
        .setName(this.t('profileModal_defaultTags'))
        .setDesc(this.t('profileModal_defaultTagsDesc'))
        .addText(text => text
          .setPlaceholder(this.t('publishModal_tagsPlaceholder'))
          .setValue(this.profileData.publishDefaults?.tags?.join(', ') ?? '')
          .onChange(value => {
            const tags = normalizeWordPressTags(value);
            this.updatePublishingDefaults({ tags: tags.length > 0 ? tags : undefined });
          })
        );

      new Setting(content)
        .setName(this.t('profileModal_syncMediaFolder'))
        .setDesc(this.t('profileModal_syncMediaFolderDesc'))
        .addText(text => text
          .setPlaceholder('Attachments/WordPress')
          .setValue(this.profileData.syncMediaFolder ?? '')
          .onChange(value => {
            this.profileData.syncMediaFolder = value.trim() || undefined;
          })
        );

      new Setting(content)
        .setName(this.t('profileModal_setDefault'))
        .addToggle(toggle => toggle
          .setValue(this.profileData.isDefault)
          .onChange((value) => {
            this.profileData.isDefault = value;
          })
        );

      new Setting(content)
        .addButton(button => button
          .setButtonText(this.t('profileModal_Save'))
          .setCta()
          .onClick(() => {
            if (!isValidUrl(this.profileData.endpoint)) {
              showError(this.t('error_invalidUrl'));
            } else if (this.profileData.name.length === 0) {
              showError(this.t('error_noProfileName'));
            } else if (this.profileData.saveUsername && !this.profileData.username) {
              showError(this.t('error_noUsername'));
            } else if (this.profileData.savePassword && !this.profileData.password) {
              showError(this.t('error_noPassword'));
            } else if (isLegacyWordPressComApiType(this.profileData.apiType)
              && !this.profileData.wpComOAuth2Token
            ) {
              showError(this.t('error_invalidWpComToken'));
            } else if (this.profileData.syncMediaFolder
              && !validSyncMediaFolder(this.profileData.syncMediaFolder)
            ) {
              showError(this.t('profileModal_syncMediaFolderInvalid'));
            } else {
              this.profileData.syncMediaFolder = validSyncMediaFolder(
                this.profileData.syncMediaFolder
              );
              if (!isLegacyWordPressComApiType(this.profileData.apiType)) {
                delete this.profileData.wpComOAuth2Token;
              }
              this.submitted = true;
              this.onSubmit(this.profileData, this.atIndex);
              this.close();
            }
          })
        );
    }

    this.createHeader(this.t('profileModal_title'));

    const { contentEl } = this;

    const content = contentEl.createEl('div');
    renderProfile();
  }

  onClose() {
    if (!this.submitted) {
      this.onCancel();
    }
    const { contentEl } = this;
    contentEl.empty();
  }

  private updatePublishingDefaults(
    update: Partial<ProfilePublishingDefaults>
  ): void {
    const defaults = { ...this.profileData.publishDefaults, ...update };
    if (!defaults.status) delete defaults.status;
    if (!defaults.commentStatus) delete defaults.commentStatus;
    if (!defaults.postType) delete defaults.postType;
    if (!defaults.tags?.length) delete defaults.tags;
    this.profileData.publishDefaults = Object.keys(defaults).length > 0
      ? defaults
      : undefined;
  }

}
