import {
  getFrontMatterInfo,
  parseYaml,
  SearchComponent,
  Setting,
  TFile,
  TFolder
} from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import type { MultiSiteTarget } from './multi-site-targets';
import { findMultiSiteTarget } from './multi-site-targets';
import {
  BatchPublishState,
  countBatchPublishStates,
  filterBatchNotePaths,
  isRetryableBatchState,
  type BatchPublishState as BatchPublishStateValue
} from './batch-publish';
import {
  PublishUpdateStrategy,
  type PublishUpdateStrategy as PublishUpdateStrategyValue
} from './publish-strategy';
import { resolveProfileNoteTarget } from './profile-note-target';
import { buildCoordinatedPostParams } from './coordinated-publish';
import { getWordPressClient } from './wp-clients';
import {
  WordPressClientReturnCode,
  type WordPressClient,
  type WordPressSourceSnapshot
} from './wp-client';
import { openWithBrowser } from './utils';

type BatchPhase = 'select' | 'review' | 'run' | 'results';

interface BatchNoteRow {
  file: TFile;
  selected: boolean;
  matter: MatterData;
  target?: MultiSiteTarget;
  strategy: PublishUpdateStrategyValue;
  state: BatchPublishStateValue;
  error?: string;
  warningCount?: number;
  snapshot?: WordPressSourceSnapshot;
}

export function openBatchPublishModal(plugin: WordpressPlugin): void {
  new WpBatchPublishModal(plugin).open();
}

class WpBatchPublishModal extends AbstractModal {
  private phase: BatchPhase = 'select';
  private rows: BatchNoteRow[] = [];
  private profileId = '';
  private templateId = '';
  private preparedProfileId = '';
  private preparedTemplateId = '';
  private folderPath = '';
  private query = '';
  private onlySelected = false;
  private preparing = false;
  private prepareCompleted = 0;
  private prepareTotal = 0;
  private running = false;
  private cancelRequested = false;
  private closed = false;
  private runCompleted = 0;
  private runTotal = 0;
  private batchClient: WordPressClient | null = null;

