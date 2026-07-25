import { SearchComponent, Setting } from 'obsidian';
import WordpressPlugin from './main';
import { WordPressPostParams } from './wp-client';
import { CommentStatus, PostStatus, PostType, PostTypeConst, Term } from './wp-api';
import { MatterData } from './types';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import { AbstractModal } from './abstract-modal';
import IMask, { DynamicMaskType, InputMask } from 'imask';
import { format, parse } from 'date-fns';
import {
  fillExcerptFromMetaDescription,
  normalizeWordPressTags,
  readEditorialFrontMatter,
  readPublishingControlFrontMatter,
  readPublishFrontMatter,
} from './front-matter';
import { buildCategoryTree, getVisibleCategoryIds } from './categories';
import { PublishTarget, PublishTargetMode } from './publish-target';
import {
  scheduledPublishErrorKey,
  validateScheduledPublishInput
} from './scheduled-publish';
import type { EditorialMetadataCapabilities } from './editorial-metadata';
import {
  openPublishPreviewModal,
  PublishPreviewSource
} from './wp-publish-preview-modal';
import {
  resolvePublishingTags,
  ResolvedProfilePublishingDefaults
} from './profile-publishing-defaults';
import {
  applyPublishingTemplate,
  normalizePublishingTemplates,
  TemplatePublishingFields
} from './publishing-templates';
import {
  isContentOnlyUpdate,
  PublishUpdateStrategy
} from './publish-strategy';


const CATEGORY_SEARCH_THRESHOLD = 8;

/**
 * WordPress publish modal.
 */
export class WpPublishModal extends AbstractModal {

  private dateInputMask: InputMask<DynamicMaskType> | null = null;
  private scheduledInputEl: HTMLInputElement | null = null;
  private scheduledFeedbackEl: HTMLElement | null = null;
  private isSubmitting = false;
  private initialPublishingFields: TemplatePublishingFields | null = null;
  private selectedTemplateId = '';

  constructor(
    readonly plugin: WordpressPlugin,
    private readonly categories: {
      items: Term[],
      selected: number[]
    },
    private readonly postTypes: {
      items: PostType[],
      selected: PostType
    },
    private readonly publishTarget: PublishTarget,
    private readonly editorialCapabilities: EditorialMetadataCapabilities,
    private readonly publishingDefaults: ResolvedProfilePublishingDefaults,
    private readonly previewSource: PublishPreviewSource,
    private readonly onSubmit: (params: WordPressPostParams) => Promise<boolean>,
    private readonly matterData: MatterData,
  ) {
    super(plugin);
  }

  onOpen() {
    this.modalEl.addClass('wp-publisher-publish-modal');
    const editorialMetadata = fillExcerptFromMetaDescription(
      readEditorialFrontMatter(this.matterData)
    );
    const publishingControls = readPublishingControlFrontMatter(this.matterData);
    if (!this.editorialCapabilities.focusKeyword) {
      delete editorialMetadata.focusKeyword;
    }
    if (!this.editorialCapabilities.metaDescription) {
      delete editorialMetadata.metaDescription;
    }
    if (!this.editorialCapabilities.secondaryTitle) {
      delete editorialMetadata.secondaryTitle;
    }
    const existingPostId = (
      this.publishTarget.mode === PublishTargetMode.Update
      || this.publishTarget.mode === PublishTargetMode.MissingProfile
    ) ? this.publishTarget.postId : undefined;
    const params: WordPressPostParams = {
      status: publishingControls.status ?? this.publishingDefaults.status,
      commentStatus: publishingControls.commentStatus
        ?? this.publishingDefaults.commentStatus,
      postType: this.postTypes.selected,
      categories: this.categories.selected,
      tags: resolvePublishingTags(
        this.matterData,
        this.publishingDefaults.tags
      ),
      title: '',
      content: '',
      updateStrategy: PublishUpdateStrategy.Full,
      ...(existingPostId ? { postId: existingPostId } : {}),
      ...editorialMetadata
    };
    this.initialPublishingFields = {
      status: params.status,
      commentStatus: params.commentStatus,
      postType: params.postType,
      tags: [ ...params.tags ]
    };

    this.display(params);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.isSubmitting = false;
    this.scheduledInputEl = null;
    this.scheduledFeedbackEl = null;
    this.modalEl.classList.remove('is-content-only');
    if (this.dateInputMask) {
      this.dateInputMask.destroy();
      this.dateInputMask = null;
    }
  }

