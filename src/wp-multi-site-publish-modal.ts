import { Setting, TFile } from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import type { MultiSiteTarget } from './multi-site-targets';
import {
  findMultiSiteTarget
} from './multi-site-targets';
import { processFile, openWithBrowser } from './utils';
import {
  PublishUpdateStrategy,
  type PublishUpdateStrategy as PublishUpdateStrategyValue
} from './publish-strategy';
import { getWordPressClient } from './wp-clients';
import { WordPressClientReturnCode } from './wp-client';
import { resolveProfileNoteTarget } from './profile-note-target';
import { buildCoordinatedPostParams } from './coordinated-publish';

type RowState = 'idle' | 'queued' | 'publishing' | 'success' | 'failure';

interface MultiSiteRow {
  profile: WpProfile;
  selected: boolean;
  target?: MultiSiteTarget;
  strategy: PublishUpdateStrategyValue;
  state: RowState;
  error?: string;
  warningCount?: number;
}

export function openMultiSitePublishModal(plugin: WordpressPlugin): void {
  new WpMultiSitePublishModal(plugin).open();
}

class WpMultiSitePublishModal extends AbstractModal {
  private sourceFile: TFile | null = null;
  private matter: MatterData = {};
  private sourceContent = '';
  private rows: MultiSiteRow[] = [];
  private templateId = '';
  private running = false;
  private initialized = false;
  private hasRun = false;
  private initializationError = '';
  private completedCount = 0;
  private runTotal = 0;

  constructor(plugin: WordpressPlugin) {
    super(plugin);
  }

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-multi-site-modal');
    this.render();
    void this.initialize();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async initialize(): Promise<void> {
    try {
      const file = this.plugin.app.workspace.getActiveFile();
      if (!(file instanceof TFile)) {
        throw new Error(this.t('error_noActiveFile'));
      }
      this.sourceFile = file;
      const { content, matter } = await processFile(file, this.plugin.app);
      this.sourceContent = content;
      this.matter = matter;
      this.rows = this.plugin.settings.profiles.map(profile => ({
        profile,
        selected: false,
        target: this.resolveTarget(file.path, profile),
        strategy: PublishUpdateStrategy.Full,
        state: 'idle'
      }));
    } catch (error) {
      this.initializationError = error instanceof Error
        ? error.message
        : String(error);
    }
    this.initialized = true;
    this.render();
  }

  private resolveTarget(
    notePath: string,
    profile: WpProfile
  ): MultiSiteTarget | undefined {
    return resolveProfileNoteTarget({
      store: this.plugin.settings.multiSiteTargets,
      notePath,
      profile,
      matter: this.matter,
      publishHistory: this.plugin.settings.publishHistory,
      defaultPostType: profile.publishDefaults?.postType ?? 'post'
    });
  }

  private render(): void {
    this.contentEl.empty();
    this.createHeader(this.t('multiSiteModal_title'));

    const hero = this.contentEl.createDiv({ cls: 'wp-publisher-multi-site-hero' });
    hero.createDiv({
      cls: 'wp-publisher-multi-site-eyebrow',
      text: this.t('multiSiteModal_eyebrow')
    });
    hero.createEl('p', { text: this.t('multiSiteModal_description') });
    if (this.sourceFile) {
      const note = hero.createDiv({ cls: 'wp-publisher-multi-site-note' });
      note.createEl('strong', { text: this.sourceFile.basename });
      note.createSpan({ text: this.sourceFile.path });
    }

    if (!this.initialized) {
      this.renderMessage(this.t('multiSiteModal_loading'));
      return;
    }
    if (this.initializationError) {
      this.renderMessage(this.initializationError, true);
      return;
    }
    if (this.rows.length < 2) {
      this.renderMessage(this.t('multiSiteModal_needProfiles'));
      this.renderCloseFooter();
      return;
    }

    if (this.hasRun) {
      this.renderSummary();
    } else {
      this.renderToolbar();
    }
    const list = this.contentEl.createDiv({ cls: 'wp-publisher-multi-site-list' });
    this.rows.forEach(row => this.renderRow(list, row));
    this.renderFooter();
  }

  private renderToolbar(): void {
    const toolbar = this.contentEl.createDiv({ cls: 'wp-publisher-multi-site-toolbar' });
    const templateSetting = new Setting(toolbar)
      .setName(this.t('multiSiteModal_template'))
      .setDesc(this.t('multiSiteModal_templateDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('', this.t('multiSiteModal_profileDefaults'));
        this.plugin.settings.publishingTemplates.forEach(template => {
          dropdown.addOption(template.id, template.name);
        });
        dropdown
          .setValue(this.templateId)
          .onChange(value => {
            this.templateId = value;
          });
        dropdown.setDisabled(this.running);
      });
    templateSetting.settingEl.addClass('wp-publisher-multi-site-template');

    const selection = toolbar.createDiv({ cls: 'wp-publisher-multi-site-selection' });
    selection.createSpan({
      text: this.t('multiSiteModal_selectedCount', {
        selected: String(this.selectedRows().length),
        total: String(this.rows.length)
      })
    });
    const selectAll = selection.createEl('button', {
      text: this.t('multiSiteModal_selectAll')
    });
    selectAll.disabled = this.running || this.rows.every(row => row.selected);
    selectAll.addEventListener('click', () => {
      this.rows.forEach(row => row.selected = true);
      this.render();
    });
    const clear = selection.createEl('button', {
      text: this.t('multiSiteModal_clearSelection')
    });
    clear.disabled = this.running || this.rows.every(row => !row.selected);
    clear.addEventListener('click', () => {
      this.rows.forEach(row => row.selected = false);
      this.render();
    });
  }

