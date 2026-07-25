import { SearchComponent, TFile } from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import {
  filterPublishHistory,
  normalizePublishHistory,
  PublishHistoryAction,
  PublishHistoryOutcome,
  type PublishHistoryEntry
} from './publish-history';
import { openWithBrowser } from './utils';
import { getSyncBaseline, SyncState, type SyncBaseline } from './sync-baseline';
import { syncStateLabelKey } from './sync-state-presentation';

export function openPublishHistoryModal(plugin: WordpressPlugin): void {
  new WpPublishHistoryModal(plugin).open();
}

class WpPublishHistoryModal extends AbstractModal {
  private entries: PublishHistoryEntry[] = [];

  constructor(plugin: WordpressPlugin) {
    super(plugin);
  }
  private query = '';
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private clearButtonEl: HTMLButtonElement | null = null;

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-history-modal');
    this.entries = normalizePublishHistory(this.plugin.settings.publishHistory);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.listEl = null;
    this.countEl = null;
    this.clearButtonEl = null;
  }

  private render(): void {
    this.contentEl.empty();
    this.createHeader(this.t('historyModal_title'));
    const intro = this.contentEl.createDiv({ cls: 'wp-publisher-history-intro' });
    intro.createDiv({
      cls: 'wp-publisher-history-eyebrow',
      text: this.t('historyModal_eyebrow')
    });
    intro.createEl('p', { text: this.t('historyModal_description') });

    const toolbar = this.contentEl.createDiv({ cls: 'wp-publisher-history-toolbar' });
    const searchWrap = toolbar.createDiv({ cls: 'wp-publisher-history-search' });
    new SearchComponent(searchWrap)
      .setPlaceholder(this.t('historyModal_searchPlaceholder'))
      .setValue(this.query)
      .onChange(value => {
        this.query = value;
        this.renderList();
      });
    const toolbarMeta = toolbar.createDiv({ cls: 'wp-publisher-history-toolbar-meta' });
    this.countEl = toolbarMeta.createSpan({ cls: 'wp-publisher-history-count' });
    this.clearButtonEl = toolbarMeta.createEl('button', {
      cls: 'wp-publisher-history-clear',
      text: this.t('historyModal_clear')
    });
    this.clearButtonEl.addEventListener('click', () => {
      void this.clearHistory();
    });

    this.listEl = this.contentEl.createDiv({ cls: 'wp-publisher-history-list' });
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl || !this.countEl) {
      return;
    }
    const visibleEntries = filterPublishHistory(this.entries, this.query);
    this.countEl.setText(this.t('historyModal_count', {
      visible: String(visibleEntries.length),
      total: String(this.entries.length)
    }));
    if (this.clearButtonEl) {
      this.clearButtonEl.disabled = this.entries.length === 0;
    }
    const listEl = this.listEl;
    listEl.empty();
    if (visibleEntries.length === 0) {
      listEl.createDiv({
        cls: 'wp-publisher-history-empty',
        text: this.t(this.entries.length === 0
          ? 'historyModal_empty'
          : 'historyModal_noMatches')
      });
      return;
    }
    visibleEntries.forEach(entry => this.renderEntry(listEl, entry));
  }

  private renderEntry(parent: HTMLElement, entry: PublishHistoryEntry): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-history-card '
        + (entry.outcome === PublishHistoryOutcome.Success
          ? 'is-success'
          : 'is-failure')
    });
    const header = card.createDiv({ cls: 'wp-publisher-history-card-header' });
    const titleWrap = header.createDiv({ cls: 'wp-publisher-history-card-title' });
    titleWrap.createSpan({
      cls: 'wp-publisher-history-outcome',
      text: this.outcomeLabel(entry.outcome)
    });
    titleWrap.createEl('h2', { text: entry.noteTitle });
    header.createEl('time', {
      text: this.formatTimestamp(entry.timestamp),
      attr: { datetime: entry.timestamp }
    });
    card.createDiv({
      cls: 'wp-publisher-history-path',
      text: entry.notePath,
      attr: { title: entry.notePath }
    });

    const facts = card.createDiv({ cls: 'wp-publisher-history-facts' });
    this.createFact(facts, this.t('historyModal_profile'), entry.profileName);
    this.createFact(facts, this.t('historyModal_site'), this.siteLabel(entry.endpoint));
    this.createFact(facts, this.t('historyModal_action'), this.actionLabel(entry.action));
    this.createFact(facts, this.t('historyModal_postType'), entry.postType);
    if (entry.postId) {
      this.createFact(facts, this.t('historyModal_postId'), '#' + entry.postId);
    }
    if (entry.selectedFieldCount !== undefined) {
      this.createFact(
        facts,
        this.t('historyModal_selectedFields'),
        String(entry.selectedFieldCount)
      );
    }
    if (entry.warningCount) {
      this.createFact(
        facts,
        this.t('historyModal_warnings'),
        String(entry.warningCount),
        true
      );
    }
    const baseline = this.baselineForEntry(entry);
    const observedState = baseline?.lastObservedState ?? SyncState.Unknown;
    this.createFact(
      facts,
      this.t('historyModal_syncObserved'),
      this.t(syncStateLabelKey(observedState)),
      false,
      observedState
    );
    this.createFact(
      facts,
      this.t('syncState_lastAgreed'),
      baseline
        ? this.formatTimestamp(baseline.lastAgreedAt)
        : this.t('syncState_notEstablished')
    );

    if (entry.message) {
      card.createDiv({
        cls: 'wp-publisher-history-message',
        text: entry.message
      });
    }

    const actions = card.createDiv({ cls: 'wp-publisher-history-actions' });
    const noteFile = this.plugin.app.vault.getAbstractFileByPath(entry.notePath);
    if (noteFile instanceof TFile) {
      const openNoteButton = actions.createEl('button', {
        text: this.t('historyModal_openNote')
      });
      openNoteButton.addEventListener('click', () => {
        void this.plugin.app.workspace.getLeaf(false).openFile(noteFile);
        this.close();
      });
    }
    if (entry.postId) {
      const editButton = actions.createEl('button', {
        cls: 'mod-cta',
        text: this.t('historyModal_editPost')
      });
      editButton.addEventListener('click', () => {
        openWithBrowser(
          entry.endpoint.replace(/\/+$/, '') + '/wp-admin/post.php',
          { action: 'edit', post: entry.postId }
        );
      });
    }
  }

  private baselineForEntry(entry: PublishHistoryEntry): SyncBaseline | undefined {
    if (entry.profileId) {
      const exact = getSyncBaseline(
        this.plugin.settings.syncBaselineCache,
        entry.notePath,
        entry.profileId
      );
      if (exact
        && exact.profileEndpoint === entry.endpoint
        && (!entry.postId || exact.postId === entry.postId)
      ) {
        return exact;
      }
    }
    return this.plugin.settings.syncBaselineCache.entries
      .filter(baseline => baseline.notePath === entry.notePath
        && baseline.profileEndpoint === entry.endpoint
        && (!entry.postId || baseline.postId === entry.postId))
      .sort((left, right) => right.lastAgreedAt.localeCompare(left.lastAgreedAt))[0];
  }

  private createFact(
    parent: HTMLElement,
    label: string,
    value: string,
    warning = false,
    syncState?: typeof SyncState[keyof typeof SyncState]
  ): void {
    const fact = parent.createDiv({
      cls: 'wp-publisher-history-fact'
        + (warning ? ' is-warning' : '')
        + (syncState ? ' is-sync-' + syncState : '')
    });
    fact.createSpan({ text: label });
    fact.createEl('strong', { text: value });
  }

  private async clearHistory(): Promise<void> {
    const result = await openConfirmModal({
      message: this.t('historyModal_clearConfirm'),
      confirmText: this.t('historyModal_clearConfirmButton')
    }, this.plugin);
    if (result.code !== ConfirmCode.Confirm) {
      return;
    }
    this.plugin.settings.publishHistory = [];
    await this.plugin.saveSettings();
    this.entries = [];
    this.query = '';
    this.render();
  }

  private actionLabel(action: PublishHistoryAction): string {
    switch (action) {
      case PublishHistoryAction.Create:
        return this.t('historyModal_actionCreate');
      case PublishHistoryAction.ContentOnly:
        return this.t('historyModal_actionContentOnly');
      case PublishHistoryAction.Pull:
        return this.t('historyModal_actionPull');
      case PublishHistoryAction.Merge:
        return this.t('historyModal_actionMerge');
      default:
        return this.t('historyModal_actionFullUpdate');
    }
  }

  private outcomeLabel(outcome: PublishHistoryOutcome): string {
    return this.t(outcome === PublishHistoryOutcome.Success
      ? 'historyModal_outcomeSuccess'
      : 'historyModal_outcomeFailure');
  }

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
  }

  private siteLabel(endpoint: string): string {
    try {
      return new URL(endpoint).host || endpoint;
    } catch {
      return endpoint;
    }
  }
}