  private display(params: WordPressPostParams): void {
    const { contentEl } = this;
    const publishMetadata = readPublishFrontMatter(this.matterData);
    const contentOnly = isContentOnlyUpdate(params);
    this.modalEl.classList.toggle('is-content-only', contentOnly);

    if (this.dateInputMask) {
      this.dateInputMask.destroy();
      this.dateInputMask = null;
    }
    this.scheduledInputEl = null;
    this.scheduledFeedbackEl = null;
    contentEl.empty();

    this.createHeader(this.t('publishModal_title'));
    this.createPublishTargetStatus();

    const formEl = contentEl.createDiv({ cls: 'wp-publisher-form' });
    const publishSection = this.createSection(
      formEl,
      this.t('publishModal_sectionPublish'),
      this.t('publishModal_sectionPublishDesc'),
      'wp-publisher-publish-card'
    );

    if (params.postId) {
      const strategySetting = new Setting(publishSection)
        .setName(this.t('publishModal_updateStrategy'))
        .setDesc(this.t('publishModal_updateStrategyDesc'));
      strategySetting.settingEl.addClass('wp-publisher-update-strategy-setting');
      strategySetting.addDropdown(dropdown => dropdown
        .addOption(
          PublishUpdateStrategy.Full,
          this.t('publishModal_updateStrategyFull')
        )
        .addOption(
          PublishUpdateStrategy.ContentOnly,
          this.t('publishModal_updateStrategyContentOnly')
        )
        .setValue(params.updateStrategy ?? PublishUpdateStrategy.Full)
        .onChange(value => {
          params.updateStrategy = value as PublishUpdateStrategy;
          this.display(params);
        })
      );
      if (contentOnly) {
        publishSection.createDiv({
          cls: 'wp-publisher-content-only-note',
          text: this.t('publishModal_updateStrategyContentOnlyNote')
        });
      }
    }

    const templates = normalizePublishingTemplates(
      this.plugin.settings.publishingTemplates
    );
    if (templates.length > 0) {
      const templateSetting = new Setting(publishSection)
        .setName(this.t('publishModal_template'))
        .setDesc(this.t('publishModal_templateDesc'));
      templateSetting.settingEl.addClass('wp-publisher-template-setting');
      templateSetting.addDropdown(dropdown => {
        dropdown.addOption('', this.t('publishModal_templateNone'));
        templates.forEach(template => {
          dropdown.addOption(template.id, template.name);
        });
        dropdown
          .setValue(this.selectedTemplateId)
          .onChange(value => {
            this.selectedTemplateId = value;
            const template = templates.find(item => item.id === value);
            const initial = this.initialPublishingFields ?? {
              status: params.status,
              commentStatus: params.commentStatus,
              postType: params.postType,
              tags: [ ...params.tags ]
            };
            Object.assign(params, applyPublishingTemplate(
              initial,
              template,
              this.matterData,
              this.postTypes.items,
              publishMetadata.postType
            ));
            this.display(params);
          });
      });
    }

    new Setting(publishSection)
      .setName(this.t('publishModal_postStatus'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption(PostStatus.Draft, this.t('publishModal_postStatusDraft'))
          .addOption(PostStatus.Publish, this.t('publishModal_postStatusPublish'))
          .addOption(PostStatus.Private, this.t('publishModal_postStatusPrivate'))
          .addOption(PostStatus.Future, this.t('publishModal_postStatusFuture'))
          .setValue(params.status)
          .onChange((value) => {
            params.status = value as PostStatus;
            this.display(params);
          });
      });

    if (params.status === PostStatus.Future) {
      const dateTimeSetting = new Setting(publishSection)
        .setName(this.t('publishModal_postDateTime'))
        .setDesc(this.t('publishModal_postDateTimeDesc'));
      dateTimeSetting.settingEl.addClass('wp-publisher-schedule-setting');
      dateTimeSetting.addText(text => {
        const dateFormat = 'yyyy-MM-dd';
        const dateTimeFormat = 'yyyy-MM-dd HH:mm:ss';
        const dateBlocks = {
          yyyy: {
            mask: IMask.MaskedRange,
            from: 1970,
            to: 9999,
          },
          MM: {
            mask: IMask.MaskedRange,
            from: 1,
            to: 12,
          },
          dd: {
            mask: IMask.MaskedRange,
            from: 1,
            to: 31,
          },
        };
        const dateMask = {
          mask: Date,
          lazy: false,
          overwrite: true,
        };
        const masks: DynamicMaskType = [
          {
            ...dateMask,
            pattern: dateFormat,
            blocks: dateBlocks,
            format: (date: Date | null) => date ? format(date, dateFormat) : '',
            parse: (str: string) => parse(str, dateFormat, new Date())
          },
          {
            ...dateMask,
            pattern: dateTimeFormat,
            blocks: {
              ...dateBlocks,
              HH: {
                mask: IMask.MaskedRange,
                from: 0,
                to: 23,
              },
              mm: {
                mask: IMask.MaskedRange,
                from: 0,
                to: 59,
              },
              ss: {
                mask: IMask.MaskedRange,
                from: 0,
                to: 59,
              },
            },
            format: (date: Date | null) => date ? format(date, dateTimeFormat) : '',
            parse: (str: string) => parse(str, dateTimeFormat, new Date())
          }
        ];
        this.scheduledInputEl = text.inputEl;
        const dateInputMask = IMask(text.inputEl, masks);
        this.dateInputMask = dateInputMask;

        dateInputMask.on('accept', () => {
          this.validateScheduledInput(params, false);
        });
        text.inputEl.addEventListener('blur', () => {
          this.validateScheduledInput(params, true);
        });
      });
      this.scheduledFeedbackEl = dateTimeSetting.controlEl.createDiv({
        cls: 'wp-publisher-schedule-feedback'
      });
      this.scheduledFeedbackEl.hidden = true;
    } else {
      delete params.datetime;
    }

    new Setting(publishSection)
      .setName(this.t('publishModal_commentStatus'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption(CommentStatus.Open, this.t('publishModal_commentStatusOpen'))
          .addOption(CommentStatus.Closed, this.t('publishModal_commentStatusClosed'))
          .setValue(params.commentStatus)
          .onChange((value) => {
            params.commentStatus = value as CommentStatus;
          });
      });

    if (this.publishTarget.mode !== PublishTargetMode.Update
      && this.publishTarget.mode !== PublishTargetMode.MissingProfile
    ) {
      new Setting(publishSection)
        .setName(this.t('publishModal_postType'))
        .addDropdown((dropdown) => {
          this.postTypes.items.forEach(it => {
            dropdown.addOption(it, it);
          });
          dropdown
            .setValue(params.postType)
            .onChange((value) => {
              params.postType = value as PostType;
              this.display(params);
            });
        });
    }

    const detailGrid = formEl.createDiv({ cls: 'wp-publisher-detail-grid' });
    const contentSection = this.createSection(
      detailGrid,
      this.t('publishModal_sectionContent'),
      this.t('publishModal_sectionContentDesc')
    );
    new Setting(contentSection)
      .setName(this.t('publishModal_slug'))
      .setDesc(this.t('publishModal_slugDesc'))
      .addText(text => text
        .setPlaceholder('example-post-slug')
        .setValue(params.slug ?? '')
        .onChange(value => {
          params.slug = value;
        })
      );
    new Setting(contentSection)
      .setName(this.t('publishModal_secondaryTitle'))
      .setDesc(this.t(this.editorialCapabilities.secondaryTitle
        ? 'publishModal_secondaryTitleDesc'
        : 'publishModal_secondaryTitleUnsupported'
      ))
      .addText(text => text
        .setPlaceholder(this.t('publishModal_secondaryTitlePlaceholder'))
        .setValue(params.secondaryTitle ?? '')
        .setDisabled(!this.editorialCapabilities.secondaryTitle)
        .onChange(value => {
          params.secondaryTitle = value;
        })
      );
    const excerptSetting = new Setting(contentSection)
      .setName(this.t('publishModal_excerpt'))
      .setDesc(this.t('publishModal_excerptDesc'));
    excerptSetting.settingEl.addClass('wp-publisher-editorial-setting');
    excerptSetting.addTextArea(text => {
      text
        .setPlaceholder(this.t('publishModal_excerptPlaceholder'))
        .setValue(params.excerpt ?? '')
        .onChange(value => {
          params.excerpt = value;
        });
      text.inputEl.rows = 3;
    });
    new Setting(contentSection)
      .setName(this.t('publishModal_featuredImage'))
      .setDesc(this.t('publishModal_featuredImageDesc'))
      .addText(text => text
        .setPlaceholder('images/cover.jpg')
        .setValue(params.featuredImage ?? '')
        .onChange(value => {
          params.featuredImage = value;
        })
      );

    const seoSection = this.createSection(
      detailGrid,
      this.t('publishModal_sectionSeo'),
      this.t('publishModal_sectionSeoDesc'),
      'wp-publisher-seo-card'
    );
    const seoAvailable = this.editorialCapabilities.focusKeyword
      && this.editorialCapabilities.metaDescription;
    seoSection.createDiv({
      cls: `wp-publisher-capability-note ${seoAvailable ? 'is-available' : 'is-unavailable'}`,
      text: this.t(seoAvailable
        ? 'publishModal_rankMathAvailable'
        : 'publishModal_rankMathUnavailable')
    });
    const metaDescriptionSetting = new Setting(seoSection)
      .setName(this.t('publishModal_metaDescription'))
      .setDesc(this.t(this.editorialCapabilities.metaDescription
        ? 'publishModal_metaDescriptionDesc'
        : 'publishModal_metaDescriptionUnsupported'
      ));
    metaDescriptionSetting.settingEl.addClass('wp-publisher-editorial-setting');
    metaDescriptionSetting.addTextArea(text => {
      text
        .setPlaceholder(this.t('publishModal_metaDescriptionPlaceholder'))
        .setValue(params.metaDescription ?? '')
        .setDisabled(!this.editorialCapabilities.metaDescription)
        .onChange(value => {
          params.metaDescription = value;
        });
      text.inputEl.rows = 3;
    });
    new Setting(seoSection)
      .setName(this.t('publishModal_focusKeyword'))
      .setDesc(this.t(this.editorialCapabilities.focusKeyword
        ? 'publishModal_focusKeywordDesc'
        : 'publishModal_focusKeywordUnsupported'
      ))
      .addText(text => text
        .setPlaceholder(this.t('publishModal_focusKeywordPlaceholder'))
        .setValue(params.focusKeyword ?? '')
        .setDisabled(!this.editorialCapabilities.focusKeyword)
        .onChange(value => {
          params.focusKeyword = value;
        })
      );

    if (params.postType === PostTypeConst.Post) {
      const taxonomySection = this.createSection(
        formEl,
        this.t('publishModal_sectionTaxonomy'),
        this.t('publishModal_sectionTaxonomyDesc'),
        'wp-publisher-taxonomy-card'
      );
      const tagsSetting = new Setting(taxonomySection)
        .setName(this.t('publishModal_tags'))
        .setDesc(this.t('publishModal_tagsDesc'));
      tagsSetting.settingEl.addClass('wp-publisher-tags-setting');
      tagsSetting.addText(text => text
        .setPlaceholder(this.t('publishModal_tagsPlaceholder'))
        .setValue(params.tags.join(', '))
        .onChange(value => {
          params.tags = normalizeWordPressTags(value);
        })
      );

      if (this.categories.items.length > 0) {
        const categorySetting = new Setting(taxonomySection)
          .setName(this.t('publishModal_category'));
        categorySetting.settingEl.addClass('wp-publisher-category-setting');
        const categoryItems = buildCategoryTree(this.categories.items);
        const categoryControl = categorySetting.controlEl.createDiv({
          cls: 'wp-publisher-category-control'
        });
        let categorySearch: SearchComponent | undefined;
        if (categoryItems.length > CATEGORY_SEARCH_THRESHOLD) {
          const searchContainer = categoryControl.createDiv({
            cls: 'wp-publisher-category-search'
          });
          categorySearch = new SearchComponent(searchContainer)
            .setPlaceholder(this.t('publishModal_searchCategories'));
        }
        const categoryTree = categoryControl.createDiv({
          cls: 'wp-publisher-category-tree'
        });
        const categoryRows: { id: string, row: HTMLElement }[] = [];

        categoryItems.forEach(({ category, depth, path }) => {
          const categoryId = Number(category.id);
          if (!Number.isFinite(categoryId)) {
            return;
          }
          const row = categoryTree.createEl('label', {
            cls: 'wp-publisher-category-row',
            attr: { title: path.join(' > ') }
          });
          categoryRows.push({ id: String(category.id), row });
          for (let level = 0; level < depth; level += 1) {
            row.createSpan({
              cls: 'wp-publisher-category-indent',
              attr: { 'aria-hidden': 'true' }
            });
          }
          const checkbox = row.createEl('input', { type: 'checkbox' });
          checkbox.checked = params.categories.includes(categoryId);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              if (!params.categories.includes(categoryId)) {
                params.categories = [ ...params.categories, categoryId ];
              }
            } else {
              params.categories = params.categories.filter(id => id !== categoryId);
            }
          });
          row.createSpan({ text: category.name });
        });

