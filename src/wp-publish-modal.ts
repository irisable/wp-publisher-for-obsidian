import { Notice, SearchComponent, Setting } from 'obsidian';
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
  readWordPressTagsFrontMatter,
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
import {
  describeSeriesIntentForUi,
  describeSeriesIssueForUi,
  parseSeriesFrontMatter,
  resolveSeriesPublishingAvailability,
  SeriesPublishingAvailability,
  SeriesRole,
  SeriesStructure,
  type SeriesDefinition,
  type SeriesParseIssue,
  type SeriesPublishingCatalog
} from './series';
import { resolveCategoryIds } from './categories';
import { PublishPanelResource } from './publish-panel-resource';


export interface PublishModalDataSource {
  loadPostTypes: () => Promise<PostType[]>;
  loadCategories: (selected?: readonly (string | number)[]) => Promise<Term[]>;
  loadSeries: (postType: PostType, selectedSeries?: string | null) => Promise<{
    catalog: SeriesPublishingCatalog;
    editorial: EditorialMetadataCapabilities;
  }>;
}

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
  private seriesIssues: SeriesParseIssue[] = [];
  private readonly categoryResource = new PublishPanelResource<Term[]>();
  private readonly typeResource = new PublishPanelResource<PostType[]>();
  private readonly seriesResource = new PublishPanelResource<Awaited<ReturnType<PublishModalDataSource['loadSeries']>>>();
  private readonly categories = { items: [] as Term[], selected: [] as number[] };
  private editorialCapabilities: EditorialMetadataCapabilities = {
    focusKeyword: false, metaDescription: false, secondaryTitle: false
  };
  private seriesCatalog: SeriesPublishingCatalog = {
    transport: 'unsupported', definitions: [], supportedPostTypes: [], subtitlePostTypes: []
  };
  private categoryExpanded = false;
  private categoriesInitialized = false;
  private missingCategories: Array<string | number> = [];
  private categoryQuery = '';
  private seriesExpanded = false;
  private seriesQuery = '';
  private loadedSeriesType = '';
  private seriesReadyType = '';
  private closed = false;
  private refreshCategories: () => void = () => {};
  private refreshSeries: () => void = () => {};
  private refreshTypes: () => void = () => {};
  private refreshSubmit: () => void = () => {};
  private refreshEditorial: Array<() => void> = [];

  get categoryTerms(): Term[] { return this.categories.items; }

  constructor(
    readonly plugin: WordpressPlugin,
    private readonly categoryValue: unknown,
    private readonly postTypes: {
      items: PostType[],
      selected: PostType
    },
    private readonly publishTarget: PublishTarget,
    private readonly dataSource: PublishModalDataSource,
    private readonly publishingDefaults: ResolvedProfilePublishingDefaults,
    private readonly previewSource: PublishPreviewSource,
    private readonly onSubmit: (params: WordPressPostParams) => Promise<boolean>,
    private readonly matterData: MatterData,
    private readonly onDismiss: () => void,
  ) {
    super(plugin);
  }

  onOpen() {
    this.modalEl.addClass('wp-publisher-publish-modal');
    const editorialMetadata = fillExcerptFromMetaDescription(
      readEditorialFrontMatter(this.matterData)
    );
    const publishingControls = readPublishingControlFrontMatter(this.matterData);
    const series = parseSeriesFrontMatter(this.matterData);
    this.seriesIssues = [ ...series.issues ];
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
      ...(series.intent ? { seriesPlacement: series.intent } : {}),
      ...editorialMetadata
    };
    this.initialPublishingFields = {
      status: params.status,
      commentStatus: params.commentStatus,
      postType: params.postType,
      tags: [ ...params.tags ]
    };

    this.display(params);
    this.categoryResource.onChange = () => {
      if (this.categoryResource.status === 'ready' && this.categoryResource.value) {
        this.categories.items = this.categoryResource.value;
        if (!this.categoriesInitialized) {
          const values = this.initialCategoryValues();
          params.categories = resolveCategoryIds(values, this.categories.items, []);
          this.missingCategories = values.filter(value => !this.categories.items.some(term =>
            term.id === String(value) || term.slug === String(value) || term.name === String(value)
          ));
          this.categoriesInitialized = true;
        }
      }
      this.refreshCategories();
      this.refreshSubmit();
    };
    this.typeResource.onChange = () => {
      if (this.typeResource.status === 'ready') {
        this.postTypes.items = this.typeResource.value?.length
          ? this.typeResource.value : [ PostTypeConst.Post ];
      }
      this.refreshTypes();
      this.refreshSubmit();
    };
    this.seriesResource.onChange = () => {
      if (this.seriesResource.status === 'ready' && this.seriesResource.value) {
        this.seriesCatalog = this.seriesResource.value.catalog;
        this.editorialCapabilities = this.seriesResource.value.editorial;
        this.seriesReadyType = this.loadedSeriesType;
      }
      this.refreshSeries();
      this.refreshEditorial.forEach(refresh => refresh());
      this.refreshSubmit();
    };
    void this.typeResource.load(this.dataSource.loadPostTypes);
    this.loadCategories(params, true);
    this.loadSeries(params);
  }

  onClose() {
    this.closed = true;
    this.categoryResource.close();
    this.typeResource.close();
    this.seriesResource.close();
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
    this.onDismiss();
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
    this.refreshEditorial = [];
    this.refreshCategories = () => {};
    this.refreshSeries = () => {};
    this.refreshTypes = () => {};
    contentEl.empty();

    this.createHeader(this.t('publishModal_title'));
    this.createPublishTargetStatus();
    const connectionStatus = contentEl.createDiv({ cls: 'wp-publisher-catalog-status' });
    const refreshTypeStatus = () => {
      connectionStatus.empty();
      this.renderResourceStatus(connectionStatus, this.typeResource, () => {
        void this.typeResource.load(this.dataSource.loadPostTypes);
      });
      if (this.typeResource.status === 'ready' && !this.postTypes.items.includes(params.postType)) {
        connectionStatus.createDiv({ text: this.t('publishModal_postTypeMissing', { value: params.postType }) });
      }
    };
    this.refreshTypes = refreshTypeStatus;
    refreshTypeStatus();

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
            this.loadSeries(params);
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
          this.refreshTypes = () => {
            refreshTypeStatus();
            dropdown.selectEl.empty();
            [ ...new Set([ params.postType, ...this.postTypes.items ]) ]
              .forEach(it => dropdown.addOption(it, it));
            dropdown.setValue(params.postType).setDisabled(this.typeResource.status !== 'ready');
          };
          this.refreshTypes();
          dropdown
            .setValue(params.postType)
            .onChange((value) => {
              params.postType = value as PostType;
              this.loadSeries(params);
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
    const subtitleSetting = new Setting(contentSection)
      .setName(this.t('publishModal_secondaryTitle'))
      .setDesc(this.t(this.editorialCapabilities.secondaryTitle
        ? 'publishModal_secondaryTitleDesc'
        : 'publishModal_secondaryTitleUnsupported'
      ))
      .addText(text => {
        text.setPlaceholder(this.t('publishModal_secondaryTitlePlaceholder'))
          .setValue(params.secondaryTitle ?? '')
          .onChange(value => { params.secondaryTitle = value; });
        const refresh = () => {
          text.setDisabled(this.seriesReadyType !== params.postType || !this.editorialCapabilities.secondaryTitle);
          subtitleSetting.setDesc(this.t(this.seriesReadyType !== params.postType
            ? 'publishModal_catalogLoading' : this.editorialCapabilities.secondaryTitle
              ? 'publishModal_secondaryTitleDesc' : 'publishModal_secondaryTitleUnsupported'));
        };
        this.refreshEditorial.push(refresh);
      });
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
    const seoStatus = seoSection.createDiv({ cls: 'wp-publisher-capability-note' });
    this.refreshEditorial.push(() => {
      const ready = this.seriesReadyType === params.postType;
      const available = this.editorialCapabilities.focusKeyword && this.editorialCapabilities.metaDescription;
      seoStatus.setText(this.t(!ready ? 'publishModal_catalogLoading'
        : available ? 'publishModal_rankMathAvailable' : 'publishModal_rankMathUnavailable'));
      seoStatus.classList.toggle('is-available', ready && available);
      seoStatus.classList.toggle('is-unavailable', ready && !available);
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
        .onChange(value => {
          params.metaDescription = value;
        });
      text.inputEl.rows = 3;
      this.refreshEditorial.push(() => {
        text.setDisabled(this.seriesReadyType !== params.postType || !this.editorialCapabilities.metaDescription);
        metaDescriptionSetting.setDesc(this.t(this.seriesReadyType !== params.postType
          ? 'publishModal_catalogLoading' : this.editorialCapabilities.metaDescription
            ? 'publishModal_metaDescriptionDesc' : 'publishModal_metaDescriptionUnsupported'));
      });
    });
    const keywordSetting = new Setting(seoSection)
      .setName(this.t('publishModal_focusKeyword'))
      .setDesc(this.t(this.editorialCapabilities.focusKeyword
        ? 'publishModal_focusKeywordDesc'
        : 'publishModal_focusKeywordUnsupported'
      ))
      .addText(text => {
        text.setPlaceholder(this.t('publishModal_focusKeywordPlaceholder'))
          .setValue(params.focusKeyword ?? '')
          .onChange(value => { params.focusKeyword = value; });
        this.refreshEditorial.push(() => {
          text.setDisabled(this.seriesReadyType !== params.postType || !this.editorialCapabilities.focusKeyword);
          keywordSetting.setDesc(this.t(this.seriesReadyType !== params.postType
            ? 'publishModal_catalogLoading' : this.editorialCapabilities.focusKeyword
              ? 'publishModal_focusKeywordDesc' : 'publishModal_focusKeywordUnsupported'));
        });
      });
    this.refreshEditorial.forEach(refresh => refresh());

    if (!contentOnly) {
      this.renderSeriesSection(formEl, params);
    }

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

      this.renderCategorySection(taxonomySection, params);
    }

    const idleButtonText = this.getSubmitButtonText();
    const submitBar = contentEl.createDiv({ cls: 'wp-publisher-submit-bar' });
    new Setting(submitBar)
      .setDesc(this.t('publishModal_submitHint'))
      .addButton(button => button
        .setButtonText(this.t('publishModal_previewButtonText'))
        .setClass('wp-publisher-preview-button')
        .onClick(() => {
          if (!this.canSubmit(params)) {
            new Notice(this.t('publishModal_waitForCatalog'));
            return;
          }
          openPublishPreviewModal(this.plugin, {
            params: {
              ...params,
              categories: [ ...params.categories ],
              tags: [ ...params.tags ]
            },
            source: this.previewSource,
            categories: this.categories.items,
            seriesDefinitions: this.seriesCatalog.definitions
          });
        })
      )
      .addButton(button => {
        this.refreshSubmit = () => button.setDisabled(this.isSubmitting || !this.canSubmit(params));
        this.refreshSubmit();
        button
        .setButtonText(idleButtonText)
        .setClass('wp-publisher-submit-button')
        .setCta()
        .onClick(async () => {
          if (this.isSubmitting) {
            return;
          }
          if (!this.canSubmit(params)) return;
          if (this.seriesIssues.length > 0) {
            new Notice(this.t('publishModal_seriesFixFrontMatter'));
            return;
          }
          const seriesAvailability = resolveSeriesPublishingAvailability(
            this.seriesCatalog,
            params.postType
          );
          if (!contentOnly
            && params.seriesPlacement !== undefined
            && seriesAvailability !== SeriesPublishingAvailability.Available
          ) {
            new Notice(this.t(
              seriesAvailability === SeriesPublishingAvailability.TransportUnsupported
                ? 'error_seriesRequiresRestProfile'
                : 'error_seriesPostTypeUnsupported'
            ));
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
            && (
              readWordPressTagsFrontMatter(this.matterData).tags.length > 0
              || normalizeWordPressTags(this.matterData.categories).length > 0
            )
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
            const submitted = { ...params, categories: [ ...params.categories ], tags: [ ...params.tags ] };
            if (!this.editorialCapabilities.secondaryTitle) delete submitted.secondaryTitle;
            if (!this.editorialCapabilities.focusKeyword) delete submitted.focusKeyword;
            if (!this.editorialCapabilities.metaDescription) delete submitted.metaDescription;
            await this.onSubmit(submitted);
          } finally {
            this.isSubmitting = false;
            if (button.buttonEl.isConnected) {
              button
                .setDisabled(!this.canSubmit(params))
                .setButtonText(idleButtonText);
              button.buttonEl.classList.remove('is-loading');
            }
          }
        });
      });
  }

  private initialCategoryValues(): Array<string | number> {
    const raw: unknown[] = Array.isArray(this.categoryValue) ? this.categoryValue
      : this.categoryValue === undefined || this.categoryValue === null ? [] : [ this.categoryValue ];
    const values = raw.filter((value): value is string | number =>
      typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0))
      .map(value => typeof value === 'string' ? value.trim() : value);
    return values.length ? values : [ 1 ];
  }

  private canSubmit(params: WordPressPostParams): boolean {
    return this.typeResource.status === 'ready'
      && this.postTypes.items.includes(params.postType)
      && (isContentOnlyUpdate(params) || (
        this.seriesReadyType === params.postType
        && (params.postType !== PostTypeConst.Post || (
          this.categoriesInitialized && this.missingCategories.length === 0
        ))
      ));
  }

  private loadCategories(_params: WordPressPostParams, selectedOnly: boolean): void {
    if (this.closed) return;
    if (!selectedOnly) this.categoryExpanded = true;
    void this.categoryResource.load(() => this.dataSource.loadCategories(
      selectedOnly ? this.initialCategoryValues() : undefined
    ));
  }

  private loadSeries(params: WordPressPostParams, expand = false, retry = false): void {
    if (this.closed) return;
    const typeChanged = this.loadedSeriesType !== params.postType;
    if (!typeChanged && !expand && !retry) return;
    if (typeChanged) {
      this.seriesReadyType = '';
      this.seriesExpanded = false;
      this.seriesQuery = '';
      this.loadedSeriesType = params.postType;
    }
    if (expand) this.seriesExpanded = true;
    const selected = this.seriesExpanded ? undefined
      : params.seriesPlacement?.kind === 'placement' ? params.seriesPlacement.placement.series : null;
    void this.seriesResource.load(async () => {
      const result = await this.dataSource.loadSeries(params.postType, selected);
      if (result.catalog.error) throw new Error(result.catalog.error);
      return result;
    });
  }

  private renderResourceStatus<T>(parent: HTMLElement, resource: PublishPanelResource<T>, retry: () => void): void {
    if (resource.status === 'ready') return;
    const status = parent.createDiv({ cls: 'wp-publisher-catalog-status', attr: { role: 'status' } });
    if (resource.status === 'error') {
      status.createSpan({ text: this.t('publishModal_catalogError', { message: resource.error }) });
      status.createEl('button', { text: this.t('publishModal_catalogRetry') }).addEventListener('click', retry);
    } else {
      status.setText(this.t('publishModal_catalogLoading'));
    }
  }

  private renderCategorySection(parent: HTMLElement, params: WordPressPostParams): void {
    const setting = new Setting(parent).setName(this.t('publishModal_category'));
    setting.settingEl.addClass('wp-publisher-category-setting');
    const control = setting.controlEl.createDiv({ cls: 'wp-publisher-category-control' });
    const search = new SearchComponent(control.createDiv({ cls: 'wp-publisher-category-search' }))
      .setPlaceholder(this.t('publishModal_searchCategories')).setValue(this.categoryQuery);
    const browse = control.createEl('button', { cls: 'wp-publisher-catalog-browse', text: this.t('publishModal_loadAllCategories') });
    const results = control.createDiv();
    const expand = () => {
      if (!this.categoryExpanded || this.categoryResource.status === 'error') this.loadCategories(params, false);
    };
    browse.addEventListener('click', expand);
    search.onChange(query => {
      this.categoryQuery = query;
      if (query.trim()) expand();
      this.refreshCategories();
    });
    this.refreshCategories = () => {
      results.empty();
      browse.classList.toggle('is-hidden', this.categoryExpanded && this.categoryResource.status !== 'error');
      if (!this.categoriesInitialized) {
        results.createDiv({ text: this.t('publishModal_selectedCategories', { values: this.initialCategoryValues().join(', ') }) });
      }
      this.renderResourceStatus(results, this.categoryResource, () => this.loadCategories(params, !this.categoryExpanded));
      if (this.missingCategories.length) {
        results.createDiv({ cls: 'wp-publisher-series-error', text: this.t('publishModal_missingCategories', {
          values: this.missingCategories.join(', ')
        }) });
        results.createEl('button', { text: this.t('publishModal_confirmCategories') }).addEventListener('click', () => {
          this.missingCategories = [];
          this.refreshCategories();
          this.refreshSubmit();
        });
      }
      const tree = results.createDiv({ cls: 'wp-publisher-category-tree' });
      const items = buildCategoryTree(this.categories.items);
      const visible = getVisibleCategoryIds(items, this.categoryQuery, params.categories);
      items.filter(item => visible.has(String(item.category.id))).forEach(({ category, depth, path }) => {
        const id = Number(category.id);
        if (!Number.isFinite(id)) return;
        const row = tree.createEl('label', { cls: 'wp-publisher-category-row', attr: { title: path.join(' > ') } });
        for (let level = 0; level < depth; level += 1) {
          row.createSpan({ cls: 'wp-publisher-category-indent', attr: { 'aria-hidden': 'true' } });
        }
        const checkbox = row.createEl('input', { type: 'checkbox' });
        checkbox.checked = params.categories.includes(id);
        checkbox.disabled = !this.categoriesInitialized;
        checkbox.addEventListener('change', () => {
          params.categories = checkbox.checked ? [ ...new Set([ ...params.categories, id ]) ]
            : params.categories.filter(value => value !== id);
          this.refreshCategories();
        });
        row.createSpan({ text: category.name + (category.deprecated ? '（已弃用）' : '') });
      });
      if (visible.size === 0 && this.categoryResource.status === 'ready') {
        tree.createDiv({ cls: 'wp-publisher-category-empty', text: this.t('publishModal_noCategoriesFound') });
      }
    };
    this.refreshCategories();
  }

  private renderSeriesSection(
    parent: HTMLElement,
    params: WordPressPostParams
  ): void {
    const section = this.createSection(
      parent,
      this.t('publishModal_sectionSeries'),
      this.t('publishModal_sectionSeriesDesc'),
      'wp-publisher-series-card'
    );
    const search = new SearchComponent(section.createDiv({ cls: 'wp-publisher-category-search' }))
      .setPlaceholder(this.t('publishModal_searchSeries')).setValue(this.seriesQuery);
    const browse = section.createEl('button', { cls: 'wp-publisher-catalog-browse', text: this.t('publishModal_loadAllSeries') });
    const body = section.createDiv();
    const expand = () => {
      if (!this.seriesExpanded || this.seriesResource.status === 'error') this.loadSeries(params, true);
    };
    browse.addEventListener('click', expand);
    search.onChange(query => {
      this.seriesQuery = query;
      if (query.trim()) expand();
      this.refreshSeries();
    });
    this.refreshSeries = () => {
      body.empty();
      const ready = this.seriesReadyType === params.postType;
      const available = ready && resolveSeriesPublishingAvailability(this.seriesCatalog, params.postType)
        === SeriesPublishingAvailability.Available;
      browse.classList.toggle('is-hidden', (ready && !available)
        || (this.seriesExpanded && this.seriesResource.status !== 'error'));
      search.setDisabled(ready && !available);
      this.renderResourceStatus(body, this.seriesResource, () => this.loadSeries(params, false, true));
      if (!ready) {
        body.createDiv({ cls: 'wp-publisher-series-current', text: this.t('publishModal_seriesCurrent', {
          value: describeSeriesIntentForUi(params.seriesPlacement, (key, vars) => this.t(key, vars))
        }) });
        return;
      }
      this.renderSeriesFields(body, params);
    };
    this.refreshSeries();
  }

  private renderSeriesFields(section: HTMLElement, params: WordPressPostParams): void {
    const current = params.seriesPlacement;
    const availability = resolveSeriesPublishingAvailability(
      this.seriesCatalog,
      params.postType
    );
    const supported = availability === SeriesPublishingAvailability.Available;
    const availabilityKey = supported
      ? 'publishModal_seriesAvailable'
      : availability === SeriesPublishingAvailability.TransportUnsupported
        ? current
          ? 'publishModal_seriesTransportBlocked'
          : 'publishModal_seriesTransportUnavailable'
        : current
          ? 'publishModal_seriesPostTypeBlocked'
          : 'publishModal_seriesPostTypeUnavailable';
    section.createDiv({
      cls: 'wp-publisher-capability-note '
        + (supported ? 'is-available' : 'is-unavailable'),
      text: this.t(availabilityKey)
    });
    if (this.seriesCatalog.error) {
      section.createDiv({
        cls: 'wp-publisher-series-error',
        text: this.t('publishModal_seriesCatalogError', {
          message: this.seriesCatalog.error
        })
      });
    }
    if (this.seriesIssues.length > 0) {
      const errors = section.createDiv({ cls: 'wp-publisher-series-error' });
      errors.createEl('strong', { text: this.t('publishModal_seriesFrontMatterError') });
      errors.createEl('p', {
        text: this.seriesIssues.map(item => describeSeriesIssueForUi(
          item,
          (key, vars) => this.t(key, vars)
        )).join(' ')
      });
    }

    section.createDiv({
      cls: 'wp-publisher-series-current',
      text: this.t('publishModal_seriesCurrent', {
        value: describeSeriesIntentForUi(
          current,
          (key, vars) => this.t(key, vars),
          this.seriesCatalog.definitions
        )
      })
    });
    const selector = section.createDiv({ cls: 'wp-publisher-series-selector' });
    const choices: Array<{
      id: string;
      label: string;
      definition?: SeriesDefinition;
      action: 'keep' | 'clear' | 'select';
    }> = [];
    if (params.postId) {
      choices.push({
        id: '__keep__',
        label: this.t('publishModal_seriesKeep'),
        action: 'keep'
      }, {
        id: '__clear__',
        label: this.t('publishModal_seriesClear'),
        action: 'clear'
      });
    } else {
      choices.push({
        id: '__keep__',
        label: this.t('publishModal_seriesNone'),
        action: 'keep'
      });
    }
    this.seriesCatalog.definitions
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach(definition => choices.push({
        id: definition.slug,
        label: definition.name + ' (' + definition.slug + ')',
        definition,
        action: 'select'
      }));

    const rows = selector.createDiv({ cls: 'wp-publisher-series-list' });
    const selectedId = current?.kind === 'placement'
      ? current.placement.series
      : current?.kind === 'clear'
        ? '__clear__'
        : '__keep__';
    choices.forEach(choice => {
      const row = rows.createEl('label', { cls: 'wp-publisher-series-row' });
      const query = this.seriesQuery.trim().toLocaleLowerCase();
      row.classList.toggle('is-hidden', Boolean(query) && choice.id !== selectedId
        && choice.action === 'select' && !choice.label.toLocaleLowerCase().includes(query));
      const radio = row.createEl('input', {
        attr: { type: 'radio', name: 'wp-publisher-series' }
      }) as HTMLInputElement;
      radio.checked = choice.id === selectedId;
      radio.disabled = choice.action !== 'keep' && !supported;
      row.createSpan({ text: choice.label });
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.seriesIssues = [];
        if (choice.action === 'keep') {
          delete params.seriesPlacement;
        } else if (choice.action === 'clear') {
          params.seriesPlacement = { kind: 'clear' };
        } else if (choice.definition) {
          const previous = params.seriesPlacement?.kind === 'placement'
            && params.seriesPlacement.placement.series === choice.definition.slug
            ? params.seriesPlacement.placement
            : undefined;
          params.seriesPlacement = {
            kind: 'placement',
            placement: {
              series: choice.definition.slug,
              seriesRole: SeriesRole.Article,
              ...(previous?.seriesSeason !== undefined
                ? { seriesSeason: previous.seriesSeason }
                : {}),
              ...(previous?.seriesLabel
                ? { seriesLabel: previous.seriesLabel }
                : {})
            }
          };
        }
        this.refreshSeries();
      });
    });

    if (current?.kind !== 'placement') return;
    const definition = this.seriesCatalog.definitions.find(
      item => item.slug === current.placement.series
    );
    if (!definition) {
      if (supported) {
        section.createDiv({
          cls: 'wp-publisher-series-note',
          text: this.t('publishModal_seriesNotInCatalog', {
            slug: current.placement.series
          })
        });
      }
      return;
    }
    if (current.placement.seriesRole !== SeriesRole.Article) {
      section.createDiv({
        cls: 'wp-publisher-series-error',
        text: this.t('publishModal_seriesAdvancedUnsupported')
      });
    }
    if (definition.structure === SeriesStructure.Seasoned) {
      const seasonSetting = new Setting(section)
        .setName(this.t('publishModal_seriesSeason'))
        .setDesc(this.t('publishModal_seriesSeasonDesc'));
      seasonSetting.addDropdown(dropdown => {
        dropdown.addOption('', this.t('publishModal_seriesSeasonChoose'));
        definition.seasons
          .filter(season => season.publicId !== undefined)
          .sort((left, right) => left.sort - right.sort)
          .forEach(season => dropdown.addOption(
            String(season.publicId),
            season.label + ' (#' + season.publicId + ')'
          ));
        dropdown
          .setValue(String(current.placement.seriesSeason ?? ''))
          .onChange(value => {
            const publicId = Number(value);
            if (Number.isSafeInteger(publicId) && publicId > 0) {
              current.placement.seriesSeason = publicId;
            } else {
              delete current.placement.seriesSeason;
            }
          });
      });
      if (definition.seasons.some(season => season.publicId === undefined)) {
        section.createDiv({
          cls: 'wp-publisher-series-note',
          text: this.t('publishModal_seriesLegacySeason')
        });
      }
    }
    new Setting(section)
      .setName(this.t('publishModal_seriesLabel'))
      .setDesc(this.t('publishModal_seriesLabelDesc'))
      .addText(text => text
        .setPlaceholder('15A')
        .setValue(current.placement.seriesLabel ?? '')
        .onChange(value => {
          const normalized = value.trim();
          if (normalized) current.placement.seriesLabel = normalized;
          else delete current.placement.seriesLabel;
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
