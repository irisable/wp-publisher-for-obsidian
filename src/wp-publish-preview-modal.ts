import { Component, MarkdownRenderer, Setting } from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import { WordPressPostParams } from './wp-client';
import { PostStatus, Term } from './wp-api';
import { AppState } from './app-state';
import {
  renderWordPressPostContent,
  WordPressContentFormat
} from './wordpress-blocks';
import { getWordPressBlockStats } from './publish-preview';
import { extractMediaMetadataBlocks } from './media-metadata';
import {
  isContentOnlyUpdate,
  PublishUpdateStrategy
} from './publish-strategy';

export interface PublishPreviewSource {
  title: string;
  content: string;
  sourcePath: string;
}

interface PublishPreviewData {
  params: WordPressPostParams;
  source: PublishPreviewSource;
  categories: Term[];
}

export function openPublishPreviewModal(
  plugin: WordpressPlugin,
  data: PublishPreviewData
): void {
  new WpPublishPreviewModal(plugin, data).open();
}

class WpPublishPreviewModal extends AbstractModal {
  private previewComponent: Component | null = null;

  constructor(
    plugin: WordpressPlugin,
    private readonly data: PublishPreviewData
  ) {
    super(plugin);
  }

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-preview-modal');
    this.contentEl.empty();
    this.previewComponent = new Component();
    this.previewComponent.load();
    this.createHeader(this.t('previewModal_title'));

    const hero = this.contentEl.createDiv({ cls: 'wp-publisher-preview-hero' });
    hero.createDiv({
      cls: 'wp-publisher-preview-eyebrow',
      text: this.t('previewModal_eyebrow')
    });
    hero.createEl('h2', { text: this.data.source.title });
    hero.createEl('p', { text: this.t('previewModal_description') });

    const previewContent = extractMediaMetadataBlocks(
      this.data.source.content
    ).content;
    const renderedContent = renderWordPressPostContent(
      previewContent,
      AppState.markdownParser,
      this.plugin.settings.contentFormat
    );
    const stats = getWordPressBlockStats(renderedContent);
    this.renderDiagnostics(stats.blockCount, stats.customHtmlCount);

    const layout = this.contentEl.createDiv({ cls: 'wp-publisher-preview-layout' });
    this.renderMetadata(layout);

    const document = layout.createEl('article', {
      cls: 'wp-publisher-preview-document'
    });
    const documentHeader = document.createDiv({
      cls: 'wp-publisher-preview-document-header'
    });
    documentHeader.createEl('h3', { text: this.t('previewModal_body') });
    documentHeader.createEl('p', { text: this.t('previewModal_bodyHint') });
    const previewEl = document.createDiv({
      cls: 'wp-publisher-preview-body markdown-rendered'
    });
    void MarkdownRenderer.render(
      this.plugin.app,
      previewContent,
      previewEl,
      this.data.source.sourcePath,
      this.previewComponent
    );

    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-preview-footer' });
    new Setting(footer)
      .addButton(button => button
        .setButtonText(this.t('previewModal_close'))
        .setCta()
        .onClick(() => this.close())
      );
  }

  onClose(): void {
    this.previewComponent?.unload();
    this.previewComponent = null;
    this.contentEl.empty();
  }

  private renderDiagnostics(blockCount: number, customHtmlCount: number): void {
    const diagnostics = this.contentEl.createDiv({
      cls: 'wp-publisher-preview-diagnostics'
    });
    this.createMetric(
      diagnostics,
      this.t('previewModal_format'),
      this.t(this.plugin.settings.contentFormat === WordPressContentFormat.BlockEditor
        ? 'settings_contentFormatBlockEditor'
        : 'settings_contentFormatClassicHtml')
    );
    this.createMetric(
      diagnostics,
      this.t('previewModal_blocks'),
      String(blockCount)
    );
    this.createMetric(
      diagnostics,
      this.t('previewModal_customHtml'),
      String(customHtmlCount),
      customHtmlCount > 0
    );

    const message = this.contentEl.createDiv({
      cls: 'wp-publisher-preview-message '
        + (customHtmlCount > 0 ? 'is-warning' : 'is-clear'),
      text: customHtmlCount > 0
        ? this.t('previewModal_customHtmlWarning', { count: String(customHtmlCount) })
        : this.t('previewModal_noCustomHtml')
    });
    message.setAttribute('role', 'status');
  }

  private createMetric(
    parent: HTMLElement,
    label: string,
    value: string,
    warning = false
  ): void {
    const metric = parent.createDiv({
      cls: ('wp-publisher-preview-metric ' + (warning ? 'is-warning' : '')).trim()
    });
    metric.createDiv({ cls: 'wp-publisher-preview-metric-label', text: label });
    metric.createDiv({ cls: 'wp-publisher-preview-metric-value', text: value });
  }

  private renderMetadata(parent: HTMLElement): void {
    const { params, categories } = this.data;
    const metadata = parent.createEl('aside', {
      cls: 'wp-publisher-preview-metadata'
    });
    metadata.createEl('h3', { text: this.t('previewModal_metadata') });

    const contentOnly = isContentOnlyUpdate(params);
    const categoryNames = categories
      .filter(term => params.categories.includes(Number(term.id)))
      .map(term => term.name)
      .join(', ');
    const values: Array<[string, string | undefined]> = [];
    if (params.postId) {
      values.push([
        this.t('publishModal_updateStrategy'),
        this.t(params.updateStrategy === PublishUpdateStrategy.ContentOnly
          ? 'publishModal_updateStrategyContentOnly'
          : 'publishModal_updateStrategyFull')
      ]);
    }
    if (!contentOnly) {
      values.push(
        [ this.t('previewModal_status'), this.getStatusLabel(params.status) ],
        [ this.t('previewModal_postType'), params.postType ],
        [ this.t('publishModal_slug'), params.slug ],
        [ this.t('publishModal_secondaryTitle'), params.secondaryTitle ],
        [ this.t('publishModal_excerpt'), params.excerpt ],
        [ this.t('previewModal_categories'), categoryNames ],
        [ this.t('publishModal_tags'), params.tags.join(', ') ],
        [ this.t('publishModal_featuredImage'), params.featuredImage ],
        [ this.t('publishModal_focusKeyword'), params.focusKeyword ],
        [ this.t('publishModal_metaDescription'), params.metaDescription ]
      );
    }
    values.forEach(([ label, value ]) => {
      const row = metadata.createDiv({ cls: 'wp-publisher-preview-meta-row' });
      row.createDiv({ cls: 'wp-publisher-preview-meta-label', text: label });
      row.createDiv({
        cls: ('wp-publisher-preview-meta-value '
          + (value?.trim() ? '' : 'is-empty')).trim(),
        text: value?.trim() || this.t('previewModal_notSet')
      });
    });
  }

  private getStatusLabel(status: PostStatus): string {
    switch (status) {
      case PostStatus.Publish:
        return this.t('publishModal_postStatusPublish');
      case PostStatus.Private:
        return this.t('publishModal_postStatusPrivate');
      case PostStatus.Future:
        return this.t('publishModal_postStatusFuture');
      default:
        return this.t('publishModal_postStatusDraft');
    }
  }
}