        const emptyState = categoryTree.createDiv({
          cls: 'wp-publisher-category-empty',
          text: this.t('publishModal_noCategoriesFound')
        });
        emptyState.hidden = true;
        categorySearch?.onChange(query => {
          const visibleIds = getVisibleCategoryIds(categoryItems, query);
          let visibleRowCount = 0;
          categoryRows.forEach(({ id, row }) => {
            const isHidden = !visibleIds.has(id);
            row.classList.toggle('is-hidden', isHidden);
            if (!isHidden) {
              visibleRowCount += 1;
            }
          });
          emptyState.hidden = visibleRowCount > 0;
        });
      }
    }

    const idleButtonText = this.getSubmitButtonText();
    const submitBar = contentEl.createDiv({ cls: 'wp-publisher-submit-bar' });
    new Setting(submitBar)
      .setDesc(this.t('publishModal_submitHint'))
      .addButton(button => button
        .setButtonText(this.t('publishModal_previewButtonText'))
        .setClass('wp-publisher-preview-button')
        .onClick(() => {
          openPublishPreviewModal(this.plugin, {
            params: {
              ...params,
              categories: [ ...params.categories ],
              tags: [ ...params.tags ]
            },
            source: this.previewSource,
            categories: this.categories.items
          });
        })
      )
      .addButton(button => button
        .setButtonText(idleButtonText)
        .setClass('wp-publisher-submit-button')
        .setCta()
        .onClick(async () => {
          if (this.isSubmitting) {
            return;
          }
          if (!contentOnly
            && params.status === PostStatus.Future
            && !this.validateScheduledInput(params, true)
          ) {
            return;
          }
          if (!contentOnly
            && publishMetadata.postType
            && publishMetadata.postType !== PostTypeConst.Post
            && (this.matterData.tags || this.matterData.categories)
          ) {
            const result = await openConfirmModal({
              message: this.t('publishModal_wrongMatterDataForPage')
            }, this.plugin);
            if (result.code !== ConfirmCode.Confirm) {
              return;
            }
          }

          this.isSubmitting = true;
          button
            .setDisabled(true)
            .setButtonText(this.t('publishModal_publishingButtonText'));
          button.buttonEl.classList.add('is-loading');
          try {
            await this.onSubmit(params);
          } finally {
            this.isSubmitting = false;
            if (button.buttonEl.isConnected) {
              button
                .setDisabled(false)
                .setButtonText(idleButtonText);
              button.buttonEl.classList.remove('is-loading');
            }
          }
        })
      );
  }

  private createSection(
    parent: HTMLElement,
    title: string,
    description: string,
    className = ''
  ): HTMLElement {
    const section = parent.createDiv({
      cls: `wp-publisher-card ${className}`.trim()
    });
    const header = section.createDiv({ cls: 'wp-publisher-card-header' });
    header.createEl('h2', { text: title });
    header.createEl('p', { text: description });
    return section.createDiv({ cls: 'wp-publisher-card-body' });
  }

  private validateScheduledInput(
    params: WordPressPostParams,
    revealError: boolean
  ): boolean {
    const maskedValue = this.dateInputMask?.value ?? this.scheduledInputEl?.value ?? '';
    const value = /\d/.test(maskedValue) ? maskedValue : '';
    const validation = validateScheduledPublishInput(value);
    if (validation.valid) {
      params.datetime = validation.date;
    } else {
      delete params.datetime;
    }

    const errorWasVisible = this.scheduledFeedbackEl?.hidden === false;
    const showError = !validation.valid && (revealError || errorWasVisible);
    this.scheduledInputEl?.classList.toggle('is-invalid', showError);
    this.scheduledInputEl?.setAttribute('aria-invalid', String(showError));
    if (this.scheduledFeedbackEl) {
      this.scheduledFeedbackEl.hidden = !showError;
      this.scheduledFeedbackEl.setText(showError && !validation.valid
        ? this.t(scheduledPublishErrorKey(validation.code))
        : '');
    }
    return validation.valid;
  }

  private createPublishTargetStatus(): void {
    const statusEl = this.contentEl.createDiv({ cls: 'wp-publisher-target-status' });
    let title: string;
    let description: string;

    switch (this.publishTarget.mode) {
      case PublishTargetMode.Update:
        title = this.t('publishModal_targetUpdateTitle', {
          postId: this.publishTarget.postId ?? ''
        });
        description = this.t('publishModal_targetUpdateDesc', {
          profileName: this.publishTarget.selectedProfileName
        });
        break;
      case PublishTargetMode.ProfileMismatch:
        statusEl.addClass('is-warning');
        title = this.t('publishModal_targetProfileMismatchTitle');
        description = this.t('publishModal_targetProfileMismatchDesc', {
          storedProfileName: this.publishTarget.storedProfileName ?? '',
          selectedProfileName: this.publishTarget.selectedProfileName,
          postId: this.publishTarget.postId ?? ''
        });
        break;
      case PublishTargetMode.MissingProfile:
        statusEl.addClass('is-warning');
        title = this.t('publishModal_targetMissingProfileTitle');
        description = this.t('publishModal_targetMissingProfileDesc', {
          selectedProfileName: this.publishTarget.selectedProfileName,
          postId: this.publishTarget.postId ?? ''
        });
        break;
      case PublishTargetMode.InvalidPostId:
        statusEl.addClass('is-warning');
        title = this.t('publishModal_targetInvalidPostIdTitle');
        description = this.t('publishModal_targetInvalidPostIdDesc', {
          selectedProfileName: this.publishTarget.selectedProfileName,
          postId: this.publishTarget.rawPostId ?? ''
        });
        break;
      default:
        title = this.t('publishModal_targetCreateTitle');
        description = this.t('publishModal_targetCreateDesc', {
          profileName: this.publishTarget.selectedProfileName
        });
    }

    statusEl.createDiv({ cls: 'wp-publisher-target-title', text: title });
    statusEl.createDiv({ cls: 'wp-publisher-target-description', text: description });
    const lastPublish = readPublishFrontMatter(this.matterData);
    if (lastPublish.lastPublishedAt && lastPublish.lastPublishAction) {
      const lastPublishedDate = new Date(lastPublish.lastPublishedAt);
      if (!Number.isNaN(lastPublishedDate.getTime())) {
        statusEl.createDiv({
          cls: 'wp-publisher-target-history',
          text: this.t('publishModal_lastPublished', {
            date: lastPublishedDate.toLocaleString(),
            action: this.publishActionLabel(lastPublish.lastPublishAction)
          })
        });
      }
    }
  }

  private publishActionLabel(action: string): string {
    switch (action) {
      case 'create':
        return this.t('historyModal_actionCreate');
      case 'content-only':
        return this.t('historyModal_actionContentOnly');
      default:
        return this.t('historyModal_actionFullUpdate');
    }
  }

  private getSubmitButtonText(): string {
    switch (this.publishTarget.mode) {
      case PublishTargetMode.Update:
        return this.t('publishModal_updateButtonText', {
          postId: this.publishTarget.postId ?? ''
        });
      case PublishTargetMode.ProfileMismatch:
        return this.t('publishModal_createCurrentButtonText');
      case PublishTargetMode.MissingProfile:
        return this.t('publishModal_confirmUpdateButtonText', {
          postId: this.publishTarget.postId ?? ''
        });
      default:
        return this.t('publishModal_createButtonText');
    }
  }

}