  constructor(plugin: WordpressPlugin) {
    super(plugin);
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass('wp-publisher-batch-modal');
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile?.parent && !activeFile.parent.isRoot()) {
      this.folderPath = activeFile.parent.path;
    }
    this.rows = this.plugin.app.vault.getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(file => ({
        file,
        selected: false,
        matter: {},
        strategy: PublishUpdateStrategy.Full,
        state: BatchPublishState.Idle
      }));
    this.render();
  }

  onClose(): void {
    this.closed = true;
    this.cancelRequested = true;
    this.contentEl.empty();
  }

  private render(): void {
    if (this.closed) {
      return;
    }
    this.contentEl.empty();
    this.createHeader(this.t('batchModal_title'));
    this.renderHero();

    if (this.plugin.settings.profiles.length === 0) {
      this.renderMessage(this.t('error_noProfile'));
      this.renderSimpleCloseFooter();
      return;
    }
    if (this.rows.length === 0) {
      this.renderMessage(this.t('batchModal_noNotes'));
      this.renderSimpleCloseFooter();
      return;
    }

    if (this.phase === 'select') {
      this.renderSelection();
    } else if (this.phase === 'review') {
      this.renderReview();
    } else {
      this.renderQueue();
    }
  }

  private renderHero(): void {
    const hero = this.contentEl.createDiv({ cls: 'wp-publisher-batch-hero' });
    const copy = hero.createDiv({ cls: 'wp-publisher-batch-hero-copy' });
    copy.createDiv({
      cls: 'wp-publisher-batch-eyebrow',
      text: this.t('batchModal_eyebrow')
    });
    copy.createEl('p', { text: this.t('batchModal_description') });

    const steps = hero.createDiv({ cls: 'wp-publisher-batch-steps' });
    const activeStep = this.phase === 'select' ? 0 : this.phase === 'review' ? 1 : 2;
    [
      this.t('batchModal_stepSelect'),
      this.t('batchModal_stepReview'),
      this.t('batchModal_stepPublish')
    ].forEach((label, index) => {
      const step = steps.createDiv({
        cls: 'wp-publisher-batch-step'
          + (index === activeStep ? ' is-active' : '')
          + (index < activeStep ? ' is-complete' : '')
      });
      step.createSpan({ text: String(index + 1) });
      step.createEl('strong', { text: label });
    });
  }

  private renderSelection(): void {
    const controls = this.contentEl.createDiv({ cls: 'wp-publisher-batch-controls' });
    const targetSetting = new Setting(controls)
      .setName(this.t('batchModal_targetProfile'))
      .setDesc(this.t('batchModal_targetProfileDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('', this.t('batchModal_chooseProfile'));
        this.plugin.settings.profiles.forEach(profile => {
          dropdown.addOption(profile.id, profile.name + ' · ' + this.siteLabel(profile.endpoint));
        });
        dropdown.setValue(this.profileId).onChange(value => {
          this.profileId = value;
          refreshMeta();
        });
      });
    targetSetting.settingEl.addClass('wp-publisher-batch-setting');

    const templateSetting = new Setting(controls)
      .setName(this.t('batchModal_template'))
      .setDesc(this.t('batchModal_templateDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('', this.t('multiSiteModal_profileDefaults'));
        this.plugin.settings.publishingTemplates.forEach(template => {
          dropdown.addOption(template.id, template.name);
        });
        dropdown.setValue(this.templateId).onChange(value => {
          this.templateId = value;
        });
      });
    templateSetting.settingEl.addClass('wp-publisher-batch-setting');

    const folderSetting = new Setting(controls)
      .setName(this.t('batchModal_folder'))
      .setDesc(this.t('batchModal_folderDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('', this.t('batchModal_entireVault'));
        this.folders().forEach(folder => {
          dropdown.addOption(folder.path, folder.path);
        });
        dropdown.setValue(this.folderPath).onChange(value => {
          this.folderPath = value;
          refreshList();
        });
      });
    folderSetting.settingEl.addClass('wp-publisher-batch-setting');

    const browser = this.contentEl.createDiv({ cls: 'wp-publisher-batch-browser' });
    const toolbar = browser.createDiv({ cls: 'wp-publisher-batch-toolbar' });
    const searchHost = toolbar.createDiv({ cls: 'wp-publisher-batch-search' });
    new SearchComponent(searchHost)
      .setPlaceholder(this.t('batchModal_searchPlaceholder'))
      .setValue(this.query)
      .onChange(value => {
        this.query = value;
        refreshList();
      });

    const countEl = toolbar.createSpan({ cls: 'wp-publisher-batch-count' });
    const selectVisible = toolbar.createEl('button', {
      text: this.t('batchModal_selectVisible')
    });
    const clearSelection = toolbar.createEl('button', {
      text: this.t('batchModal_clearSelection')
    });
    const toggleSelected = toolbar.createEl('button');
    const list = browser.createDiv({ cls: 'wp-publisher-batch-note-list' });

    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-batch-footer' });
    const hint = footer.createSpan();
    const review = footer.createEl('button', {
      cls: 'mod-cta wp-publisher-batch-primary',
      text: this.t('batchModal_reviewButton')
    });

    const refreshMeta = (): void => {
      const visible = this.visibleRows();
      const selected = this.selectedRows();
      countEl.setText(this.t('batchModal_selectedCount', {
        selected: String(selected.length),
        visible: String(visible.length),
        total: String(this.rows.length)
      }));
      selectVisible.disabled = visible.length === 0
        || visible.every(row => row.selected);
      clearSelection.disabled = selected.length === 0;
      toggleSelected.setText(this.onlySelected
        ? this.t('batchModal_showAll')
        : this.t('batchModal_showSelected'));
      toggleSelected.toggleClass('is-active', this.onlySelected);
      review.disabled = !this.profileId || selected.length === 0;
      hint.setText(!this.profileId
        ? this.t('batchModal_chooseProfileHint')
        : selected.length === 0
          ? this.t('batchModal_chooseNotesHint')
          : this.t('batchModal_reviewReady', { count: String(selected.length) }));
      hint.toggleClass('is-ready', Boolean(this.profileId && selected.length));
    };

    const refreshList = (): void => {
      list.empty();
      const visible = this.visibleRows();
      if (visible.length === 0) {
        list.createDiv({
          cls: 'wp-publisher-batch-empty',
          text: this.onlySelected
            ? this.t('batchModal_noSelectedNotes')
            : this.t('batchModal_noMatches')
        });
      } else {
        visible.forEach(row => {
          this.renderSelectionRow(list, row, () => {
            if (this.onlySelected) {
              refreshList();
            } else {
              refreshMeta();
            }
          });
        });
      }
      refreshMeta();
    };

    selectVisible.addEventListener('click', () => {
      this.visibleRows().forEach(row => row.selected = true);
      refreshList();
    });
    clearSelection.addEventListener('click', () => {
      this.rows.forEach(row => row.selected = false);
      refreshList();
    });
    toggleSelected.addEventListener('click', () => {
      this.onlySelected = !this.onlySelected;
      refreshList();
    });
    review.addEventListener('click', () => {
      void this.prepareReview();
    });
    refreshList();
  }

  private renderSelectionRow(
    parent: HTMLElement,
    row: BatchNoteRow,
    onChange: () => void
  ): void {
    const card = parent.createEl('label', {
      cls: 'wp-publisher-batch-note' + (row.selected ? ' is-selected' : '')
    });
    const checkbox = card.createEl('input', { type: 'checkbox' });
    checkbox.checked = row.selected;
    checkbox.addEventListener('change', () => {
      row.selected = checkbox.checked;
      card.toggleClass('is-selected', row.selected);
      onChange();
    });
    const identity = card.createDiv({ cls: 'wp-publisher-batch-note-identity' });
    identity.createEl('strong', { text: row.file.basename });
    identity.createSpan({ text: row.file.path, attr: { title: row.file.path } });
  }

  private async prepareReview(): Promise<void> {
    const rows = this.selectedRows();
    if (this.preparing || !this.profileId || rows.length === 0) {
      return;
    }
    const profile = this.plugin.settings.profiles.find(item => item.id === this.profileId);
    if (!profile) {
      return;
    }

    this.phase = 'review';
    this.preparing = true;
    this.preparedProfileId = this.profileId;
    this.preparedTemplateId = this.templateId;
    this.prepareCompleted = 0;
    this.prepareTotal = rows.length;
    rows.forEach(row => {
      row.state = BatchPublishState.Queued;
      row.error = undefined;
      row.warningCount = undefined;
      row.snapshot = undefined;
      row.target = undefined;
      row.strategy = PublishUpdateStrategy.Full;
    });
    this.render();

    for (const row of rows) {
      try {
        row.snapshot = await this.readSnapshot(row.file);
        row.matter = row.snapshot.matter;
        row.target = resolveProfileNoteTarget({
          store: this.plugin.settings.multiSiteTargets,
          notePath: row.file.path,
          profile,
          matter: row.matter,
          publishHistory: this.plugin.settings.publishHistory,
          defaultPostType: profile.publishDefaults?.postType ?? 'post'
        });
        row.state = BatchPublishState.Idle;
      } catch (error) {
        row.state = BatchPublishState.Failure;
        row.error = error instanceof Error ? error.message : String(error);
      }
      this.prepareCompleted += 1;
      this.render();
    }
    this.preparing = false;
    this.render();
  }

  private renderReview(): void {
    const rows = this.selectedRows();
    const ready = rows.filter(row => row.snapshot);
    const createCount = ready.filter(row => !row.target).length;
    const updateCount = ready.filter(row => row.target).length;
    const summary = this.contentEl.createDiv({ cls: 'wp-publisher-batch-summary' });
    const profile = this.preparedProfile();
    const summaryCopy = summary.createDiv();
    summaryCopy.createEl('strong', {
      text: this.preparing
        ? this.t('batchModal_preparing', {
          completed: String(this.prepareCompleted),
          total: String(this.prepareTotal)
        })
        : this.t('batchModal_reviewSummary', {
          create: String(createCount),
          update: String(updateCount)
        })
    });
    summaryCopy.createSpan({
      text: profile
        ? profile.name + ' · ' + this.siteLabel(profile.endpoint)
        : this.t('batchModal_profileUnavailable')
    });
    const meter = summary.createDiv({ cls: 'wp-publisher-batch-meter' });
    const fill = meter.createDiv();
    fill.style.width = this.percentage(this.prepareCompleted, this.prepareTotal);

    const notice = this.contentEl.createDiv({ cls: 'wp-publisher-batch-freeze-note' });
    notice.createEl('strong', { text: this.t('batchModal_sourceFrozenTitle') });
    notice.createSpan({ text: this.t('batchModal_sourceFrozenDesc') });

    const list = this.contentEl.createDiv({ cls: 'wp-publisher-batch-review-list' });
    rows.forEach((row, index) => this.renderReviewRow(list, row, index));

    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-batch-footer' });
    const back = footer.createEl('button', {
      text: this.t('batchModal_backSelection')
    });
    back.disabled = this.preparing;
    back.addEventListener('click', () => this.backToSelection());
    const hint = footer.createSpan({
      text: this.preparing
        ? this.t('batchModal_waitForReview')
        : this.t('batchModal_publishReady', { count: String(ready.length) })
    });
    hint.toggleClass('is-ready', !this.preparing && ready.length > 0);
    const publish = footer.createEl('button', {
      cls: 'mod-cta wp-publisher-batch-primary',
      text: this.t('batchModal_publishButton', { count: String(ready.length) })
    });
    publish.disabled = this.preparing || ready.length === 0 || !profile;
    publish.addEventListener('click', () => {
      void this.runRows(ready);
    });
  }

  private renderReviewRow(
    parent: HTMLElement,
    row: BatchNoteRow,
    index: number
  ): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-batch-review-card is-' + row.state
    });
    card.createSpan({
      cls: 'wp-publisher-batch-sequence',
      text: String(index + 1).padStart(2, '0')
    });
    const identity = card.createDiv({ cls: 'wp-publisher-batch-review-identity' });
    identity.createEl('strong', { text: row.file.basename });
    identity.createSpan({ text: row.file.path, attr: { title: row.file.path } });

    if (row.snapshot) {
      card.createSpan({
        cls: 'wp-publisher-batch-target ' + (row.target ? 'is-update' : 'is-create'),
        text: row.target
          ? this.t('multiSiteModal_targetUpdate', { postId: row.target.postId })
          : this.t('multiSiteModal_targetCreate')
      });
      if (row.target) {
        const strategy = card.createDiv({ cls: 'wp-publisher-batch-strategy' });
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
        select.disabled = this.preparing;
        select.addEventListener('change', () => {
          row.strategy = select.value as PublishUpdateStrategyValue;
        });
      }
    } else if (row.state === BatchPublishState.Queued) {
      card.createSpan({
        cls: 'wp-publisher-batch-read-state',
        text: this.t('batchModal_readingNote')
      });
    }
    if (row.error) {
      card.createDiv({ cls: 'wp-publisher-batch-error', text: row.error });
    }
  }

  private renderQueue(): void {
    const rows = this.selectedRows();
    const counts = countBatchPublishStates(rows.map(row => row.state));
    const summary = this.contentEl.createDiv({
      cls: 'wp-publisher-batch-summary'
        + (counts.failure > 0 ? ' has-failures' : '')
    });
    const copy = summary.createDiv();
    copy.createEl('strong', {
      text: this.running
        ? this.t('batchModal_progress', {
          completed: String(this.runCompleted),
          total: String(this.runTotal)
        })
        : this.t('batchModal_resultSummary', {
          success: String(counts.success),
          failure: String(counts.failure),
          skipped: String(counts.skipped)
        })
    });
    copy.createSpan({
      text: this.running
        ? this.t('batchModal_progressDesc')
        : this.t('batchModal_resultDesc')
    });
    const meter = summary.createDiv({ cls: 'wp-publisher-batch-meter' });
    const fill = meter.createDiv();
    fill.style.width = this.percentage(this.runCompleted, this.runTotal);

    const statusStrip = this.contentEl.createDiv({ cls: 'wp-publisher-batch-status-strip' });
    this.renderStateCount(statusStrip, 'is-success', this.t('batchModal_statusSuccessShort'), counts.success);
    this.renderStateCount(statusStrip, 'is-failure', this.t('batchModal_statusFailure'), counts.failure);
    this.renderStateCount(statusStrip, 'is-skipped', this.t('batchModal_statusSkipped'), counts.skipped);
    this.renderStateCount(
      statusStrip,
      'is-pending',
      this.t('batchModal_statusPending'),
      counts.queued + counts.publishing
    );

    const list = this.contentEl.createDiv({ cls: 'wp-publisher-batch-result-list' });
    rows.forEach((row, index) => this.renderResultRow(list, row, index));
    this.renderResultFooter(rows);
  }

  private renderStateCount(
    parent: HTMLElement,
    className: string,
    label: string,
    count: number
  ): void {
    const item = parent.createDiv({ cls: 'wp-publisher-batch-state-count ' + className });
    item.createEl('strong', { text: String(count) });
    item.createSpan({ text: label });
  }

  private renderResultRow(
    parent: HTMLElement,
    row: BatchNoteRow,
    index: number
  ): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-batch-result-card is-' + row.state
    });
    card.createSpan({
      cls: 'wp-publisher-batch-sequence',
      text: String(index + 1).padStart(2, '0')
    });
    const identity = card.createDiv({ cls: 'wp-publisher-batch-result-identity' });
    identity.createEl('strong', { text: row.file.basename });
    identity.createSpan({ text: row.file.path, attr: { title: row.file.path } });
    const state = card.createDiv({ cls: 'wp-publisher-batch-result-state' });
    state.createEl('strong', { text: this.rowStatus(row) });
    if (row.warningCount) {
      state.createSpan({
        text: this.t('multiSiteModal_warningCount', {
          count: String(row.warningCount)
        })
      });
    }
    if (row.error) {
      card.createDiv({ cls: 'wp-publisher-batch-error', text: row.error });
    }

    if (!this.running) {
      const actions = card.createDiv({ cls: 'wp-publisher-batch-actions' });
      const open = actions.createEl('button', { text: this.t('batchModal_openNote') });
      open.addEventListener('click', () => {
        void this.plugin.app.workspace.openLinkText(row.file.path, '', false);
      });
      if (row.target) {
        const profile = this.preparedProfile();
        const edit = actions.createEl('button', {
          text: this.t('multiSiteModal_editPost')
        });
        edit.disabled = !profile;
        edit.addEventListener('click', () => {
          if (profile) {
            this.openWordPressPost(profile, row.target);
          }
        });
      }
      if (row.snapshot && isRetryableBatchState(row.state)) {
        const retry = actions.createEl('button', {
          cls: 'mod-cta',
          text: this.t('batchModal_retryNote')
        });
        retry.addEventListener('click', () => {
          void this.runRows([ row ]);
        });
      }
    }
  }

  private renderResultFooter(rows: BatchNoteRow[]): void {
    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-batch-footer' });
    if (this.running) {
      footer.createSpan({
        text: this.cancelRequested
          ? this.t('batchModal_cancelRequested')
          : this.t('batchModal_queueSequential')
      });
      const cancel = footer.createEl('button', {
        text: this.cancelRequested
          ? this.t('batchModal_cancelRequestedButton')
          : this.t('batchModal_cancel')
      });
      cancel.disabled = this.cancelRequested;
      cancel.addEventListener('click', () => {
        this.cancelRequested = true;
        this.render();
      });
      return;
    }

    const failures = rows.filter(row =>
      row.snapshot && row.state === BatchPublishState.Failure
    );
    const skipped = rows.filter(row =>
      row.snapshot && row.state === BatchPublishState.Skipped
    );
    footer.createSpan({ text: this.t('batchModal_retryHint') });
    if (failures.length > 0) {
      const retryFailures = footer.createEl('button', {
        cls: 'mod-cta wp-publisher-batch-primary',
        text: this.t('batchModal_retryFailed', { count: String(failures.length) })
      });
      retryFailures.addEventListener('click', () => {
        void this.runRows(failures);
      });
    }
    if (skipped.length > 0) {
      const resume = footer.createEl('button', {
        cls: failures.length === 0 ? 'mod-cta wp-publisher-batch-primary' : '',
        text: this.t('batchModal_resumeSkipped', { count: String(skipped.length) })
      });
      resume.addEventListener('click', () => {
        void this.runRows(skipped);
      });
    }
    const close = footer.createEl('button', { text: this.t('multiSiteModal_close') });
    close.addEventListener('click', () => this.close());
  }

  private async runRows(rows: BatchNoteRow[]): Promise<void> {
    const queue = rows.filter(row =>
      Boolean(row.snapshot) && row.state !== BatchPublishState.Success
    );
    if (this.running || queue.length === 0) {
      return;
    }
    const profile = this.preparedProfile();
    if (!profile) {
      queue.forEach(row => {
        row.state = BatchPublishState.Failure;
        row.error = this.t('batchModal_profileUnavailable');
      });
      this.phase = 'results';
      this.render();
      return;
    }

    this.phase = 'run';
    this.running = true;
    this.cancelRequested = false;
    this.runCompleted = 0;
    this.runTotal = queue.length;
    queue.forEach(row => {
      row.state = BatchPublishState.Queued;
      row.error = undefined;
      row.warningCount = undefined;
    });
    this.render();

    this.batchClient ??= getWordPressClient(this.plugin, profile) ?? null;
    if (!this.batchClient) {
      queue.forEach(row => {
        row.state = BatchPublishState.Failure;
        row.error = this.t('multiSiteModal_clientUnavailable');
      });
      this.runCompleted = queue.length;
      this.running = false;
      this.phase = 'results';
      this.render();
      return;
    }

    try {
      for (let index = 0; index < queue.length; index++) {
        if (this.cancelRequested) {
          queue.slice(index).forEach(row => {
            row.state = BatchPublishState.Skipped;
            row.error = this.t('batchModal_cancelledReason');
          });
          this.runCompleted = queue.length;
          break;
        }
        const row = queue[index];
        row.state = BatchPublishState.Publishing;
        this.render();
        await this.publishRow(row, profile, this.batchClient);
        this.runCompleted += 1;
        this.render();
      }
    } finally {
      this.running = false;
      this.phase = 'results';
      this.render();
    }
  }

  private async publishRow(
    row: BatchNoteRow,
    profile: WpProfile,
    client: WordPressClient
  ): Promise<void> {
    if (!row.snapshot) {
      row.state = BatchPublishState.Failure;
      row.error = this.t('batchModal_snapshotUnavailable');
      return;
    }
    try {
      const template = this.plugin.settings.publishingTemplates.find(
        item => item.id === this.preparedTemplateId
      );
      const params = buildCoordinatedPostParams({
        profile,
        globalDefaults: {
          status: this.plugin.settings.defaultPostStatus,
          commentStatus: this.plugin.settings.defaultCommentStatus
        },
        matter: row.snapshot.matter,
        template,
        target: row.target,
        updateStrategy: row.strategy
      });
      const result = await client.publishPost(params, {
        sourceFile: row.file,
        sourceSnapshot: row.snapshot,
        target: row.target
          ? {
            mode: 'update',
            postId: row.target.postId,
            postType: row.target.postType
          }
          : { mode: 'create' },
        writeBackToNote: true,
        replaceMediaLinks: false,
        showNotices: false,
        showEditConfirm: false,
        reuseSession: true
      });
      if (result.code === WordPressClientReturnCode.Error) {
        row.state = BatchPublishState.Failure;
        row.error = result.error.message;
        return;
      }

      row.state = BatchPublishState.Success;
      row.warningCount = result.data.warnings?.length;
      row.target = findMultiSiteTarget(
        this.plugin.settings.multiSiteTargets,
        row.file.path,
        profile.id
      ) ?? {
        profileId: profile.id,
        profileName: profile.name,
        endpoint: profile.endpoint,
        postId: result.data.postId,
        postType: params.postType,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      row.state = BatchPublishState.Failure;
      row.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async readSnapshot(file: TFile): Promise<WordPressSourceSnapshot> {
    const raw = await this.plugin.app.vault.read(file);
    const info = getFrontMatterInfo(raw);
    let matter: MatterData = {};
    if (info.exists && info.frontmatter.trim()) {
      const parsed = parseYaml(info.frontmatter);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        matter = parsed as MatterData;
      }
    }
    return {
      title: file.basename,
      content: raw.slice(info.exists ? info.contentStart : 0).trim(),
      matter
    };
  }

  private backToSelection(): void {
    if (this.preparing || this.running) {
      return;
    }
    this.phase = 'select';
    this.preparedProfileId = '';
    this.preparedTemplateId = '';
    this.batchClient = null;
    this.rows.forEach(row => {
      row.matter = {};
      row.target = undefined;
      row.snapshot = undefined;
      row.state = BatchPublishState.Idle;
      row.error = undefined;
      row.warningCount = undefined;
      row.strategy = PublishUpdateStrategy.Full;
    });
    this.render();
  }

  private visibleRows(): BatchNoteRow[] {
    const selectedPaths = new Set(
      this.rows.filter(row => row.selected).map(row => row.file.path)
    );
    const byPath = new Map(this.rows.map(row => [ row.file.path, row ]));
    return filterBatchNotePaths(
      this.rows.map(row => row.file.path),
      {
        folderPath: this.folderPath,
        query: this.query,
        selectedPaths,
        onlySelected: this.onlySelected
      }
    ).flatMap(notePath => {
      const row = byPath.get(notePath);
      return row ? [ row ] : [];
    });
  }

  private selectedRows(): BatchNoteRow[] {
    return this.rows.filter(row => row.selected);
  }

  private folders(): TFolder[] {
    return this.plugin.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private preparedProfile(): WpProfile | undefined {
    return this.plugin.settings.profiles.find(
      profile => profile.id === this.preparedProfileId
    );
  }

  private rowStatus(row: BatchNoteRow): string {
    switch (row.state) {
      case BatchPublishState.Queued:
        return this.t('batchModal_statusQueued');
      case BatchPublishState.Publishing:
        return this.t('batchModal_statusPublishing');
      case BatchPublishState.Success:
        return this.t('batchModal_statusSuccess', {
          postId: row.target?.postId ?? ''
        });
      case BatchPublishState.Failure:
        return this.t('batchModal_statusFailure');
      case BatchPublishState.Skipped:
        return this.t('batchModal_statusSkipped');
      default:
        return this.t('batchModal_statusReady');
    }
  }

  private openWordPressPost(profile: WpProfile, target?: MultiSiteTarget): void {
    if (!target) {
      return;
    }
    openWithBrowser(
      profile.endpoint.replace(/\/+$/, '') + '/wp-admin/post.php',
      { action: 'edit', post: target.postId }
    );
  }

  private percentage(completed: number, total: number): string {
    return total > 0 ? String(Math.min(100, completed / total * 100)) + '%' : '0%';
  }

  private siteLabel(endpoint: string): string {
    try {
      return new URL(endpoint).host || endpoint;
    } catch {
      return endpoint;
    }
  }

  private renderMessage(message: string): void {
    this.contentEl.createDiv({ cls: 'wp-publisher-batch-empty', text: message });
  }

  private renderSimpleCloseFooter(): void {
    const footer = this.contentEl.createDiv({ cls: 'wp-publisher-batch-footer' });
    const close = footer.createEl('button', { text: this.t('multiSiteModal_close') });
    close.addEventListener('click', () => this.close());
  }
}