  private renderSummary(): void {
    const successCount = this.rows.filter(row => row.state === 'success').length;
    const failureCount = this.rows.filter(row => row.state === 'failure').length;
    const summary = this.contentEl.createDiv({
      cls: 'wp-publisher-multi-site-summary'
        + (failureCount > 0 ? ' has-failures' : ' is-complete')
    });
    summary.createEl('strong', {
      text: this.running
        ? this.t('multiSiteModal_progress', {
          completed: String(this.completedCount),
          total: String(this.runTotal)
        })
        : this.t('multiSiteModal_resultSummary', {
          success: String(successCount),
          failure: String(failureCount)
        })
    });
    summary.createSpan({
      text: this.t('multiSiteModal_resultDesc')
    });
  }

  private renderRow(parent: HTMLElement, row: MultiSiteRow): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-multi-site-card is-' + row.state
        + (row.selected ? ' is-selected' : '')
    });
    const header = card.createDiv({ cls: 'wp-publisher-multi-site-card-header' });
    const profileLabel = header.createEl('label', {
      cls: 'wp-publisher-multi-site-profile'
    });
    if (!this.hasRun) {
      const checkbox = profileLabel.createEl('input', { type: 'checkbox' });
      checkbox.checked = row.selected;
      checkbox.disabled = this.running;
      checkbox.addEventListener('change', () => {
        row.selected = checkbox.checked;
        this.render();
      });
    }
    const identity = profileLabel.createDiv();
    identity.createEl('h2', { text: row.profile.name });
    identity.createSpan({ text: this.siteLabel(row.profile.endpoint) });

    header.createSpan({
      cls: 'wp-publisher-multi-site-target '
        + (row.target ? 'is-update' : 'is-create'),
      text: row.target
        ? this.t('multiSiteModal_targetUpdate', { postId: row.target.postId })
        : this.t('multiSiteModal_targetCreate')
    });

    const details = card.createDiv({ cls: 'wp-publisher-multi-site-details' });
    details.createDiv({
      cls: 'wp-publisher-multi-site-endpoint',
      text: row.profile.endpoint,
      attr: { title: row.profile.endpoint }
    });
    if (row.target && !this.hasRun) {
      const strategy = details.createDiv({ cls: 'wp-publisher-multi-site-strategy' });
      strategy.createSpan({ text: this.t('multiSiteModal_updateScope') });
      const select = strategy.createEl('select');
      select.createEl('option', {
        value: PublishUpdateStrategy.Full,
        text: this.t('multiSiteModal_fullUpdate')
      });
      select.createEl('option', {
        value: PublishUpdateStrategy.ContentOnly,
        text: this.t('multiSiteModal_contentOnly')
      });
      select.value = row.strategy;
      select.disabled = this.running || !row.selected;
      select.addEventListener('change', () => {
        row.strategy = select.value as PublishUpdateStrategyValue;
      });
    }

    if (this.hasRun) {
      this.renderRowResult(card, row);
    }
  }

  private renderRowResult(card: HTMLElement, row: MultiSiteRow): void {
    const result = card.createDiv({ cls: 'wp-publisher-multi-site-result' });
    result.createSpan({
      cls: 'wp-publisher-multi-site-status',
      text: this.rowStatus(row)
    });
    if (row.warningCount) {
      result.createSpan({
        cls: 'wp-publisher-multi-site-warning',
        text: this.t('multiSiteModal_warningCount', {
          count: String(row.warningCount)
        })
      });
    }
    if (row.error) {
      result.createDiv({
        cls: 'wp-publisher-multi-site-error',
        text: row.error
      });
    }

    const actions = result.createDiv({ cls: 'wp-publisher-multi-site-actions' });
    if (row.state === 'failure' && !this.running) {
      const retry = actions.createEl('button', {
        text: this.t('multiSiteModal_retry')
      });
      retry.addEventListener('click', () => {
        void this.publishRows([ row ]);
      });
    }
    if (row.target) {
      const edit = actions.createEl('button', {
        cls: row.state === 'success' ? 'mod-cta' : '',
        text: this.t('multiSiteModal_editPost')
      });
      edit.addEventListener('click', () => {
        openWithBrowser(
          row.profile.endpoint.replace(/\/+$/, '') + '/wp-admin/post.php',
          { action: 'edit', post: row.target?.postId }
        );
      });
    }
  }

  private renderFooter(): void {
    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-multi-site-footer' });
    if (!this.hasRun) {
      const selected = this.selectedRows();
      const hint = footer.createSpan({
        text: selected.length < 2
          ? this.t('multiSiteModal_selectMinimum')
          : this.t('multiSiteModal_readyCount', { count: String(selected.length) })
      });
      hint.addClass(selected.length < 2 ? 'is-warning' : 'is-ready');
      const publish = footer.createEl('button', {
        cls: 'mod-cta wp-publisher-multi-site-publish',
        text: this.t('multiSiteModal_publishSelected')
      });
      publish.disabled = this.running || selected.length < 2;
      publish.addEventListener('click', () => {
        void this.publishRows(selected);
      });
      return;
    }

    const failures = this.rows.filter(row => row.state === 'failure');
    if (failures.length > 0) {
      const retry = footer.createEl('button', {
        cls: 'mod-cta wp-publisher-multi-site-publish',
        text: this.t('multiSiteModal_retryFailed', {
          count: String(failures.length)
        })
      });
      retry.disabled = this.running;
      retry.addEventListener('click', () => {
        void this.publishRows(failures);
      });
    }
    const close = footer.createEl('button', {
      text: this.t('multiSiteModal_close')
    });
    close.disabled = this.running;
    close.addEventListener('click', () => this.close());
  }

  private renderCloseFooter(): void {
    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-multi-site-footer' });
    const close = footer.createEl('button', {
      text: this.t('multiSiteModal_close')
    });
    close.addEventListener('click', () => this.close());
  }

  private renderMessage(message: string, error = false): void {
    this.contentEl.createDiv({
      cls: 'wp-publisher-multi-site-message' + (error ? ' is-error' : ''),
      text: message
    });
  }

  private async publishRows(rows: MultiSiteRow[]): Promise<void> {
    if (this.running || rows.length === 0 || !this.sourceFile) {
      return;
    }
    this.running = true;
    this.hasRun = true;
    this.completedCount = 0;
    this.runTotal = rows.length;
    rows.forEach(row => {
      row.state = 'queued';
      row.error = undefined;
      row.warningCount = undefined;
    });
    this.render();

    for (const row of rows) {
      row.state = 'publishing';
      this.render();
      await this.publishRow(row);
      this.completedCount += 1;
      this.render();
    }
    this.running = false;
    this.render();
  }

  private async publishRow(row: MultiSiteRow): Promise<void> {
    if (!this.sourceFile) {
      row.state = 'failure';
      row.error = this.t('error_noActiveFile');
      return;
    }
    const client = getWordPressClient(this.plugin, row.profile);
    if (!client) {
      row.state = 'failure';
      row.error = this.t('multiSiteModal_clientUnavailable');
      return;
    }

    const template = this.plugin.settings.publishingTemplates.find(
      item => item.id === this.templateId
    );
    const params = buildCoordinatedPostParams({
      profile: row.profile,
      globalDefaults: {
        status: this.plugin.settings.defaultPostStatus,
        commentStatus: this.plugin.settings.defaultCommentStatus
      },
      matter: this.matter,
      template,
      target: row.target,
      updateStrategy: row.strategy
    });

    const result = await client.publishPost(params, {
      sourceFile: this.sourceFile,
      sourceSnapshot: {
        title: this.sourceFile.basename,
        content: this.sourceContent,
        matter: this.matter
      },
      target: row.target
        ? {
          mode: 'update',
          postId: row.target.postId,
          postType: row.target.postType
        }
        : { mode: 'create' },
      writeBackToNote: false,
      replaceMediaLinks: false,
      showNotices: false,
      showEditConfirm: false
    });
    if (result.code === WordPressClientReturnCode.Error) {
      row.state = 'failure';
      row.error = result.error.message;
      return;
    }

    row.state = 'success';
    row.warningCount = result.data.warnings?.length;
    row.target = findMultiSiteTarget(
      this.plugin.settings.multiSiteTargets,
      this.sourceFile.path,
      row.profile.id
    ) ?? {
      profileId: row.profile.id,
      profileName: row.profile.name,
      endpoint: row.profile.endpoint,
      postId: result.data.postId,
      postType: params.postType,
      updatedAt: new Date().toISOString()
    };
  }

  private selectedRows(): MultiSiteRow[] {
    return this.rows.filter(row => row.selected);
  }

  private rowStatus(row: MultiSiteRow): string {
    switch (row.state) {
      case 'queued':
        return this.t('multiSiteModal_statusQueued');
      case 'publishing':
        return this.t('multiSiteModal_statusPublishing');
      case 'success':
        return this.t('multiSiteModal_statusSuccess', {
          postId: row.target?.postId ?? ''
        });
      case 'failure':
        return this.t('multiSiteModal_statusFailure');
      default:
        return this.hasRun ? this.t('multiSiteModal_statusNotSelected') : '';
    }
  }

  private siteLabel(endpoint: string): string {
    try {
      return new URL(endpoint).host || endpoint;
    } catch {
      return endpoint;
    }
  }
}
